import { createServiceRoleClient } from '@/lib/supabase/server';

// ---------- 型定義 ----------

export type ArticleStatus =
  | 'draft'
  | 'outline_pending'
  | 'outline_approved'
  | 'body_generating'
  | 'body_review'
  | 'editing'
  | 'published';

/** ステータス遷移マップ: キー → 遷移可能な次のステータス一覧 */
const VALID_TRANSITIONS: Record<ArticleStatus, ArticleStatus[]> = {
  draft: ['outline_pending'],
  outline_pending: ['outline_approved', 'draft'],
  outline_approved: ['body_generating', 'draft'],
  body_generating: ['body_review'],
  body_review: ['editing', 'body_generating'],
  editing: ['published', 'body_review'],
  published: [],
};

export interface ArticleRow {
  id: string;
  article_number: number;
  title: string | null;
  slug: string | null;
  status: ArticleStatus;
  source_article_id: string | null;
  perspective_type: string | null;
  meta_description: string | null;
  seo_filename: string | null;
  keyword: string | null;
  theme: string | null;
  persona: string | null;
  target_word_count: number;
  stage1_outline: unknown | null;
  stage1_image_prompts: unknown | null;
  stage2_body_html: string | null;
  stage3_final_html: string | null;
  published_html: string | null;
  faq_data: unknown | null;
  structured_data: unknown | null;
  seo_score: unknown | null;
  aio_score: unknown | null;
  quick_answer: string | null;
  image_prompts: unknown | null;
  image_files: unknown;
  cta_texts: unknown | null;
  related_articles: unknown;
  published_url: string | null;
  published_at: string | null;
  ai_generation_log: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: any;
}

export interface ListArticlesFilter {
  status?: ArticleStatus;
  keyword?: string;
  limit?: number;
  offset?: number;
}

export interface CreateArticleInput {
  title: string;
  slug?: string;
  source_article_id?: string;
  perspective_type?: string;
  meta_description?: string;
  seo_filename?: string;
  keyword?: string;
  theme?: string;
  persona?: string;
  target_word_count?: number;
  [key: string]: any;
}

// ---------- CRUD ----------

/**
 * 記事を ID で取得する。
 */
export async function getArticleById(id: string): Promise<ArticleRow | null> {
  const supabase = await createServiceRoleClient();

  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(`getArticleById failed: ${error.message}`);
  }

  return data as ArticleRow | null;
}

/**
 * ページネーション付き記事一覧を取得する。
 */
export async function listArticles(
  filter: ListArticlesFilter = {},
): Promise<{ data: ArticleRow[]; count: number }> {
  const supabase = await createServiceRoleClient();
  const { status, keyword, limit = 20, offset = 0 } = filter;

  let query = supabase
    .from('articles')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq('status', status);
  }

  if (keyword) {
    query = query.or(`title.ilike.%${keyword}%,keyword.ilike.%${keyword}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`listArticles failed: ${error.message}`);
  }

  return {
    data: (data ?? []) as ArticleRow[],
    count: count ?? 0,
  };
}

/**
 * 新規記事を作成する。初期ステータスは draft。
 */
export async function createArticle(
  input: CreateArticleInput,
): Promise<ArticleRow> {
  const supabase = await createServiceRoleClient();

  // ソース記事の重複使用を防止（1ソース→1記事の原則）
  if (input.source_article_id) {
    const { data: existing } = await supabase
      .from('articles')
      .select('id, slug')
      .eq('source_article_id', input.source_article_id)
      .not('status', 'in', '("deleted")');
    if (existing && existing.length > 0) {
      throw new Error(
        `このソース記事は既に「${existing[0].slug}」で使用されています。1つのソース記事から複数の記事を生成することは禁止されています。`,
      );
    }
  }

  const { data, error } = await supabase
    .from('articles')
    .insert({
      ...input,
      status: 'draft' as ArticleStatus,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`createArticle failed: ${error.message}`);
  }

  return data as ArticleRow;
}

/**
 * 記事のフィールドを更新する。ステータス変更は transitionArticleStatus を使うこと。
 */
export async function updateArticle(
  id: string,
  fields: Partial<Omit<ArticleRow, 'id' | 'created_at' | 'status'>>,
): Promise<ArticleRow> {
  const supabase = await createServiceRoleClient();

  const { data, error } = await supabase
    .from('articles')
    .update({
      ...fields,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new Error(`updateArticle failed: ${error.message}`);
  }

  return data as ArticleRow;
}

/**
 * ステータス遷移をバリデーション付きで実行する。
 * VALID_TRANSITIONS に沿わない遷移は拒否する。
 */
export async function transitionArticleStatus(
  id: string,
  newStatus: ArticleStatus,
  extraFields?: Partial<Omit<ArticleRow, 'id' | 'created_at' | 'status'>>,
): Promise<ArticleRow> {
  // 現在の記事を取得
  const current = await getArticleById(id);
  if (!current) {
    throw new Error(`Article not found: ${id}`);
  }

  const currentStatus = current.status as ArticleStatus;
  const allowed = VALID_TRANSITIONS[currentStatus];

  if (!allowed || !allowed.includes(newStatus)) {
    throw new Error(
      `Invalid status transition: ${currentStatus} → ${newStatus}. ` +
        `Allowed transitions from "${currentStatus}": [${allowed.join(', ')}]`,
    );
  }

  const supabase = await createServiceRoleClient();

  // published への遷移時は published_at を自動設定
  const timestampFields: Record<string, string> = {};
  if (newStatus === 'published') {
    timestampFields.published_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('articles')
    .update({
      ...(extraFields ?? {}),
      ...timestampFields,
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new Error(`transitionArticleStatus failed: ${error.message}`);
  }

  return data as ArticleRow;
}

/**
 * 記事を削除する。
 */
export async function deleteArticle(id: string): Promise<void> {
  const supabase = await createServiceRoleClient();

  const { error } = await supabase
    .from('articles')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`deleteArticle failed: ${error.message}`);
  }
}
