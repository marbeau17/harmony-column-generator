import { createServiceRoleClient } from '@/lib/supabase/server';
import { saveRevision } from '@/lib/db/article-revisions';
import { assertArticleWriteAllowed, assertArticleDeleteAllowed } from '@/lib/publish-control/session-guard';
// P5-59: generation_mode の厳密型を共通 types から取り込む
// spec v2.1 §2.1 — articles テーブル拡張 12 列の追加分は ArticleRow にも反映する。
import type { ArticleIntent, GenerationMode } from '@/types/article';
import type { VisibilityState } from '@/lib/publish-control/state-machine';

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
  // audit-only: P5-43 Step 4 — reviewed_at / reviewed_by は監査用タイムスタンプ。
  //   状態判定には使用しない (詳細: src/types/article.ts のコメント)。
  reviewed_at: string | null;
  reviewed_by: string | null;

  // ─── spec v2.1 §2.1 articles テーブル拡張 12 列 ────────────────────────────
  /** 生成モード（zero / source）。DB 側 DEFAULT 'source'。 */
  generation_mode?: GenerationMode | null;
  /** 記事の意図ラベル。NULL 許可。 */
  intent?: ArticleIntent | null;
  /** LLMO 用 100-150字 概要。 */
  lead_summary?: string | null;
  /** 引用ハイライト 3 件（JSONB）。 */
  citation_highlights?: unknown;
  /** 物語アーク（v2.1 で TEXT→JSONB に訂正）。 */
  narrative_arc?: unknown;
  /** 感情曲線（JSONB）。 */
  emotion_curve?: unknown;
  /** 0-100 のハルシネーション安全性スコア。 */
  hallucination_score?: number | null;
  /** 0-1 の由起子トーン類似度スコア。 */
  yukiko_tone_score?: number | null;
  /** 可読性スコア。 */
  readability_score?: number | null;
  /** 品質ゲート override 配列（JSONB）。 */
  quality_overrides?: unknown;
  /** publish-control v2 の可視性ステート（spec §3.1 の 8 値）。 */
  visibility_state?: VisibilityState | null;
  /** visibility_state 最終更新時刻 (ISO8601)。 */
  visibility_updated_at?: string | null;

  // Publish Control V2（step7 で legacy 公開経路にも書込同期）
  is_hub_visible?: boolean | null;
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
  // P5-59: 'zero' | 'source' の literal union を共通 GenerationMode 型に統一
  generation_mode?: GenerationMode;
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
  const __create_started_at = Date.now();
  const __input_obj = (input as unknown) as Record<string, unknown>;
  // 診断ログ: 書込前に主要フィールドのスナップショットを残す（M10）。
  // 既存ロジック（session-guard / バリデーション / INSERT）は一切変更しない。
  console.log('[db.articles.create.begin]', {
    generation_mode: input.generation_mode ?? 'source',
    intent: __input_obj.intent ?? null,
    theme: input.theme ?? null,
    persona: input.persona ?? null,
    status: __input_obj.status ?? 'draft',
    has_stage1_outline: 'stage1_outline' in __input_obj,
    has_stage2_body: 'stage2_body_html' in __input_obj || 'html_body' in __input_obj,
  });

  try {
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
    // P5-59: GenerationMode 型へ統一（旧: 'zero' | 'source' literal union）
    const generationMode: GenerationMode = input.generation_mode ?? 'source';

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

    const row = data as ArticleRow;
    console.log('[db.articles.create.end]', {
      ok: true,
      id: row.id,
      generation_mode:
        (row as ArticleRow & { generation_mode?: string | null }).generation_mode ?? null,
      elapsed_ms: Date.now() - __create_started_at,
    });

    return row;
  } catch (e) {
    console.log('[db.articles.create.end]', {
      ok: false,
      error_message: e instanceof Error ? e.message : String(e),
      elapsed_ms: Date.now() - __create_started_at,
    });
    throw e;
  }
}

/**
 * 記事のフィールドを更新する。ステータス変更は transitionArticleStatus を使うこと。
 */
