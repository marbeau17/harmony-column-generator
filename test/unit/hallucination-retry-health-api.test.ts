// ============================================================================
// test/unit/hallucination-retry-health-api.test.ts
// GET /api/hallucination-retry/health の単体テスト
//
// 検証ケース:
//   1. 認証なし (Authorization ヘッダ無し)            → 401
//   2. 認証なし (トークン不一致)                       → 401
//   3. 正常系 (last_run_at が 1h 前)                   → status:'ok'
//   4. last_run_at が 13h 前                           → status:'stale'
//   5. last_run_at が無い (publish_events 空)         → status:'never_run'
//   6. critical_remaining 集計 (claim 3 件 → COUNT=2) → critical_remaining:2
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import {
  deriveHealth,
  handleHealthRequest,
} from '@/lib/hallucination-retry/health';

const RETRY_TOKEN = 'test-retry-token-xyz';

// ─── モック組立 ───────────────────────────────────────────────────────────────

/**
 * health エンドポイントが内部で叩く Supabase 呼び出しチェーンを丸ごとモック化する。
 *
 * 想定チェーン:
 *   - publish_events: select → eq('action', 'hallucination-retry') → order → limit
 *   - article_claims: select → eq('risk', 'critical')
 *   - articles      : select(head:true, count:'exact') → eq → eq → in
 */
