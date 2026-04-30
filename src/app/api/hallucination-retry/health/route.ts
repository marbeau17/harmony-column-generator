// ============================================================================
// src/app/api/hallucination-retry/health/route.ts
// GET /api/hallucination-retry/health
// hallucination-retry cron が動作しているかを確認する health check API。
//
// 仕様:
//   - 認可: `Authorization: Bearer <HALLUCINATION_RETRY_TOKEN>` のみ受け付ける
//   - 戻り値:
//       {
//         status: 'ok' | 'stale' | 'never_run',
//         last_run_at: ISO8601 | null,        // publish_events.action='hallucination-retry' 最新
//         critical_remaining: number,         // critical claim を保持する未公開記事数
//         next_run_estimate: ISO8601 | null,  // last_run_at + 6h
//       }
//   - last_run_at が 12h 以上前 → status:'stale'
//   - last_run_at が null       → status:'never_run'
//
// 実処理は `@/lib/hallucination-retry/health` に切り出している
// （Next.js App Router の route ファイルは named export が制限されるため）。
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';

import { handleHealthRequest } from '@/lib/hallucination-retry/health';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handleHealthRequest(req);
}
