// POST /api/dangling-recovery
// publish-control-v2: 自動回復バッチ（dangling-deploying の掃き出し）
// Spec: docs/optimized_spec.md §2.2 #7
//
// ジョブ仕様:
//   - 認可: `Authorization: Bearer <DANGLING_RECOVERY_TOKEN>` のみ受け付ける（RLS なし service role）
//   - 抽出: articles.visibility_state='deploying' かつ visibility_updated_at が 60 秒以上経過した行
//   - 補正: 当該行の visibility_state を 'failed' に上書き
//   - 監査: publish_events に action='dangling-recovery' で 1 行 INSERT
//   - 上限: 100 行 / 1 回呼び出し
//
// 実処理は `@/lib/dangling-recovery/recover` に切り出している
// （Next.js App Router の route ファイルは named export が制限されるため）。

import { NextRequest, NextResponse } from 'next/server';

import { handleDanglingRecoveryRequest } from '@/lib/dangling-recovery/recover';

export const maxDuration = 60;
// Cron からの呼び出しは都度 DB を見る必要があるため静的生成させない。
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleDanglingRecoveryRequest(req);
}
