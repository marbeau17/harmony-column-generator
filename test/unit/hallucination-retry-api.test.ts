// ============================================================================
// test/unit/hallucination-retry-api.test.ts
// POST /api/hallucination-retry の単体テスト
//
// 検証ケース:
//   1. token なし → 401
//   2. token 不一致 → 401
//   3. 0 件残存 → {retried:0, resolved:0, still_critical:0} 200
//   4. 3 件残存、1 件解決 → {retried:3, resolved:1, still_critical:2} 200
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { handleHallucinationRetryRequest } from '@/lib/hallucination-retry/retry';
import type { HallucinationCheckResult } from '@/lib/hallucination/run-checks';

const RETRY_TOKEN = 'test-retry-token-xyz';

/**
 * モック Supabase クライアントを組み立てる。
 *
 * 想定される呼び出しチェーン:
 *   - article_claims select→eq → Promise (article_id 列のみ)
 *   - articles       select→eq→eq→in→limit → Promise ({id, stage2_body_html})
 *   - articles       update→eq → Promise（hallucination_score 更新）
 */
function buildSupabaseMock(opts: {
  claimRows: Array<{ article_id: string }>;
  articleRows: Array<{ id: string; stage2_body_html: string }>;
  claimSelectError?: { message: string } | null;
  articleSelectError?: { message: string } | null;
  updateError?: { message: string } | null;
}) {
  const updateCalls: Array<{ payload: Record<string, unknown>; id: string }> = [];

  // article_claims select→eq(risk, 'critical') → Promise
  const claimEq = vi.fn(async () => ({
    data: opts.claimSelectError ? null : opts.claimRows,
    error: opts.claimSelectError ?? null,
  }));
  const claimSelect = vi.fn(() => ({ eq: claimEq }));

  // articles select→eq(status)→eq(is_hub_visible)→in(id)→limit
  const articleLimit = vi.fn(async () => ({
    data: opts.articleSelectError ? null : opts.articleRows,
    error: opts.articleSelectError ?? null,
  }));
  const articleIn = vi.fn(() => ({ limit: articleLimit }));
  const articleEq2 = vi.fn(() => ({ in: articleIn }));
  const articleEq1 = vi.fn(() => ({ eq: articleEq2 }));
  const articleSelect = vi.fn(() => ({ eq: articleEq1 }));

  // articles update→eq(id) → Promise
  const updateEq = vi.fn(async () => ({
    data: null,
    error: opts.updateError ?? null,
  }));
  const updateFn = vi.fn((payload: Record<string, unknown>) => {
    return {
      eq: (_col: string, value: string) => {
        updateCalls.push({ payload, id: value });
        return updateEq();
      },
    };
  });

  const fromFn = vi.fn((table: string) => {
    if (table === 'article_claims') {
      return { select: claimSelect };
    }
    if (table === 'articles') {
      return { select: articleSelect, update: updateFn };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return {
    rawClient: { from: fromFn },
    calls: {
      from: fromFn,
      claimSelect,
      claimEq,
      articleSelect,
      articleEq1,
      articleEq2,
      articleIn,
      articleLimit,
      updateFn,
      updateCalls,
    },
  };
}

function makeReq(token: string | null): NextRequest {
  const headers = new Headers();
  if (token !== null) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest(
    new Request('http://localhost/api/hallucination-retry', {
      method: 'POST',
      headers,
      body: '{}',
    }),
  );
}

/** runHallucinationChecks の戻り値を生成するヘルパ。 */
function makeCheckResult(criticals: number, score = 80): HallucinationCheckResult {
  return {
    hallucination_score: score,
    criticals,
    claims: [],
    results: [],
    summary: {
      total: 0,
      grounded: 0,
      weak: 0,
      unsupported: 0,
      flagged: 0,
      critical_hits: criticals,
    },
  };
}

describe('POST /api/hallucination-retry', () => {
  beforeEach(() => {
    process.env.HALLUCINATION_RETRY_TOKEN = RETRY_TOKEN;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── 401 ────────────────────────────────────────────────────────────────

  it('401 を返す — Authorization ヘッダが無い (token なし)', async () => {
    const mock = buildSupabaseMock({ claimRows: [], articleRows: [] });
    const runChecks = vi.fn();

    const res = await handleHallucinationRetryRequest(
      makeReq(null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => mock.rawClient as any,
      runChecks,
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/);
    // 認可前に DB / runChecks は呼ばれない
    expect(mock.calls.from).not.toHaveBeenCalled();
    expect(runChecks).not.toHaveBeenCalled();
  });

  it('401 を返す — トークン不一致', async () => {
    const mock = buildSupabaseMock({ claimRows: [], articleRows: [] });
    const runChecks = vi.fn();

    const res = await handleHallucinationRetryRequest(
      makeReq('wrong-token'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => mock.rawClient as any,
      runChecks,
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/);
    expect(mock.calls.from).not.toHaveBeenCalled();
    expect(runChecks).not.toHaveBeenCalled();
  });

  // ─── 0 件残存 ───────────────────────────────────────────────────────────

  it('200 で {retried:0, resolved:0, still_critical:0} を返す — 0 件残存', async () => {
    const mock = buildSupabaseMock({ claimRows: [], articleRows: [] });
    const runChecks = vi.fn();

    const res = await handleHallucinationRetryRequest(
      makeReq(RETRY_TOKEN),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => mock.rawClient as any,
      runChecks,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ retried: 0, resolved: 0, still_critical: 0 });

    // article_claims SELECT のみ発火、後続は短絡
    expect(mock.calls.claimSelect).toHaveBeenCalledTimes(1);
    expect(mock.calls.articleSelect).not.toHaveBeenCalled();
    expect(runChecks).not.toHaveBeenCalled();
    expect(mock.calls.updateFn).not.toHaveBeenCalled();
  });

  // ─── 3 件残存、1 件解決 ─────────────────────────────────────────────────

  it('200 で {retried:3, resolved:1, still_critical:2} を返す — 3 件中 1 件のみ critical 解消', async () => {
    const ids = [
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
    ];
    const mock = buildSupabaseMock({
      claimRows: ids.map((id) => ({ article_id: id })),
      articleRows: ids.map((id) => ({
        id,
        stage2_body_html: `<p>article ${id}</p>`,
      })),
    });

    // 1 件目のみ criticals=0（解決）、残り 2 件は criticals>0
    const runChecks = vi
      .fn(async (_html: string): Promise<HallucinationCheckResult> => makeCheckResult(0))
      .mockResolvedValueOnce(makeCheckResult(0, 92)) // resolved
      .mockResolvedValueOnce(makeCheckResult(2, 60)) // still critical
      .mockResolvedValueOnce(makeCheckResult(1, 70)); // still critical

    const res = await handleHallucinationRetryRequest(
      makeReq(RETRY_TOKEN),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => mock.rawClient as any,
      runChecks,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ retried: 3, resolved: 1, still_critical: 2 });

    // runChecks は 3 回呼ばれた
    expect(runChecks).toHaveBeenCalledTimes(3);
    expect(runChecks).toHaveBeenNthCalledWith(1, `<p>article ${ids[0]}</p>`);

    // UPDATE は解決した 1 件のみ
    expect(mock.calls.updateFn).toHaveBeenCalledTimes(1);
    expect(mock.calls.updateCalls).toHaveLength(1);
    expect(mock.calls.updateCalls[0].id).toBe(ids[0]);
    expect(mock.calls.updateCalls[0].payload).toEqual({
      hallucination_score: 92,
    });
    // 本文への write が含まれていないことを明示確認
    expect(mock.calls.updateCalls[0].payload).not.toHaveProperty(
      'stage2_body_html',
    );
    expect(mock.calls.updateCalls[0].payload).not.toHaveProperty('title');

    // articles SELECT は status='published' AND is_hub_visible=false で絞られる
    // （eq が 2 段、in が 1 段、limit が末端）
    expect(mock.calls.articleEq1).toHaveBeenCalledWith('status', 'published');
    expect(mock.calls.articleEq2).toHaveBeenCalledWith('is_hub_visible', false);
    expect(mock.calls.articleIn).toHaveBeenCalledWith('id', ids);
  });
});
