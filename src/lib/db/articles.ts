import { createServiceRoleClient } from '@/lib/supabase/server';
import { saveRevision } from '@/lib/db/article-revisions';
import { assertArticleWriteAllowed, assertArticleDeleteAllowed } from '@/lib/publish-control/session-guard';

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
  reviewed_at: string | null;
  reviewed_by: string | null;
  // Publish Control V2（step7 で legacy 公開経路にも書込同期）
  is_hub_visible?: boolean | null;
  visibility_state?: string | null;
  visibility_updated_at?: string | null;
  deployed_hash?: string | null;
  created_at: string;
  updated_at: string;
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
  /**
   * 生成モード。明示的に指定しない場合は 'source'（既存 source-based 生成）を採用する。
   * - 'source': 既存記事を起点とした視点変換生成（DEFAULT 互換）
   * - 'zero':   ゼロ生成 V1（zero-generate / zero-generate-full 経由は直接 INSERT のためここを通らない）
   * DB 側にも DEFAULT 'source' が定義されているが、依存せず明示書込みすることで
   * 後続の集計・フィルタ（例: batch-hide-source）で NULL 扱いを避ける。
   */
  generation_mode?: 'zero' | 'source';
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
  assertArticleWriteAllowed(null, Object.keys(input));
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

  // generation_mode は明示的に書込む。未指定なら 'source' を既定値として採用する。
  // DB 側 DEFAULT 'source' に依存せず明示することで、列の NULL 化や DEFAULT 変更時の
  // 副作用を防ぎ、後続フィルタ（例: batch-hide-source）の判定を一貫させる。
  const generationMode: 'zero' | 'source' = input.generation_mode ?? 'source';

  const { data, error } = await supabase
    .from('articles')
    .insert({
      ...input,
      generation_mode: generationMode,
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
  assertArticleWriteAllowed(id, Object.keys(fields));
  const supabase = await createServiceRoleClient();

  // Save revision snapshot before content changes
  const contentFields = ['stage2_body_html', 'stage3_final_html', 'title', 'meta_description'];
  const hasContentChange = contentFields.some(f => f in fields);

  if (hasContentChange) {
    // Get current state before overwriting
    const { data: current } = await supabase
      .from('articles')
      .select('title, stage2_body_html, stage3_final_html, meta_description')
      .eq('id', id)
      .single();

    if (current && (current.stage3_final_html || current.stage2_body_html)) {
      // Only snapshot if content actually changed (avoid noise from auto-save ticks)
      const currentBody = current.stage3_final_html || current.stage2_body_html || '';
      const incomingBody = fields.stage3_final_html ?? fields.stage2_body_html;
      const bodyChanged = incomingBody !== undefined && incomingBody !== currentBody;
      const titleChanged = fields.title !== undefined && fields.title !== current.title;
      const metaChanged = fields.meta_description !== undefined && fields.meta_description !== current.meta_description;

      if (bodyChanged || titleChanged || metaChanged) {
        await saveRevision(id, {
          title: current.title,
          body_html: currentBody,
          meta_description: current.meta_description,
        }, 'auto_snapshot').catch(() => {}); // Don't fail the update if snapshot fails
      }
    }
  }

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
  assertArticleWriteAllowed(id, ['status', ...Object.keys(extraFields ?? {})]);
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

  // published への遷移時は published_at と新公開列（is_hub_visible / visibility_state /
  // visibility_updated_at）を自動設定する。step7（Publish Control V2）でレガシー公開経路と
  // 新 visibility API のスキーマ差を埋め、step8 の RLS 切替時のサイレント非公開化を防ぐ。
  // ※ extraFields は後勝ちで上書き可能 → 呼び出し元が意図的に false を指定するケースを許容。
  const publishedAutoFields: Record<string, unknown> = {};
  if (newStatus === 'published') {
    const nowIso = new Date().toISOString();
    publishedAutoFields.published_at = nowIso;
    publishedAutoFields.is_hub_visible = true;
    publishedAutoFields.visibility_state = 'live';
    publishedAutoFields.visibility_updated_at = nowIso;
  }

  const { data, error } = await supabase
    .from('articles')
    .update({
      ...publishedAutoFields,
      ...(extraFields ?? {}),
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
  assertArticleDeleteAllowed(id);
  const supabase = await createServiceRoleClient();

  const { error } = await supabase
    .from('articles')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`deleteArticle failed: ${error.message}`);
  }
}
