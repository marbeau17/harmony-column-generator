// ============================================================================
// src/app/api/articles/zero-generate-async/route.ts
// POST /api/articles/zero-generate-async
//
// P5-20: 案B 非同期生成エンドポイント。
//
// 設計:
//   1. POST で zeroGenerateRequestSchema を検証
//   2. crypto.randomUUID() で job_id を生成し createJobState
//   3. NextResponse.json({ job_id, status: 'queued' }) を即返却 (~200ms)
//   4. @vercel/functions の waitUntil で本処理を継続実行 (Vercel Pro 300s 制限内)
//   5. 内部 fetch で /api/articles/zero-generate-full を呼出
//   6. 各 stage で updateJobState (擬似進捗) → SSE 経由でクライアントに伝達
//   7. 完了/失敗で stage='done'/'failed' に更新
//
// クライアントは
//   - localStorage に job_id を保存
//   - GET /api/articles/zero-generate/{job_id}/progress で SSE 購読
//   - 完了時 toast 通知 + 記事へのリンク
// により、別画面に移動しても生成が続く UX を実現する。
//
// P5-70 (G7): stuck 検出 + 細粒度進捗ログを追加。
//   - 各 safeUpdate 直前に logger.info('zero_async.progress')
//   - 5 分以上 transition が無ければ auto-fail (stuck timeout)
//   - fetch 失敗時に response.status / body 先頭 500 char を logger.error
//   - 擬似 timer 起動 / completion 開始 / completion onProgress / failed を logger.info
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { zeroGenerateRequestSchema } from '@/lib/validators/zero-generate';
import {
  createJobState,
  updateJobState,
} from '@/lib/jobs/zero-gen-job-store';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { runZeroGenCompletion } from '@/lib/zero-gen/run-completion';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 300;

// P5-70: stuck timeout — 5 分 transition 無しで auto-fail
const STUCK_TIMEOUT_MS = 5 * 60 * 1000;

interface ZeroGenerateFullJsonResponse {
  article_id?: string;
  partial_success?: boolean;
  scores?: unknown;
  error?: string;
}

export async function POST(request: NextRequest) {
  // 1. 認証
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  // 2. body 検証
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 解析に失敗しました' }, { status: 400 });
  }
  const parsed = zeroGenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'バリデーションエラー', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const reqBody = parsed.data;

  // 3. job_id (UUID) 生成
  const jobId = crypto.randomUUID();
  await createJobState(jobId);
  await updateJobState(jobId, {
    stage: 'queued',
    progress: 0,
    eta_seconds: 90,
  });
  logger.info('api', 'zero_async.progress', {
    job_id: jobId,
    article_id: null,
    stage: 'queued',
    progress: 0,
    eta_seconds: 90,
  });
  console.log('[zero-gen-async.kick]', {
    job_id: jobId,
    user: user.id,
    keywords_count: reqBody.keywords.length,
  });

  // 4. 内部 fetch を waitUntil で継続実行
  const cookieHeader = request.headers.get('cookie') ?? '';
  const baseUrl = new URL(request.url).origin;
  const internalUrl = `${baseUrl}/api/articles/zero-generate-full`;

  const task = runAsyncPipeline({
    jobId,
    internalUrl,
    cookieHeader,
    payload: reqBody,
  });
  waitUntil(task);

  // 5. 即返
  return NextResponse.json({ job_id: jobId, status: 'queued' });
}