function buildSupabaseMock(opts: {
  /** publish_events から最新 1 件として返す行（無ければ空配列扱い） */
  lastRunRow?: { created_at: string } | null;
  /** article_claims が返す行 */
  claimRows?: Array<{ article_id: string }>;
  /** articles の count 結果 */
  articlesCount?: number;
  publishEventsError?: { message: string } | null;
  claimSelectError?: { message: string } | null;
  articlesCountError?: { message: string } | null;
}) {
  // ─── publish_events: select → eq → order → limit ────────────────────────
  const publishLimit = vi.fn(async () => ({
    data: opts.publishEventsError
      ? null
      : opts.lastRunRow
        ? [opts.lastRunRow]
        : [],
    error: opts.publishEventsError ?? null,
  }));
  const publishOrder = vi.fn(() => ({ limit: publishLimit }));
  const publishEq = vi.fn(() => ({ order: publishOrder }));
  const publishSelect = vi.fn(() => ({ eq: publishEq }));

  // ─── article_claims: select → eq ─────────────────────────────────────────
  const claimEq = vi.fn(async () => ({
    data: opts.claimSelectError ? null : (opts.claimRows ?? []),
    error: opts.claimSelectError ?? null,
  }));
  const claimSelect = vi.fn(() => ({ eq: claimEq }));

  // ─── articles: select(head:true) → eq → eq → in ─────────────────────────
  const articlesIn = vi.fn(async () => ({
    data: null,
    count: opts.articlesCountError ? null : (opts.articlesCount ?? 0),
    error: opts.articlesCountError ?? null,
  }));
  const articlesEq2 = vi.fn(() => ({ in: articlesIn }));
  const articlesEq1 = vi.fn(() => ({ eq: articlesEq2 }));
  const articlesSelect = vi.fn(() => ({ eq: articlesEq1 }));

  const fromFn = vi.fn((table: string) => {
    if (table === 'publish_events') return { select: publishSelect };
    if (table === 'article_claims') return { select: claimSelect };
    if (table === 'articles') return { select: articlesSelect };
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    rawClient: { from: fromFn },
    calls: {
      from: fromFn,
      publishSelect,
      publishEq,
      publishOrder,
      publishLimit,
      claimSelect,
      claimEq,
      articlesSelect,
      articlesEq1,
      articlesEq2,
      articlesIn,
    },
  };
}

function makeReq(token: string | null): NextRequest {
  const headers = new Headers();
  if (token !== null) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest(
    new Request('http://localhost/api/hallucination-retry/health', {
      method: 'GET',
      headers,
    }),
  );
}

// ─── deriveHealth 単体（純粋関数） ──────────────────────────────────────────

describe('deriveHealth (pure)', () => {
  const NOW = Date.parse('2026-04-24T12:00:00.000Z');

  it('last_run_at が null → never_run / next_run_estimate も null', () => {
    expect(deriveHealth(null, NOW)).toEqual({
      status: 'never_run',
      nextRunEstimate: null,
    });
  });

  it('last_run_at が 1h 前 → ok / next は last+6h', () => {
    const last = new Date(NOW - 1 * 60 * 60 * 1000).toISOString();
    const r = deriveHealth(last, NOW);
    expect(r.status).toBe('ok');
    expect(r.nextRunEstimate).toBe(
      new Date(Date.parse(last) + 6 * 60 * 60 * 1000).toISOString(),
    );
  });

  it('last_run_at が 12h 以上前 → stale', () => {
    const last = new Date(NOW - 13 * 60 * 60 * 1000).toISOString();
    expect(deriveHealth(last, NOW).status).toBe('stale');
  });

  it('last_run_at が境界値 (=12h) → stale', () => {
    const last = new Date(NOW - 12 * 60 * 60 * 1000).toISOString();
    expect(deriveHealth(last, NOW).status).toBe('stale');
  });

  it('last_run_at が壊れた文字列 → never_run', () => {
    expect(deriveHealth('not-a-date', NOW).status).toBe('never_run');
  });
});

// ─── HTTP ハンドラ ──────────────────────────────────────────────────────────

describe('GET /api/hallucination-retry/health', () => {
  beforeEach(() => {
    process.env.HALLUCINATION_RETRY_TOKEN = RETRY_TOKEN;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── 401 ────────────────────────────────────────────────────────────────

  it('401 を返す — Authorization ヘッダが無い', async () => {
    const mock = buildSupabaseMock({});
    const res = await handleHealthRequest(
      makeReq(null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => mock.rawClient as any,
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/);
    // 認可前に DB は叩かれない
    expect(mock.calls.from).not.toHaveBeenCalled();
  });

  it('401 を返す — Bearer トークン不一致', async () => {
    const mock = buildSupabaseMock({});
    const res = await handleHealthRequest(
      makeReq('wrong-token'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => mock.rawClient as any,
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/);
    expect(mock.calls.from).not.toHaveBeenCalled();
  });

  // ─── 200 / status:'ok' ──────────────────────────────────────────────────

  it("200 で status:'ok' を返す — last_run_at が 1h 前 / critical=2", async () => {
    const NOW = Date.parse('2026-04-24T12:00:00.000Z');
    const lastIso = new Date(NOW - 1 * 60 * 60 * 1000).toISOString();
    const mock = buildSupabaseMock({
      lastRunRow: { created_at: lastIso },
      claimRows: [
        { article_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
        { article_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
        { article_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc' },
      ],
      articlesCount: 2,
    });

    const res = await handleHealthRequest(
      makeReq(RETRY_TOKEN),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => mock.rawClient as any,
      NOW,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      status: 'ok',
      last_run_at: lastIso,
      critical_remaining: 2,
      next_run_estimate: new Date(
        Date.parse(lastIso) + 6 * 60 * 60 * 1000,
      ).toISOString(),
    });

    // publish_events は action='hallucination-retry' で絞られる
    expect(mock.calls.publishEq).toHaveBeenCalledWith(
      'action',
      'hallucination-retry',
    );

    // articles は status='published' AND is_hub_visible=false AND id IN (...) で絞られる
    expect(mock.calls.articlesEq1).toHaveBeenCalledWith('status', 'published');
    expect(mock.calls.articlesEq2).toHaveBeenCalledWith('is_hub_visible', false);
    expect(mock.calls.articlesIn).toHaveBeenCalledTimes(1);
  });

  // ─── 200 / status:'stale' ───────────────────────────────────────────────

  it("200 で status:'stale' を返す — last_run_at が 13h 前", async () => {
    const NOW = Date.parse('2026-04-24T12:00:00.000Z');
    const lastIso = new Date(NOW - 13 * 60 * 60 * 1000).toISOString();
    const mock = buildSupabaseMock({
      lastRunRow: { created_at: lastIso },
      claimRows: [],
      articlesCount: 0,
    });

    const res = await handleHealthRequest(
      makeReq(RETRY_TOKEN),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => mock.rawClient as any,
      NOW,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('stale');
    expect(body.last_run_at).toBe(lastIso);
    expect(body.critical_remaining).toBe(0);
    // claim が空なら articles の COUNT クエリは打たれない（短絡）
    expect(mock.calls.articlesSelect).not.toHaveBeenCalled();
  });

  // ─── 200 / status:'never_run' ───────────────────────────────────────────

  it("200 で status:'never_run' を返す — publish_events に該当行が無い", async () => {
    const NOW = Date.parse('2026-04-24T12:00:00.000Z');
    const mock = buildSupabaseMock({
      lastRunRow: null,
      claimRows: [],
      articlesCount: 0,
    });

    const res = await handleHealthRequest(
      makeReq(RETRY_TOKEN),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => mock.rawClient as any,
      NOW,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      status: 'never_run',
      last_run_at: null,
      critical_remaining: 0,
      next_run_estimate: null,
    });
  });
});
