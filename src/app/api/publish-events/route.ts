// ============================================================================
// src/app/api/publish-events/route.ts
// publish_events 集計 API — 観察ダッシュボード用
// 仕様: docs/optimized_spec.md §2.3 #8 / AC-P3-8〜P3-11
// ----------------------------------------------------------------------------
// GET /api/publish-events?range=24h|7d|30d
//   - 認証: Supabase auth (未認証 401)
//   - Service role で publish_events を集計:
//       * totalEvents   ... 全件カウント
//       * byAction      ... action 別カウント
//       * byHubStatus   ... hub_deploy_status 別カウント（NULL は 'unknown'）
//       * failedRecent  ... 失敗イベント直近 10 件
//   - 書き込みなし。既存 publish-control コアは触らない（読み取りのみ）。
// ============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type RangeKey = '24h' | '7d' | '30d';

const RANGE_TO_MS: Record<RangeKey, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function parseRange(raw: string | null): RangeKey {
  if (raw === '7d' || raw === '30d' || raw === '24h') return raw;
  return '24h';
}

interface PublishEventRow {
  id: number;
  article_id: string;
  action: string;
  hub_deploy_status: string | null;
  hub_deploy_error: string | null;
  actor_email: string | null;
  created_at: string;
}

export async function GET(req: NextRequest) {
  // 認証チェック
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const range = parseRange(url.searchParams.get('range'));
  const sinceIso = new Date(Date.now() - RANGE_TO_MS[range]).toISOString();

  const service = await createServiceRoleClient();

  // 集計用に全件 (id, action, hub_deploy_status) を取得
  // NOTE: publish_events は 1 記事あたり数イベント程度のため 30d でも件数は限定的。
  const { data: rows, error: aggErr } = await service
    .from('publish_events')
    .select('id, action, hub_deploy_status')
    .gte('created_at', sinceIso);

  if (aggErr) {
    return NextResponse.json(
      { error: 'failed to aggregate publish_events', detail: aggErr.message },
      { status: 500 },
    );
  }

  const totalEvents = rows?.length ?? 0;
  const byAction: Record<string, number> = {};
  const byHubStatus: Record<string, number> = {};

  for (const r of rows ?? []) {
    const action = r.action ?? 'unknown';
    byAction[action] = (byAction[action] ?? 0) + 1;

    const status = r.hub_deploy_status ?? 'unknown';
    byHubStatus[status] = (byHubStatus[status] ?? 0) + 1;
  }

  // 失敗イベント直近 10 件（hub_deploy_status = 'failed'）
  const { data: failedRecent, error: failErr } = await service
    .from('publish_events')
    .select('id, article_id, action, hub_deploy_error, actor_email, created_at')
    .eq('hub_deploy_status', 'failed')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(10);

  if (failErr) {
    return NextResponse.json(
      { error: 'failed to fetch failed events', detail: failErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    range,
    totalEvents,
    byAction,
    byHubStatus,
    failedRecent: (failedRecent ?? []) as PublishEventRow[],
  });
}
