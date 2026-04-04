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
  title: string;
  slug: string | null;
  status: ArticleStatus;
  outline: string | null;
  body: string | null;
  source_article_id: string | null;
  seo_title: string | null;
  seo_description: string | null;
  featured_image_url: string | null;
  archived_at: string | null;
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
  outline?: string;
  body?: string;
  source_article_id?: string;
  seo_title?: string;
  seo_description?: string;
  featured_image_url?: string;
  [key: string]: any;
}

// ---------- CRUD ----------

/**
 * 記事を ID で取得する。アーカイブ済みは除外。
 */
export async function getArticleById(id: string): Promise<ArticleRow | null> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .eq('id', id)
    .is('archived_at', null)
    .maybeSingle();

  if (error) {
    throw new Error(`getArticleById failed: ${error.message}`);
  }

  return data as ArticleRow | null;
}

/**
 * ページネーション付き記事一覧を取得する。
 * アーカイブ済みは除外。
 */
export async function listArticles(
  filter: ListArticlesFilter = {},
): Promise<{ data: ArticleRow[]; count: number }> {
  const supabase = createServiceRoleClient();
  const { status, keyword, limit = 20, offset = 0 } = filter;

  let query = supabase
    .from('articles')
    .select('*', { count: 'exact' })
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq('status', status);
  }

  if (keyword) {
    query = query.or(`title.ilike.%${keyword}%,body.ilike.%${keyword}%`);
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
  const supabase = createServiceRoleClient();

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
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('articles')
    .update({
      ...fields,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .is('archived_at', null)
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

  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('articles')
    .update({
      ...(extraFields ?? {}),
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .is('archived_at', null)
    .select('*')
    .single();

  if (error) {
    throw new Error(`transitionArticleStatus failed: ${error.message}`);
  }

  return data as ArticleRow;
}

/**
 * 記事を論理削除（アーカイブ）する。
 */
export async function archiveArticle(id: string): Promise<ArticleRow> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('articles')
    .update({
      archived_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .is('archived_at', null)
    .select('*')
    .single();

  if (error) {
    throw new Error(`archiveArticle failed: ${error.message}`);
  }

  return data as ArticleRow;
}
