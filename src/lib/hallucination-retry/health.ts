// ============================================================================
// src/lib/hallucination-retry/health.ts
// hallucination-retry cron の health check 実装本体。
//
// Next.js App Router の route ファイルでは限定的な named export しか許可されない
// ため、純粋ロジック / DI / 型を本ファイルに切り出し、route.ts は GET ハンドラから
// `handleHealthRequest` を呼ぶだけに留める。
//
// 絶対ルール:
//   - publish-control コア / hallucination-retry/retry.ts は変更しない
//   - 記事本文 (stage2_body_html / title) や article_revisions への write は禁止
//   - 仕様書 / progress.md / eval_report.md への書込みは行わない
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ─── 定数 ────────────────────────────────────────────────────────────────────

/** stale 判定閾値（last_run_at がこれ以上前なら 'stale'）。 */
export const STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000;

/** 次回 cron 実行見込みオフセット（last_run_at + 6h）。 */
export const NEXT_RUN_OFFSET_MS = 6 * 60 * 60 * 1000;

// ─── DI 用ファクトリ ─────────────────────────────────────────────────────────

export type SupabaseFactory = () => SupabaseClient;

export const defaultSupabaseFactory: SupabaseFactory = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase service-role credentials are not configured');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

// ─── 型 ──────────────────────────────────────────────────────────────────────

export type HealthStatus = 'ok' | 'stale' | 'never_run';

export interface HealthResponse {
  status: HealthStatus;
  last_run_at: string | null;
  critical_remaining: number;
  next_run_estimate: string | null;
}

// ─── 集計ロジック ────────────────────────────────────────────────────────────

/**
 * publish_events から action='hallucination-retry' の最新 created_at を取得。
 * 該当が無ければ null。
 */
async function fetchLastRunAt(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('publish_events')
    // guard-approved: read-only select for hallucination-retry health check
    .select('created_at')
    .eq('action', 'hallucination-retry')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`select publish_events failed: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{ created_at: string | null }>;
  if (rows.length === 0) return null;
  const ts = rows[0]?.created_at;
  return typeof ts === 'string' && ts.length > 0 ? ts : null;
}

/**
 * critical claim を保持する未公開記事数を返す。
 * src/lib/hallucination-retry/retry.ts の fetchCandidates と同じ抽出条件。
 *   (a) article_claims から risk='critical' の article_id 集合
 *   (b) articles を id IN (...) AND status='published' AND is_hub_visible=false で COUNT
 */
async function fetchCriticalRemaining(
  supabase: SupabaseClient,
): Promise<number> {
  const { data: claimRows, error: claimErr } = await supabase
    .from('article_claims')
    // guard-approved: read-only select for hallucination-retry health check
    .select('article_id')
    .eq('risk', 'critical');

  if (claimErr) {
    throw new Error(`select article_claims failed: ${claimErr.message}`);
  }

  const ids = Array.from(
    new Set(
      ((claimRows ?? []) as Array<{ article_id: string | null }>)
        .map((r) => r.article_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  );

  if (ids.length === 0) return 0;

  const { count, error: artErr } = await supabase
    .from('articles')
    // guard-approved: read-only count for hallucination-retry health check
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .eq('is_hub_visible', false)
    .in('id', ids);

  if (artErr) {
    throw new Error(`count articles failed: ${artErr.message}`);
  }

  return typeof count === 'number' ? count : 0;
}

/** last_run_at から status / next_run_estimate を導出する純粋関数。 */
export function deriveHealth(
  lastRunAt: string | null,
  nowMs: number = Date.now(),
): { status: HealthStatus; nextRunEstimate: string | null } {
  if (lastRunAt === null) {
    return { status: 'never_run', nextRunEstimate: null };
  }
  const lastMs = Date.parse(lastRunAt);
  if (Number.isNaN(lastMs)) {
    return { status: 'never_run', nextRunEstimate: null };
  }
  const nextRunEstimate = new Date(lastMs + NEXT_RUN_OFFSET_MS).toISOString();
  const status: HealthStatus =
    nowMs - lastMs >= STALE_THRESHOLD_MS ? 'stale' : 'ok';
  return { status, nextRunEstimate };
}

// ─── HTTP ハンドラ ───────────────────────────────────────────────────────────

/**
 * Bearer token を検証し、health 集計を返す。
 * テストから supabase ファクトリと nowMs を差し替え可能。
 */
export async function handleHealthRequest(
  req: NextRequest,
  factory: SupabaseFactory = defaultSupabaseFactory,
  nowMs: number = Date.now(),
): Promise<NextResponse> {
  const expectedToken = process.env.HALLUCINATION_RETRY_TOKEN;
  if (!expectedToken) {
    return NextResponse.json(
      { error: 'retry token not configured' },
      { status: 500 },
    );
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/.exec(authHeader);
  if (!match || match[1] !== expectedToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const supabase = factory();
    const [lastRunAt, criticalRemaining] = await Promise.all([
      fetchLastRunAt(supabase),
      fetchCriticalRemaining(supabase),
    ]);
    const { status, nextRunEstimate } = deriveHealth(lastRunAt, nowMs);
    const body: HealthResponse = {
      status,
      last_run_at: lastRunAt,
      critical_remaining: criticalRemaining,
      next_run_estimate: nextRunEstimate,
    };
    return NextResponse.json(body, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'health check failed', detail: msg },
      { status: 500 },
    );
  }
}
