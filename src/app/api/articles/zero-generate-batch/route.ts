// ============================================================================
// src/app/api/articles/zero-generate-batch/route.ts
// POST /api/articles/zero-generate-batch (P5-21)
//
// 設計:
//   1. 認証 + zod 検証 (jobs[1..10])
//   2. batch_id 生成
//   3. 各 job について /api/articles/zero-generate-async を内部 fetch で kick
//      - 並列度 3、それ以上は 200ms 間隔で順次起動
//      - 各 fetch は ~200ms で job_id を返却
//   4. 全 fetch 完了を待ってレスポンス
//
// 制約: maxDuration=60 (kick 自体は数秒以内、各 async route は別 function)
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  batchZeroGenerateRequestSchema,
  type BatchJobLaunchResult,
  type BatchZeroGenerateResponse,
} from '@/lib/validators/batch-zero-generate';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 60;

const PARALLEL_LIMIT = 3;
const KICK_INTERVAL_MS = 200;

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
  const parsed = batchZeroGenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'バリデーションエラー', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { jobs } = parsed.data;

  const batchId = crypto.randomUUID();
  console.log('[batch-zero-gen.begin]', {
    batch_id: batchId,
    user: user.id,
    jobs_count: jobs.length,
  });

  const cookieHeader = request.headers.get('cookie') ?? '';
  const baseUrl = new URL(request.url).origin;
  const asyncUrl = `${baseUrl}/api/articles/zero-generate-async`;

  const launchedAt = Date.now();

  // 並列度 PARALLEL_LIMIT で kick (それ以上は KICK_INTERVAL_MS 間隔で逐次)
  const results: BatchJobLaunchResult[] = await launchJobsWithThrottling({
    jobs,
    asyncUrl,
    cookieHeader,
    parallel: PARALLEL_LIMIT,
    intervalMs: KICK_INTERVAL_MS,
  });

  logger.info('api', 'batch-zero-generate', {
    batch_id: batchId,
    jobs_count: jobs.length,
    succeeded: results.filter((r) => r.status === 'queued').length,
    failed: results.filter((r) => r.status === 'failed').length,
    elapsed_ms: Date.now() - launchedAt,
  });

  const response: BatchZeroGenerateResponse = {
    batch_id: batchId,
    jobs: results,
  };
  return NextResponse.json(response);
}

async function launchJobsWithThrottling(args: {
  jobs: unknown[];
  asyncUrl: string;
  cookieHeader: string;
  parallel: number;
  intervalMs: number;
}): Promise<BatchJobLaunchResult[]> {
  const { jobs, asyncUrl, cookieHeader, parallel, intervalMs } = args;
  const results: BatchJobLaunchResult[] = new Array(jobs.length);

  // 簡易セマフォ: 並列度 parallel + 各起動間に intervalMs の最小間隔
  let lastKickAt = 0;
  const kick = async (index: number, payload: unknown): Promise<BatchJobLaunchResult> => {
    // 連続 kick の最小間隔
    const waitMs = Math.max(0, lastKickAt + intervalMs - Date.now());
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    lastKickAt = Date.now();

    try {
      const res = await fetch(asyncUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: cookieHeader },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        return {
          index,
          status: 'failed',
          error:
            (typeof errBody.error === 'string' ? errBody.error : `HTTP ${res.status}`) ||
            'unknown error',
        };
      }
      const json = (await res.json()) as { job_id?: string };
      if (!json.job_id) {
        return { index, status: 'failed', error: 'job_id missing in response' };
      }
      return { index, job_id: json.job_id, status: 'queued' };
    } catch (e) {
      return { index, status: 'failed', error: (e as Error).message };
    }
  };

  // 並列度 parallel のキューで処理
  let nextIdx = 0;
  const runOne = async (): Promise<void> => {
    while (true) {
      const myIdx = nextIdx++;
      if (myIdx >= jobs.length) return;
      results[myIdx] = await kick(myIdx, jobs[myIdx]);
    }
  };
  const workers = Array.from({ length: Math.min(parallel, jobs.length) }, () => runOne());
  await Promise.all(workers);
  return results;
}
