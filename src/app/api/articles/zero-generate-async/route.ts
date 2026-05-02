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
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { zeroGenerateRequestSchema } from '@/lib/validators/zero-generate';
import {
  createJobState,
  updateJobState,
} from '@/lib/jobs/zero-gen-job-store';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 300;

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
  const safeUpdate = (state: Parameters<typeof updateJobState>[1]) =>
    updateJobState(jobId, state).catch((e) => {
      console.warn('[zero-gen-async.progress.update.failed]', {
        job_id: jobId,
        error_message: (e as Error).message,
      });
    });

  timers.push(
    setTimeout(() => safeUpdate({ stage: 'stage1', progress: 0.15, eta_seconds: 80 }), 1_000),
    setTimeout(() => safeUpdate({ stage: 'stage2', progress: 0.4, eta_seconds: 50 }), 30_000),
    setTimeout(() => safeUpdate({ stage: 'hallucination', progress: 0.75, eta_seconds: 20 }), 70_000),
  );

  const t0 = Date.now();
  try {
    const res = await fetch(internalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: cookieHeader,
      },
      body: JSON.stringify(payload),
    });
    timers.forEach(clearTimeout);

    if (!res.ok && res.status !== 207) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      const errorMsg =
        typeof errBody.error === 'string' ? errBody.error : `HTTP ${res.status}`;
      await safeUpdate({
        stage: 'failed',
        progress: 1.0,
        eta_seconds: 0,
        error: errorMsg,
      });
      logger.error('api', 'zero-generate-async.failed', {
        job_id: jobId,
        status: res.status,
        error: errorMsg,
      });
      return;
    }

    const json = (await res.json()) as ZeroGenerateFullJsonResponse;
    await safeUpdate({
      stage: 'done',
      progress: 1.0,
      eta_seconds: 0,
      article_id: json.article_id,
    });
    logger.info('api', 'zero-generate-async.done', {
      job_id: jobId,
      article_id: json.article_id,
      partial: json.partial_success,
      elapsed_ms: Date.now() - t0,
    });
  } catch (e) {
    timers.forEach(clearTimeout);
    const message = (e as Error).message;
    await safeUpdate({
      stage: 'failed',
      progress: 1.0,
      eta_seconds: 0,
      error: message,
    });
    logger.error('api', 'zero-generate-async.exception', {
      job_id: jobId,
      error: message,
    });
  }
}
