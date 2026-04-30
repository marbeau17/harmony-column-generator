// ============================================================================
// src/app/api/publish-events/route.ts
// publish_events 集計 API — 観察ダッシュボード用
// 仕様: docs/optimized_spec.md §2.3 #8 / AC-P3-8〜P3-11
// ----------------------------------------------------------------------------
// GET /api/publish-events?range=24h|7d|30d&include=hallucination,tone
//   - 認証: Supabase auth (未認証 401)
//   - Service role で publish_events を集計:
//       * totalEvents   ... 全件カウント
//       * byAction      ... action 別カウント
//       * byHubStatus   ... hub_deploy_status 別カウント（NULL は 'unknown'）
//       * failedRecent  ... 失敗イベント直近 10 件
//   - include=hallucination が指定された場合の追加データ:
//       * hallucination.avgScore         ... 全記事の hallucination_score 平均
//       * hallucination.criticalCount    ... critical claim 残存記事数
//       * hallucination.criticalArticles ... 残存記事一覧（score 降順、最大 10 件）
//   - include=tone が指定された場合の追加データ:
//       * tone.avgScore        ... 全記事の yukiko_tone_score 平均
//       * tone.lowCount        ... yukiko_tone_score < 0.80 の記事数
//       * tone.lowArticles     ... 低トーン記事一覧（score 昇順、最大 10 件）
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

const TONE_LOW_THRESHOLD = 0.8;

function parseRange(raw: string | null): RangeKey {
  if (raw === '7d' || raw === '30d' || raw === '24h') return raw;
  return '24h';
}

function parseInclude(raw: string | null): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
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

interface HallucinationArticleRow {
  id: string;
  title: string | null;
  hallucination_score: number | null;
}

interface ToneArticleRow {
  id: string;
  title: string | null;
  yukiko_tone_score: number | null;
}

interface HallucinationSummary {
  avgScore: number | null;
  criticalCount: number;
  criticalArticles: HallucinationArticleRow[];
}

interface ToneSummary {
  avgScore: number | null;
  lowCount: number;
  lowArticles: ToneArticleRow[];
}

/**
 * ハルシネーション集計を取得する。
 * - 全 articles から hallucination_score 平均を算出
 * - critical risk を持つ article_id 集合を取得
 * - critical を持つ記事のうち hallucination_score 降順で最大 10 件を返却
 */
async function aggregateHallucination(
  service: Awaited<ReturnType<typeof createServiceRoleClient>>,
): Promise<HallucinationSummary> {
  // 全記事の hallucination_score を取得して平均を算出
  const { data: allRows, error: allErr } = await service
    .from('articles')
    .select('hallucination_score');

  if (allErr) {
    throw new Error(`failed to fetch hallucination_score: ${allErr.message}`);
  }

  const scores = (allRows ?? [])
    .map((r) => (r as { hallucination_score: number | null }).hallucination_score)
    .filter((v): v is number => typeof v === 'number');
  const avgScore =
    scores.length === 0
      ? null
      : Math.round(
          (scores.reduce((a, b) => a + b, 0) / scores.length) * 10000,
        ) / 10000;

  // critical claim を持つ article_id を取得
  const { data: criticalClaims, error: claimsErr } = await service
    .from('article_claims')
    .select('article_id')
    .eq('risk', 'critical');

  if (claimsErr) {
    throw new Error(`failed to fetch critical claims: ${claimsErr.message}`);
  }

  const criticalArticleIds = Array.from(
    new Set(
      (criticalClaims ?? []).map(
        (r) => (r as { article_id: string }).article_id,
      ),
    ),
  );
  const criticalCount = criticalArticleIds.length;

  let criticalArticles: HallucinationArticleRow[] = [];
  if (criticalArticleIds.length > 0) {
    const { data: articleRows, error: articleErr } = await service
      .from('articles')
      .select('id, title, hallucination_score')
      .in('id', criticalArticleIds)
      .order('hallucination_score', { ascending: false, nullsFirst: false })
      .limit(10);

    if (articleErr) {
      throw new Error(`failed to fetch critical articles: ${articleErr.message}`);
    }
    criticalArticles = (articleRows ?? []) as HallucinationArticleRow[];
  }

  return { avgScore, criticalCount, criticalArticles };
}

/**
 * 由起子トーン集計を取得する。
 * - 全 articles から yukiko_tone_score 平均を算出
 * - tone < 0.80 の記事を score 昇順で最大 10 件返却
 */
async function aggregateTone(
  service: Awaited<ReturnType<typeof createServiceRoleClient>>,
): Promise<ToneSummary> {
  const { data: allRows, error: allErr } = await service
    .from('articles')
    .select('yukiko_tone_score');

  if (allErr) {
    throw new Error(`failed to fetch yukiko_tone_score: ${allErr.message}`);
  }

  const scores = (allRows ?? [])
    .map((r) => (r as { yukiko_tone_score: number | null }).yukiko_tone_score)
    .filter((v): v is number => typeof v === 'number');
  const avgScore =
    scores.length === 0
      ? null
      : Math.round(
          (scores.reduce((a, b) => a + b, 0) / scores.length) * 10000,
        ) / 10000;
  const lowCount = scores.filter((v) => v < TONE_LOW_THRESHOLD).length;

  // 低トーン記事一覧（昇順、最大 10 件）
  const { data: lowRows, error: lowErr } = await service
    .from('articles')
    .select('id, title, yukiko_tone_score')
    .lt('yukiko_tone_score', TONE_LOW_THRESHOLD)
    .order('yukiko_tone_score', { ascending: true, nullsFirst: false })
    .limit(10);

  if (lowErr) {
    throw new Error(`failed to fetch low-tone articles: ${lowErr.message}`);
  }

  const lowArticles = (lowRows ?? []) as ToneArticleRow[];
  return { avgScore, lowCount, lowArticles };
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
  const include = parseInclude(url.searchParams.get('include'));
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

  // 拡張集計（include パラメータ次第で付与）
  let hallucination: HallucinationSummary | undefined;
  let tone: ToneSummary | undefined;
  try {
    if (include.has('hallucination')) {
      hallucination = await aggregateHallucination(service);
    }
    if (include.has('tone')) {
      tone = await aggregateTone(service);
    }
  } catch (e: unknown) {
    return NextResponse.json(
      {
        error: 'failed to aggregate extended metrics',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    range,
    totalEvents,
    byAction,
    byHubStatus,
    failedRecent: (failedRecent ?? []) as PublishEventRow[],
    ...(hallucination !== undefined ? { hallucination } : {}),
    ...(tone !== undefined ? { tone } : {}),
  });
}
