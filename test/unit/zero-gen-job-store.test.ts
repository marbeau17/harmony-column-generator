// ============================================================================
// test/unit/zero-gen-job-store.test.ts
// Supabase 共有ストア化後 (P5-22) の zero-gen-job-store ユニットテスト。
//
// 仕組み: createServiceRoleClient をモックし、in-memory の擬似テーブルで
// upsert/select/delete を実装。これで Supabase 接続なしに store の挙動を検証。
// ============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── 擬似テーブル ────────────────────────────────────────────────────────────
// テスト中の generation_jobs 行を保持。各テスト先頭でリセット。
let table: Map<string, Record<string, unknown>> = new Map();

const mockUpsert = vi.fn(async (
  payload: Record<string, unknown>,
  _opts: { onConflict?: string } = {},
) => {
  const id = payload.id as string;
  const existing = table.get(id) ?? {
    id,
    user_id: null,
    stage: 'queued',
    progress: 0,
    eta_seconds: 0,
    error: null,
    article_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const merged = { ...existing, ...payload };
  table.set(id, merged);
  return { data: merged, error: null };
});

const mockSelectEq = vi.fn(async (id: string) => {
  const row = table.get(id);
  return { data: row ?? null, error: null };
});

const mockDeleteEq = vi.fn(async (id: string) => {
  table.delete(id);
  return { data: null, error: null };
});

// chainable builder
function buildQuery() {
  return {
    upsert: (payload: Record<string, unknown>, opts?: { onConflict?: string }) => {
      const promise = mockUpsert(payload, opts ?? {});
      return Object.assign(promise, {
        select: () => ({
          single: async () => promise,
        }),
      });
    },
    select: (_cols?: string) => ({
      eq: (_col: string, val: string) => ({
        maybeSingle: () => mockSelectEq(val),
      }),
    }),
    delete: () => ({
      eq: (_col: string, val: string) => mockDeleteEq(val),
    }),
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: async () => ({
    from: (_table: string) => buildQuery(),
  }),
}));

// import after mock
const {
  createJobState,
  updateJobState,
  getJobState,
  clearJobState,
  __resetMemStoreForTests,
} = await import('@/lib/jobs/zero-gen-job-store');

beforeEach(() => {
  table = new Map();
  __resetMemStoreForTests();
  mockUpsert.mockClear();
  mockSelectEq.mockClear();
  mockDeleteEq.mockClear();
});

describe('createJobState', () => {
  it('queued 状態で初期化される', async () => {
    const state = await createJobState('aaaa1111-1111-1111-1111-111111111111');
    expect(state.stage).toBe('queued');
    expect(state.progress).toBe(0);
    expect(state.eta_seconds).toBe(0);
  });

  it('upsert がコールされる', async () => {
    await createJobState('aaaa2222-2222-2222-2222-222222222222');
    expect(mockUpsert).toHaveBeenCalledOnce();
  });
});

describe('updateJobState', () => {
  it('部分更新が反映される', async () => {
    await createJobState('bbbb1111-1111-1111-1111-111111111111');
    const updated = await updateJobState('bbbb1111-1111-1111-1111-111111111111', {
      stage: 'stage2',
      progress: 0.4,
      eta_seconds: 50,
    });
    expect(updated.stage).toBe('stage2');
    expect(updated.progress).toBe(0.4);
    expect(updated.eta_seconds).toBe(50);
  });

  it('progress が 0..1 にクランプされる', async () => {
    const upper = await updateJobState('cccc1111-1111-1111-1111-111111111111', {
      progress: 5,
    });
    expect(upper.progress).toBe(1);
    const lower = await updateJobState('cccc2222-2222-2222-2222-222222222222', {
      progress: -3,
    });
    expect(lower.progress).toBe(0);
  });

  it('eta_seconds 負値は 0', async () => {
    const r = await updateJobState('dddd1111-1111-1111-1111-111111111111', {
      eta_seconds: -10,
    });
    expect(r.eta_seconds).toBe(0);
  });

  it('error / article_id を渡すと反映', async () => {
    const r = await updateJobState('eeee1111-1111-1111-1111-111111111111', {
      stage: 'done',
      article_id: 'aaaa',
    });
    expect(r.article_id).toBe('aaaa');
    const f = await updateJobState('ffff1111-1111-1111-1111-111111111111', {
      stage: 'failed',
      error: 'oops',
    });
    expect(f.error).toBe('oops');
  });
});

describe('getJobState', () => {
  it('存在しない id は null', async () => {
    const r = await getJobState('99999999-9999-4999-8999-999999999999');
    expect(r).toBeNull();
  });

  it('作成した job が取得できる', async () => {
    await createJobState('11111111-1111-1111-1111-111111111111');
    const r = await getJobState('11111111-1111-1111-1111-111111111111');
    expect(r?.stage).toBe('queued');
  });

  it('memCache hit 時は Supabase 呼出を行わない', async () => {
    await createJobState('22222222-2222-2222-2222-222222222222');
    mockSelectEq.mockClear();
    // 直後の get はキャッシュ hit
    await getJobState('22222222-2222-2222-2222-222222222222');
    expect(mockSelectEq).not.toHaveBeenCalled();
  });
});

describe('clearJobState', () => {
  it('Supabase delete + memCache クリア', async () => {
    await createJobState('33333333-3333-3333-3333-333333333333');
    await clearJobState('33333333-3333-3333-3333-333333333333');
    expect(mockDeleteEq).toHaveBeenCalledOnce();
    const after = await getJobState('33333333-3333-3333-3333-333333333333');
    expect(after).toBeNull();
  });
});

describe('境界 / 異常系', () => {
  it('jobId 空文字で createJobState は throw', async () => {
    await expect(createJobState('')).rejects.toThrow(/jobId is required/);
  });

  it('jobId 空文字で updateJobState は throw', async () => {
    await expect(updateJobState('', { stage: 'done' })).rejects.toThrow(/jobId is required/);
  });

  it('jobId 空文字で getJobState は null', async () => {
    expect(await getJobState('')).toBeNull();
  });

  it('jobId 空文字で clearJobState は no-op', async () => {
    await clearJobState('');
    expect(mockDeleteEq).not.toHaveBeenCalled();
  });
});