async function runAsyncPipeline(args: {
  jobId: string;
  internalUrl: string;
  cookieHeader: string;
  payload: unknown;
}): Promise<void> {
  const { jobId, internalUrl, cookieHeader, payload } = args;

  // 擬似進捗 (実 API は単一 POST なので時間ベース推定)
  const timers: NodeJS.Timeout[] = [];

  // ─── stuck 検出 (P5-70) ─────────────────────────────────────────────
  // 5min 以上 safeUpdate が呼ばれなかったら auto-fail。
  // safeUpdate するたびに最終 transition 時刻を更新し、watchdog timer を再武装する。
  let lastTransitionAt = Date.now();
  let stuckTimer: NodeJS.Timeout | null = null;
  let abortedByStuck = false;
  const stuckController = new AbortController();

  const armStuckWatchdog = () => {
    if (stuckTimer) clearTimeout(stuckTimer);
    stuckTimer = setTimeout(() => {
      if (abortedByStuck) return;
      abortedByStuck = true;
      const idleMs = Date.now() - lastTransitionAt;
      logger.error('api', 'zero_async.stuck_timeout', {
        job_id: jobId,
        idle_ms: idleMs,
        threshold_ms: STUCK_TIMEOUT_MS,
        reason: 'no_transition_5min',
      });
      // safeUpdate 経路 (内部で logger.warn) を使うと再帰的に watchdog を再武装してしまうため、
      // ここでは updateJobState を直接呼び出す。失敗してもログだけ残す。
      updateJobState(jobId, {
        stage: 'failed',
        progress: 100,
        eta_seconds: 0,
        error: 'stuck timeout (5min idle)',
      }).catch((e) => {
        logger.warn('api', 'zero_async.stuck_timeout.update_failed', {
          job_id: jobId,
          error_message: (e as Error).message,
        });
      });
      // 進行中の fetch を中断
      try {
        stuckController.abort();
      } catch {
        // ignore
      }
    }, STUCK_TIMEOUT_MS);
    // unref で Node プロセス終了を阻害しない (テスト時の安全策)
    if (typeof (stuckTimer as unknown as { unref?: () => void }).unref === 'function') {
      (stuckTimer as unknown as { unref: () => void }).unref();
    }
  };

  const clearStuckWatchdog = () => {
    if (stuckTimer) {
      clearTimeout(stuckTimer);
      stuckTimer = null;
    }
  };

  // ─── safeUpdate (P5-70: logger.info を直前に必ず emit) ───────────────
  const safeUpdate = (
    state: Parameters<typeof updateJobState>[1],
    extra?: { article_id?: string | null },
  ) => {
    // 進捗ログを必ず先に emit (DB 失敗しても Vercel ログに状態が残る)
    logger.info('api', 'zero_async.progress', {
      job_id: jobId,
      article_id: extra?.article_id ?? state.article_id ?? null,
      stage: state.stage ?? null,
      progress: state.progress ?? null,
      eta_seconds: state.eta_seconds ?? null,
      error: state.error ?? null,
    });
    // transition があったとみなして watchdog を再武装
    lastTransitionAt = Date.now();
    armStuckWatchdog();

    return updateJobState(jobId, state).catch((e) => {
      // P5-70: P5-69 の `.catch(() => {})` を logger.warn 経路に置換。
      //   DB 更新失敗は本処理を止めない方針は維持しつつ「DB が壊れている可能性」を必ずログに残す。
      logger.warn('api', 'zero_async.progress.update_failed', {
        job_id: jobId,
        stage: state.stage ?? null,
        error_message: (e as Error).message,
      });
      console.warn('[zero-gen-async.progress.update.failed]', {
        job_id: jobId,
        error_message: (e as Error).message,
      });
    });
  };

  // 初回 watchdog 武装
  armStuckWatchdog();

  // 擬似進捗 timer 起動 (P5-70: 起動ログ)
  logger.info('api', 'zero_async.timer.fired', {
    job_id: jobId,
    timers: ['stage1@1s', 'stage2@30s', 'hallucination@70s'],
  });
  timers.push(
    setTimeout(() => safeUpdate({ stage: 'stage1', progress: 15, eta_seconds: 80 }), 1_000),
    setTimeout(() => safeUpdate({ stage: 'stage2', progress: 40, eta_seconds: 50 }), 30_000),
    setTimeout(() => safeUpdate({ stage: 'hallucination', progress: 75, eta_seconds: 20 }), 70_000),
  );

  const t0 = Date.now();
  try {
    let res: Response;
    try {
      res = await fetch(internalUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: cookieHeader,
        },
        body: JSON.stringify(payload),
        signal: stuckController.signal,
      });
    } catch (fetchErr) {
      // P5-70: 実 fetch エラー (timeout / network / abort) を必ず logger.error
      const errMsg = (fetchErr as Error).message;
      const errName = (fetchErr as Error).name;
      logger.error('api', 'zero_async.fetch_failed', {
        job_id: jobId,
        error_name: errName,
        error_message: errMsg,
        aborted_by_stuck: abortedByStuck,
        elapsed_ms: Date.now() - t0,
      });
      throw fetchErr;
    }
    timers.forEach(clearTimeout);

    if (!res.ok && res.status !== 207) {
      // P5-70: response body の頭 500 char を必ず logger.error に含める
      let bodyText = '';
      try {
        bodyText = await res.text();
      } catch (textErr) {
        logger.warn('api', 'zero_async.fetch_body_read_failed', {
          job_id: jobId,
          error_message: (textErr as Error).message,
        });
      }
      let errBody: { error?: string } = {};
      try {
        errBody = bodyText ? (JSON.parse(bodyText) as { error?: string }) : {};
      } catch {
        // not JSON
      }
      const errorMsg =
        typeof errBody.error === 'string' ? errBody.error : `HTTP ${res.status}`;
      logger.error('api', 'zero_async.fetch_non_ok', {
        job_id: jobId,
        status: res.status,
        body_preview: bodyText.slice(0, 500),
        error: errorMsg,
        elapsed_ms: Date.now() - t0,
      });
      await safeUpdate({
        stage: 'failed',
        progress: 100,
        eta_seconds: 0,
        error: errorMsg,
      });
      logger.error('api', 'zero-generate-async.failed', {
        job_id: jobId,
        status: res.status,
        error: errorMsg,
      });
      clearStuckWatchdog();
      return;
    }

    let json: ZeroGenerateFullJsonResponse;
    try {
      json = (await res.json()) as ZeroGenerateFullJsonResponse;
    } catch (parseErr) {
      // P5-70: parse error も response body 先頭を必ず添える
      let bodyText = '';
      try {
        bodyText = await res.clone().text();
      } catch {
        // ignore
      }
      logger.error('api', 'zero_async.fetch_parse_failed', {
        job_id: jobId,
        status: res.status,
        body_preview: bodyText.slice(0, 500),
        error_message: (parseErr as Error).message,
        elapsed_ms: Date.now() - t0,
      });
      throw parseErr;
    }

    // P5-24: Stage2 完了 → 画像 + Stage3 + meta を自動実行 (公開準備状態まで)
    if (!json.article_id) {
      await safeUpdate({
        stage: 'failed',
        progress: 100,
        eta_seconds: 0,
        error: 'article_id が返されませんでした',
      });
      clearStuckWatchdog();
      return;
    }
    await safeUpdate({
      stage: 'finalizing',
      progress: 85,
      eta_seconds: 90,
      article_id: json.article_id,
    });
    let completionPartial = false;
    let completionError: string | null = null;
    try {
      logger.info('api', 'zero_async.completion.started', {
        job_id: jobId,
        article_id: json.article_id,
        elapsed_ms: Date.now() - t0,
      });
      const r = await runZeroGenCompletion({
        articleId: json.article_id,
        onProgress: (stage) => {
          // spec v2.1 (0-100 整数スケール):
          //   image_prompts (~ 87) / image_gen (~ 90) / stage3 (~ 97) / persist (~ 99)
          const stageProgressMap: Record<string, number> = {
            image_prompts: 87,
            image_gen: 90,
            stage3: 97,
            persist: 99,
          };
          const p = stageProgressMap[stage];
          // P5-70: stage 不明でも必ずログを残す (どこで止まっているか把握する目的)
          logger.info('api', 'zero_async.completion.progress', {
            job_id: jobId,
            article_id: json.article_id,
            completion_stage: stage,
            progress: p ?? null,
          });
          if (p !== undefined) {
            // eslint-disable-next-line no-restricted-syntax -- 進捗更新は best-effort、失敗してもメイン処理を止めない
            void safeUpdate({ progress: p }, { article_id: json.article_id ?? null }).catch(() => {});
          }
        },
      });
      completionPartial = r.partial;
      // P5-27: validation issues を error メッセージに反映
      if (r.validationIssues.length > 0) {
        completionError = `品質警告 ${r.validationIssues.length} 件: ${r.validationIssues.slice(0, 2).join(' / ')}`;
      }
      logger.info('api', 'zero-generate-async.completion.ok', {
        job_id: jobId,
        article_id: json.article_id,
        images_count: r.imageFilesCount,
        stage3_chars: r.stage3HtmlChars,
        partial: r.partial,
        validation_issues: r.validationIssues,
      });
    } catch (e) {
      // P5-69: silent 'done' 遷移を排除。runZeroGenCompletion が throw された場合は
      //   後続の stage='done' UPDATE に到達させず、必ず stage='failed' + error 付きで返す。
      //   これまでは catch 後にそのまま stage='done' を書いていたため、Stage3 仕上げが
      //   完全失敗しても error=null で「成功扱い」になり、本文ゼロの記事がそのまま
      //   draft に残る silent failure (記事 65b3d12b の事故原因) を起こしていた。
      const errorMsg = (e as Error).message;
      logger.error('api', 'zero-generate-async.completion.failed', {
        job_id: jobId,
        article_id: json.article_id,
        error: errorMsg,
        elapsed_ms: Date.now() - t0,
      });
      await safeUpdate({
        stage: 'failed',
        progress: 100,
        eta_seconds: 0,
        article_id: json.article_id,
        error: `画像/Stage3 仕上げ失敗: ${errorMsg}`,
      });
      logger.info('api', 'zero_async.failed', {
        job_id: jobId,
        article_id: json.article_id,
        reason: 'completion_threw',
        elapsed_ms: Date.now() - t0,
      });
      clearStuckWatchdog();
      return;
    }

    await safeUpdate({
      stage: 'done',
      progress: 100,
      eta_seconds: 0,
      article_id: json.article_id,
      // 仕上げで validation 警告のみあった場合は error にメッセージを付ける
      // (記事自体は draft で残っており、後から手動補正可能)
      error: completionError
        ? `品質警告: ${completionError}`
        : completionPartial
          ? '画像の一部生成に失敗。記事は作成済'
          : undefined,
    });
    logger.info('api', 'zero-generate-async.done', {
      job_id: jobId,
      article_id: json.article_id,
      partial: json.partial_success,
      completion_partial: completionPartial,
      completion_error: completionError,
      elapsed_ms: Date.now() - t0,
    });
    clearStuckWatchdog();
  } catch (e) {
    timers.forEach(clearTimeout);
    const message = (e as Error).message;
    await safeUpdate({
      stage: 'failed',
      progress: 100,
      eta_seconds: 0,
      error: message,
    });
    logger.error('api', 'zero_async.failed', {
      job_id: jobId,
      error: message,
      aborted_by_stuck: abortedByStuck,
      elapsed_ms: Date.now() - t0,
    });
    logger.error('api', 'zero-generate-async.exception', {
      job_id: jobId,
      error: message,
    });
    clearStuckWatchdog();
  }
}
