// POST /api/hallucination-retry
// critical claim 残存記事を定期 retry する Cron 用 API。
//
// ジョブ仕様:
//   - 認可: `Authorization: Bearer <HALLUCINATION_RETRY_TOKEN>` のみ受け付ける
//   - 抽出: articles.is_hub_visible=false AND status='published'
//           AND EXISTS(article_claims with risk='critical') を最大 50 件
//   - 補正: 各記事に runHallucinationChecks を再実行し、criticals=0 なら
//           articles.hallucination_score のみ UPDATE（本文は触らない）
//   - 返却: { retried, resolved, still_critical }
//
// 実処理は `@/lib/hallucination-retry/retry` に切り出している
// （Next.js App Router の route ファイルは named export が制限されるため）。

import { NextRequest, NextResponse } from 'next/server';

import { handleHallucinationRetryRequest } from '@/lib/hallucination-retry/retry';

export const maxDuration = 60;
// Cron からの呼び出しは都度 DB を見る必要があるため静的生成させない。
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleHallucinationRetryRequest(req);
}
