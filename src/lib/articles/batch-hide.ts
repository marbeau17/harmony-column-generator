// ============================================================================
// src/lib/articles/batch-hide.ts
// publish-control-v2: ソースベース既存記事を一括ソフト撤回するための純ロジック層
//
// API ルートと分離して DI 可能にしている。実装方針:
//   - articles を「is_hub_visible=true かつ generation_mode='source' or NULL」で抽出
//   - dryRun=true の場合は対象 ID のみ返して終了
//   - 各記事ごとに以下を順に実施
//       1. articles UPDATE: is_hub_visible=false, visibility_state='unpublished',
//          visibility_updated_at=now()
//       2. ソフト撤回 HTML を生成し softWithdrawFile で FTP 上書き
//          (FTP_DRY_RUN=true なら tmp/ftp-dry-run/ に書き出し)
//       3. publish_events に action='unpublish', reason='batch-hide-source' で INSERT
//   - 1 件失敗しても他は継続（部分成功）。失敗内容は failures に記録
//   - 全体終了後にハブ再生成（任意）
//
// 既存 src/app/api/articles/[id]/visibility/route.ts は読むのみで変更しない。
// 既存 publish-control コア / articles.ts / hub-rebuild-client.ts / ftp-uploader.ts も
// 変更せずに「呼び出すだけ」のスタンスを維持する。
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { renderSoftWithdrawalHtml } from '@/lib/publish-control/soft-withdrawal';
import { getFtpConfig, softWithdrawFile, type FtpConfig } from '@/lib/deploy/ftp-uploader';
import { logger } from '@/lib/logger';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

export interface BatchHideTarget {
  id: string;
  slug: string;
  title: string | null;
}

export interface BatchHideFailure {
  id: string;
  stage: 'db-update' | 'ftp-soft-withdraw' | 'event-insert';
  message: string;
}

export interface BatchHideResult {
  dryRun: boolean;
  candidates: number;          // 抽出された対象件数
  hidden: number;               // 実際に非表示化に成功した件数
  ids: string[];                // 対象記事の ID
  succeededIds: string[];       // 成功した記事の ID
  failures: BatchHideFailure[];
  hubRebuildStatus: 'ok' | 'failed' | 'skipped';
  hubRebuildError?: string | null;
}

export interface BatchHideOptions {
  /** dry-run: true の場合は読み取りのみ */
  dryRun: boolean;
  /** FTP ソフト撤回呼び出しを有効にするか（PUBLISH_CONTROL_FTP=on 相当） */
  ftpEnabled: boolean;
  /** ハブ再生成を実行するか */
  runHubRebuild: boolean;
  /** 行為者メール（publish_events.actor_email へ記録） */
  actorEmail?: string | null;
  /** 行為者 ID（publish_events.actor_id） */
  actorId?: string | null;
  /** publish_events.reason 上書き */
  reason?: string;
}

export interface BatchHideDeps {
  /** service role の supabase client */
  supabase: SupabaseClient;
  /** request_id 生成器（ULID 26 文字） */
  generateRequestId: () => string;
  /** ハブ再生成器（runHubRebuild=true の時のみ呼ばれる） */
  rebuildHub?: () => Promise<{ ok: boolean; error?: string | null }>;
  /** FTP 設定取得（DI 用。指定無ければ getFtpConfig を使う） */
  loadFtpConfig?: () => Promise<FtpConfig>;
  /** 単一ファイルのソフト撤回（DI 用。指定無ければ softWithdrawFile を使う） */
  softWithdraw?: (cfg: FtpConfig, remotePath: string, html: string) => Promise<{ success: boolean; errors: string[] }>;
  /** 現在時刻 supplier（テスト用） */
  now?: () => Date;
}

// ─── 本体 ────────────────────────────────────────────────────────────────────

/**
 * ソースベース既存記事を一括でソフト撤回する。
 * - 対象: articles WHERE is_hub_visible=true AND (generation_mode='source' OR generation_mode IS NULL)
 */
