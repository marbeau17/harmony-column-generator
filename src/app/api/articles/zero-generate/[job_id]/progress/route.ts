// ============================================================================
// src/app/api/articles/zero-generate/[job_id]/progress/route.ts
//
// SSE (Server-Sent Events) 進捗ストリーム
//
// 仕様 §12.1 (async mode):
//   GET /api/articles/zero-generate/{job_id}/progress
//     - 認証必須（未ログインは 401）
//     - job_id (UUID) で zero-gen-job-store から状態を polling
//     - Content-Type: text/event-stream
//     - フォーマット: data: {"stage":"stage1","progress":0.1,"eta_seconds":30}\n\n
//     - 5 秒間隔で送信、stage が 'done' / 'failed' になったら close
//     - クライアント切断 (request.signal abort) で polling を停止
//
// 注意:
//   - Next.js Edge runtime ではなく Node.js runtime（fs を使う store のため）
//   - 同一状態の連続送信は省略する（updated_at で diff 判定）
//   - 初回は現在状態を即送信（接続直後にクライアントが進捗を取れるように）
// ============================================================================

import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getJobState, type JobState } from '@/lib/jobs/zero-gen-job-store';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const POLL_INTERVAL_MS = 5_000;
const TERMINAL_STAGES: ReadonlyArray<JobState['stage']> = ['done', 'failed'];

interface RouteContext {
  params: Promise<{ job_id: string }>;
}

// UUID v4/v5 ざっくり判定（厳密は不要、形だけ）
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function sseEncode(state: JobState): string {
  const payload = {
    stage: state.stage,
    progress: state.progress,
    eta_seconds: state.eta_seconds,
    ...(state.error ? { error: state.error } : {}),
    ...(state.article_id ? { article_id: state.article_id } : {}),
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { job_id: jobId } = await context.params;

  // ─── 1. job_id 形式チェック ───────────────────────────────────────────────
  if (!jobId || !UUID_RE.test(jobId)) {
    return new Response(
      JSON.stringify({ error: 'invalid job_id' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ─── 2. 認証 ──────────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: 'unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ─── 3. SSE ストリーム生成 ────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const abortSignal = request.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastUpdatedAt: string | null = null;
      let timer: NodeJS.Timeout | null = null;

      const safeClose = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {
          // すでに close 済み
        }
      };

      const enqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // controller がクライアント切断で死んでいる
          safeClose();
        }
      };

      const tick = async () => {
        if (closed) return;
        try {
          const state = await getJobState(jobId);
          if (!state) {
            // ジョブが見つからない: 1 度だけ通知して close
            enqueue(
              `data: ${JSON.stringify({
                stage: 'failed',
                progress: 0,
                eta_seconds: 0,
                error: 'job not found',
              })}\n\n`,
            );
            safeClose();
            return;
          }

          // 同一状態の連続送信は抑制（diff 判定）
          if (state.updated_at !== lastUpdatedAt) {
            enqueue(sseEncode(state));
            lastUpdatedAt = state.updated_at;
          }

          if (TERMINAL_STAGES.includes(state.stage)) {
            safeClose();
          }
        } catch (err) {
          logger.error('api', 'zero-gen-progress-tick-failed', { jobId }, err);
          enqueue(
            `data: ${JSON.stringify({
              stage: 'failed',
              progress: 0,
              eta_seconds: 0,
              error: 'progress stream error',
            })}\n\n`,
          );
          safeClose();
        }
      };

      // クライアント切断ハンドラ
      const onAbort = () => {
        logger.info('api', 'zero-gen-progress-client-aborted', { jobId });
        safeClose();
      };
      if (abortSignal.aborted) {
        safeClose();
        return;
      }
      abortSignal.addEventListener('abort', onAbort, { once: true });

      // 初回は即送信
      await tick();
      if (closed) return;

      // 5 秒間隔で polling
      timer = setInterval(() => {
        void tick();
      }, POLL_INTERVAL_MS);
    },

    cancel() {
      // ReadableStream 側のキャンセル（GC や手動 abort）
      // start 内の closed フラグで二重 close を防いでいるので何もしない
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // nginx 対策
    },
  });
}