export async function updateArticle(
  id: string,
  fields: Partial<Omit<ArticleRow, 'id' | 'created_at' | 'status'>>,
): Promise<ArticleRow> {
  const __update_started_at = Date.now();
  const __updates_obj = (fields ?? {}) as Record<string, unknown>;
  // 診断ログ: 更新前に対象 id とフィールド種別のスナップショットを残す（M10）。
  // 既存ロジック（session-guard / RLS / リビジョン保存 / UPDATE）は一切変更しない。
  console.log('[db.articles.update.begin]', {
    id,
    fields_count: Object.keys(__updates_obj).length,
    touches_body:
      'stage2_body_html' in __updates_obj || 'stage3_final_html' in __updates_obj,
    touches_status: 'status' in __updates_obj,
    touches_mode: 'generation_mode' in __updates_obj,
    touches_visibility:
      'is_hub_visible' in __updates_obj || 'visibility_state' in __updates_obj,
  });

  try {
    try {
      assertArticleWriteAllowed(id, Object.keys(fields));
    } catch (guardErr) {
      // session-guard 拒否は元のエラーメッセージをそのまま伝播する。
      // ログだけ追加で残してから再 throw（拒否理由・拒否時刻の追跡用）。
      console.log('[db.articles.update.guard_blocked]', { id });
      throw guardErr;
    }
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
          /* eslint-disable no-restricted-syntax -- スナップショット失敗で本体UPDATE処理を巻き込まない方針 (Don't fail the update if snapshot fails) */
          await saveRevision(id, {
            title: current.title,
            body_html: currentBody,
            meta_description: current.meta_description,
          }, 'auto_snapshot').catch(() => {});
          /* eslint-enable no-restricted-syntax */
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

    console.log('[db.articles.update.end]', {
      ok: true,
      id,
      elapsed_ms: Date.now() - __update_started_at,
    });

    return data as ArticleRow;
  } catch (e) {
    console.log('[db.articles.update.end]', {
      ok: false,
      id,
      elapsed_ms: Date.now() - __update_started_at,
      error_message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
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
 * P5-71: zero-generation 記事を `status='published'` まで一気に進める fast-promote。
 *
 * VALID_TRANSITIONS は draft → outline_pending → ... → editing → published の
 * 長い state machine を強制するが、generation_mode='zero' は run-completion が
 * 内部で直接 UPDATE する設計（articles.ts:21-29 の state machine をバイパス）。
 * 結果として、validation を通り抜けなかった zero-gen 記事は status='draft' or
 * 'outline_pending' のまま残り、UI「公開」ボタンの transitionArticleStatus が
 * `Invalid status transition` で 400 を返していた。
 *
 * 本 helper は run-completion と同じく **直接 UPDATE** で
 *   status='published'
 *   visibility_state='live'
 *   is_hub_visible=true
 *   published_at=now
 *   visibility_updated_at=now
 * を一括で書き込み、UI からの公開 fast-path を確立する。
 *
 * 安全制約:
 *   - generation_mode='zero' のみ許可（source 記事は通常の VALID_TRANSITIONS を通す）
 *   - visibility_state='pending_review' は拒否（由起子さん確認ゲート未通過）
 *
 * 品質ゲート（runDeployChecklist 等）は呼び出し側 (transition route) で
 * 既に通過済みの前提。本 helper は state machine だけを bypass する。
 */
export async function fastPromoteZeroToPublished(
  id: string,
  extraFields?: Partial<Omit<ArticleRow, 'id' | 'created_at' | 'status'>>,
): Promise<ArticleRow> {
  assertArticleWriteAllowed(id, ['status', ...Object.keys(extraFields ?? {})]);

  const current = await getArticleById(id);
  if (!current) {
    throw new Error(`Article not found: ${id}`);
  }
  if (current.generation_mode !== 'zero') {
    throw new Error(
      `fastPromoteZeroToPublished: generation_mode must be 'zero' (got '${current.generation_mode ?? 'null'}')`,
    );
  }
  if (current.visibility_state === 'pending_review') {
    throw new Error(
      `fastPromoteZeroToPublished: visibility_state='pending_review' は由起子さん確認待ち。先に /review で承認してください`,
    );
  }
  if (current.status === 'published') {
    return current;
  }

  const supabase = await createServiceRoleClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from('articles')
    .update({
      ...(extraFields ?? {}),
      status: 'published',
      published_at: nowIso,
      is_hub_visible: true,
      visibility_state: 'live',
      visibility_updated_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new Error(`fastPromoteZeroToPublished failed: ${error.message}`);
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
