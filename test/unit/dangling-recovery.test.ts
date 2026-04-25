import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { handleDanglingRecoveryRequest } from '@/lib/dangling-recovery/recover';

/**
 * AC-P3-4 / AC-P3-6 / AC-P3-7:
 * dangling-deploying 自動回復 API の振る舞いを Supabase クライアントをモックして検証する。
 *
 * - token 認証（未設定 / 不一致 / 一致）
 * - 0 件ヒットの短絡
 * - 3 件ヒット時の articles UPDATE と publish_events INSERT
 * - SELECT 失敗時の 500
 */

const RECOVERY_TOKEN = 'test-recovery-token-xyz';

/**
 * モック Supabase クライアントを 1 個組み立てる。
 * SELECT は `select→eq→lt→limit` の最後で Promise を返すため、limit() を thenable にする。
 * UPDATE は `update→eq→eq` が最後の eq で Promise を返す。
 * INSERT は `insert(...)` で直接 Promise を返す。
 */
function buildSupabaseMock(opts: {
  selectRows: Array<{ id: string; visibility_updated_at: string }>;
  selectError?: { message: string } | null;
  updateError?: { message: string } | null;
  insertError?: { message: string } | null;
}) {
  const updateCalls: Array<Record<string, unknown>> = [];
  const insertCalls: Array<Record<string, unknown>> = [];
  const selectFilters: Array<{ column: string; value: unknown; op: string }> = [];

  const selectLimit = vi.fn(async () => ({
    data: opts.selectError ? null : opts.selectRows,
    error: opts.selectError ?? null,
  }));
  const selectLt = vi.fn(() => ({ limit: selectLimit }));
  const selectEq = vi.fn((column: string, value: unknown) => {
    selectFilters.push({ column, value, op: 'eq' });
    return { lt: selectLt };
  });
  const selectFn = vi.fn(() => ({ eq: selectEq }));

  const updateEq2 = vi.fn(async () => ({ data: null, error: opts.updateError ?? null }));
  const updateEq1 = vi.fn(() => ({ eq: updateEq2 }));
  const updateFn = vi.fn((payload: Record<string, unknown>) => {
    updateCalls.push(payload);
    return { eq: updateEq1 };
  });

  const insertFn = vi.fn(async (payload: Record<string, unknown>) => {
    insertCalls.push(payload);
    return { data: null, error: opts.insertError ?? null };
  });

  const fromFn = vi.fn((_table: string) => ({
    select: selectFn,
    update: updateFn,
    insert: insertFn,
  }));

  return {
    client: { from: fromFn } as unknown as Parameters<typeof handleDanglingRecoveryRequest>[1] extends (
      ...args: infer _A
    ) => infer _R
      ? never
      : never,
    // 実際には上の型は使わず、any でファクトリに渡す
    rawClient: { from: fromFn },
    calls: {
      from: fromFn,
      select: selectFn,
      update: updateFn,
      insert: insertFn,
      updateCalls,
      insertCalls,
      selectFilters,
    },
  };
}

function makeReq(token: string | null): NextRequest {
  const headers = new Headers();
  if (token !== null) headers.set('authorization', `Bearer ${token}`);
  // NextRequest は Request を継承。URL はダミーで良い。
  return new NextRequest(new Request('http://localhost/api/dangling-recovery', {
    method: 'POST',
    headers,
    body: '{}',
  }));
}

describe('POST /api/dangling-recovery', () => {
  beforeEach(() => {
    process.env.DANGLING_RECOVERY_TOKEN = RECOVERY_TOKEN;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('401 を返す — Authorization ヘッダが無い', async () => {
    const mock = buildSupabaseMock({ selectRows: [] });
    const res = await handleDanglingRecoveryRequest(
      makeReq(null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => mock.rawClient as any,
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/);
    expect(mock.calls.from).not.toHaveBeenCalled();
  });

  it('401 を返す — トークン不一致', async () => {
    const mock = buildSupabaseMock({ selectRows: [] });
    const res = await handleDanglingRecoveryRequest(
      makeReq('wrong-token'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => mock.rawClient as any,
    );
    expect(res.status).toBe(401);
    expect(mock.calls.from).not.toHaveBeenCalled();
  });

  it('500 を返す — DANGLING_RECOVERY_TOKEN 未設定', async () => {
    delete process.env.DANGLING_RECOVERY_TOKEN;
    const mock = buildSupabaseMock({ selectRows: [] });
    const res = await handleDanglingRecoveryRequest(
      makeReq(RECOVERY_TOKEN),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => mock.rawClient as any,
    );
    expect(res.status).toBe(500);
  });

  it('200 で {recovered:0, ids:[]} を返す — 対象 0 件', async () => {
    const mock = buildSupabaseMock({ selectRows: [] });
    const res = await handleDanglingRecoveryRequest(
      makeReq(RECOVERY_TOKEN),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => mock.rawClient as any,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ recovered: 0, ids: [] });
    // articles SELECT のみ、UPDATE / INSERT は未発火
    expect(mock.calls.update).not.toHaveBeenCalled();
    expect(mock.calls.insert).not.toHaveBeenCalled();
    // SELECT が visibility_state='deploying' でフィルタされていること
    expect(
      mock.calls.selectFilters.some(
        (f) => f.column === 'visibility_state' && f.value === 'deploying' && f.op === 'eq',
      ),
    ).toBe(true);
  });

  it('200 で {recovered:3, ids:[...]} を返す — 3 件回復', async () => {
    const now = new Date('2026-04-24T12:00:00Z');
    const old = new Date(now.getTime() - 120_000).toISOString(); // 120 秒前
    const rows = [
      { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', visibility_updated_at: old },
      { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', visibility_updated_at: old },
      { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', visibility_updated_at: old },
    ];
    const mock = buildSupabaseMock({ selectRows: rows });

    const res = await handleDanglingRecoveryRequest(
      makeReq(RECOVERY_TOKEN),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => mock.rawClient as any,
      now,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recovered).toBe(3);
    expect(body.ids).toEqual(rows.map((r) => r.id));

    // UPDATE が 3 回、INSERT が 3 回
    expect(mock.calls.update).toHaveBeenCalledTimes(3);
    expect(mock.calls.insert).toHaveBeenCalledTimes(3);

    // UPDATE の payload: visibility_state='failed' が固定で入っていること
    for (const payload of mock.calls.updateCalls) {
      expect(payload.visibility_state).toBe('failed');
      expect(typeof payload.visibility_updated_at).toBe('string');
    }

    // publish_events INSERT の内容
    for (const payload of mock.calls.insertCalls) {
      expect(payload.action).toBe('dangling-recovery');
      expect(payload.actor_email).toBe('system');
      // ULID は 26 文字の Crockford Base32
      expect(String(payload.request_id)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i);
      // reason に経過秒が含まれる
      expect(String(payload.reason)).toMatch(/dangling-deploying recovered after \d+s/);
    }
  });

  it('500 を返す — SELECT で DB エラー', async () => {
    const mock = buildSupabaseMock({
      selectRows: [],
      selectError: { message: 'connection refused' },
    });
    const res = await handleDanglingRecoveryRequest(
      makeReq(RECOVERY_TOKEN),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => mock.rawClient as any,
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/recovery failed/);
    expect(body.detail).toMatch(/connection refused/);
  });
});