export async function batchHideSourceArticles(
  opts: BatchHideOptions,
  deps: BatchHideDeps,
): Promise<BatchHideResult> {
  const supabase = deps.supabase;
  const now = deps.now ?? (() => new Date());
  const loadFtpConfig = deps.loadFtpConfig ?? getFtpConfig;
  const softWithdraw = deps.softWithdraw ?? softWithdrawFile;

  // --- 対象抽出 -------------------------------------------------------------
  // generation_mode='source' か NULL を or() で抽出。
  const { data: rows, error: selectErr } = await supabase
    .from('articles')
    // guard-approved: read-only select for batch-hide-source
    .select('id, slug, seo_filename, title, generation_mode, is_hub_visible')
    .eq('is_hub_visible', true)
    .or('generation_mode.eq.source,generation_mode.is.null');

  if (selectErr) {
    throw new Error(`select failed: ${selectErr.message}`);
  }

  const targets: BatchHideTarget[] = (rows ?? []).map((r: { id: string; slug: string | null; seo_filename: string | null; title: string | null }) => ({
    id: r.id,
    slug: (r.slug ?? r.seo_filename ?? r.id) as string,
    title: r.title ?? null,
  }));

  const ids = targets.map((t) => t.id);

  // --- dry-run は ID リストだけ返す ----------------------------------------
  if (opts.dryRun) {
    return {
      dryRun: true,
      candidates: targets.length,
      hidden: 0,
      ids,
      succeededIds: [],
      failures: [],
      hubRebuildStatus: 'skipped',
      hubRebuildError: null,
    };
  }

  // --- FTP 設定を 1 回だけ取得 ---------------------------------------------
  let ftpConfig: FtpConfig | null = null;
  if (opts.ftpEnabled && targets.length > 0) {
    try {
      ftpConfig = await loadFtpConfig();
    } catch (err) {
      // FTP 設定取得自体が失敗した場合、全件を soft-withdraw 段階で失敗扱いにする
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('api', 'batch-hide.ftp-config-failed', { message: msg });
      ftpConfig = null;
    }
  }

  const failures: BatchHideFailure[] = [];
  const succeededIds: string[] = [];

  // --- 各記事を逐次処理（部分成功） ----------------------------------------
  for (const target of targets) {
    const tStart = now().toISOString();

    // 1) DB UPDATE: visibility 列のみ
    // P5-43 Step 3: reviewed_at は audit のみ、batch-hide では touch しない
    // (reviewed_by も同様に audit 履歴を保持するため null クリアしない)
    const { error: updErr } = await supabase
      .from('articles')
      // guard-approved: visibility-only flip for batch-hide-source
      .update({
        is_hub_visible: false,
        visibility_state: 'unpublished',
        visibility_updated_at: tStart,
      })
      .eq('id', target.id);

    if (updErr) {
      failures.push({ id: target.id, stage: 'db-update', message: updErr.message });
      logger.error('api', 'batch-hide.db-update-failed', { id: target.id, message: updErr.message });
      continue;
    }

    // 2) FTP ソフト撤回（noindex 上書き）
    let ftpStatus: 'success' | 'failed' | 'skipped' = 'skipped';
    let ftpError: string | null = null;
    if (opts.ftpEnabled && ftpConfig) {
      try {
        const html = renderSoftWithdrawalHtml({ title: target.title ?? undefined });
        const result = await softWithdraw(ftpConfig, `${target.slug}/index.html`, html);
        ftpStatus = result.success ? 'success' : 'failed';
        ftpError = result.errors.length ? result.errors.join('; ') : null;
        if (!result.success) {
          failures.push({ id: target.id, stage: 'ftp-soft-withdraw', message: ftpError ?? 'unknown' });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ftpStatus = 'failed';
        ftpError = msg;
        failures.push({ id: target.id, stage: 'ftp-soft-withdraw', message: msg });
      }
    } else if (opts.ftpEnabled && !ftpConfig) {
      ftpStatus = 'failed';
      ftpError = 'ftp config unavailable';
      failures.push({ id: target.id, stage: 'ftp-soft-withdraw', message: ftpError });
    }

    // 3) publish_events INSERT（DB 更新成功時は必ず記録、FTP 失敗は hub_deploy_error に乗せる）
    const { error: evtErr } = await supabase.from('publish_events').insert({
      article_id: target.id,
      action: 'unpublish',
      actor_id: opts.actorId ?? null,
      actor_email: opts.actorEmail ?? null,
      request_id: deps.generateRequestId(),
      hub_deploy_status: ftpStatus,
      hub_deploy_error: ftpError,
      reason: opts.reason ?? 'batch-hide-source',
    });
    if (evtErr) {
      failures.push({ id: target.id, stage: 'event-insert', message: evtErr.message });
      logger.error('api', 'batch-hide.event-insert-failed', { id: target.id, message: evtErr.message });
      // event 記録に失敗しても DB の非公開化は完了済みなので「成功扱い」とはしない
      continue;
    }

    succeededIds.push(target.id);
  }

  // --- ハブ再生成 -----------------------------------------------------------
  let hubRebuildStatus: 'ok' | 'failed' | 'skipped' = 'skipped';
  let hubRebuildError: string | null = null;
  if (opts.runHubRebuild && deps.rebuildHub) {
    try {
      const r = await deps.rebuildHub();
      if (r.ok) {
        hubRebuildStatus = 'ok';
      } else {
        hubRebuildStatus = 'failed';
        hubRebuildError = r.error ?? 'unknown';
      }
    } catch (err) {
      hubRebuildStatus = 'failed';
      hubRebuildError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    dryRun: false,
    candidates: targets.length,
    hidden: succeededIds.length,
    ids,
    succeededIds,
    failures,
    hubRebuildStatus,
    hubRebuildError,
  };
}
