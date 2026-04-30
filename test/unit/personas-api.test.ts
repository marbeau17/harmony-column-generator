// ============================================================================
// test/unit/personas-api.test.ts
// GET /api/personas（ペルソナ一覧取得）の単体テスト
//
// テスト戦略:
//   - createServerSupabaseClient（auth.getUser）を vi.mock
//   - createServiceRoleClient（personas SELECT）を vi.mock
//   - チェーン: from('personas').select(...).eq('is_active', X).order('name', ...)
//
// 検証ケース:
//   1. 認証なし → 401
//   2. is_active 未指定 → default true で eq が呼ばれる
//   3. is_active=false → eq に false が渡される
//   4. 正常応答 → 全カラムが整形されたレスポンスで返却される
//   5. preferred_words / avoided_words が null → [] にフォールバック
//   6. DB エラー → 500
// ============================================================================

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { NextRequest } from 'next/server';

// ─── モック宣言（vi.hoisted で共有） ────────────────────────────────────────

const mocks = vi.hoisted(() => {
  return {
    authGetUserMock: vi.fn(),
    orderMock: vi.fn(),
    eqMock: vi.fn(),
    selectMock: vi.fn(),
    fromCalls: { tables: [] as string[] },
    eqCapture: { calls: [] as Array<{ column: string; value: unknown }> },
    selectCapture: { columns: [] as string[] },
    orderCapture: {
      calls: [] as Array<{ column: string; opts: Record<string, unknown> }>,
    },
  };
});

vi.mock('@/lib/supabase/server', () => {
  return {
    createServerSupabaseClient: vi.fn(async () => ({
      auth: {
        getUser: mocks.authGetUserMock,
      },
    })),
    createServiceRoleClient: vi.fn(async () => ({
      from: (table: string) => {
        mocks.fromCalls.tables.push(table);
        if (table !== 'personas') {
          throw new Error(`unexpected table: ${table}`);
        }
        return {
          select: (cols: string) => {
            mocks.selectCapture.columns.push(cols);
            return {
              eq: (column: string, value: unknown) => {
                mocks.eqCapture.calls.push({ column, value });
                return {
                  order: (
                    column2: string,
                    opts: Record<string, unknown>,
                  ) => {
                    mocks.orderCapture.calls.push({
                      column: column2,
                      opts,
                    });
                    return mocks.orderMock();
                  },
                };
              },
            };
          },
        };
      },
    })),
  };
});

// ─── エイリアス ─────────────────────────────────────────────────────────────

const authGetUserMock = mocks.authGetUserMock;
const orderMock = mocks.orderMock;
const fromCalls = mocks.fromCalls;
const eqCapture = mocks.eqCapture;
const selectCapture = mocks.selectCapture;
const orderCapture = mocks.orderCapture;

// ─── 動的 import（モック適用後） ─────────────────────────────────────────────

import { GET } from '@/app/api/personas/route';

// ─── ヘルパ ─────────────────────────────────────────────────────────────────

function makeReq(url = 'http://localhost/api/personas'): NextRequest {
  return new NextRequest(new Request(url, { method: 'GET' }));
}

const FIXTURE_PERSONA_ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  name: '30代女性 / ペットロス',
  age_range: '30s',
  description: 'ペットを亡くしたばかりの女性',
  search_patterns: ['ペットロス', '立ち直り方'],
  tone_guide: 'やさしく寄り添う',
  cta_approach: 'gentle',
  preferred_words: ['そっと', '寄り添う'],
  avoided_words: ['必ず', '絶対'],
  image_style: { mood: 'warm' },
  cta_default_stage: 'awareness',
  is_active: true,
};

// ─── テスト ─────────────────────────────────────────────────────────────────

describe('GET /api/personas', () => {
  beforeEach(() => {
    fromCalls.tables = [];
    eqCapture.calls = [];
    selectCapture.columns = [];
    orderCapture.calls = [];
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy-anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. 認証なし → 401 ───────────────────────────────────────────────────

  it('401 を返す — 認証なし（auth.getUser が user=null）', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/認証/);

    // 認証段階で弾かれるため、DB 呼び出しは行われない
    expect(fromCalls.tables).toHaveLength(0);
    expect(orderMock).not.toHaveBeenCalled();
  });

  // ─── 2. is_active 未指定 → default true ──────────────────────────────────

  it('is_active 未指定 — default で is_active=true として SELECT', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-abc' } },
    });
    orderMock.mockResolvedValue({ data: [], error: null });

    const res = await GET(makeReq('http://localhost/api/personas'));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ personas: [] });

    expect(fromCalls.tables).toEqual(['personas']);
    expect(eqCapture.calls).toHaveLength(1);
    expect(eqCapture.calls[0]).toEqual({
      column: 'is_active',
      value: true,
    });
    expect(orderCapture.calls).toHaveLength(1);
    expect(orderCapture.calls[0]).toEqual({
      column: 'name',
      opts: { ascending: true },
    });
  });

  // ─── 3. is_active=false ───────────────────────────────────────────────────

  it('is_active=false — クエリパラメータが false の場合は false として SELECT', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-abc' } },
    });
    orderMock.mockResolvedValue({ data: [], error: null });

    const res = await GET(
      makeReq('http://localhost/api/personas?is_active=false'),
    );
    expect(res.status).toBe(200);

    expect(eqCapture.calls).toHaveLength(1);
    expect(eqCapture.calls[0]).toEqual({
      column: 'is_active',
      value: false,
    });
  });

  // ─── 4. 正常応答 → 200 ───────────────────────────────────────────────────

  it('200 を返す — personas 全カラムを期待される shape で返却', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-abc' } },
    });
    orderMock.mockResolvedValue({
      data: [FIXTURE_PERSONA_ROW],
      error: null,
    });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.personas).toHaveLength(1);
    expect(body.personas[0]).toEqual({
      id: FIXTURE_PERSONA_ROW.id,
      name: FIXTURE_PERSONA_ROW.name,
      age_range: FIXTURE_PERSONA_ROW.age_range,
      description: FIXTURE_PERSONA_ROW.description,
      search_patterns: FIXTURE_PERSONA_ROW.search_patterns,
      tone_guide: FIXTURE_PERSONA_ROW.tone_guide,
      cta_approach: FIXTURE_PERSONA_ROW.cta_approach,
      preferred_words: FIXTURE_PERSONA_ROW.preferred_words,
      avoided_words: FIXTURE_PERSONA_ROW.avoided_words,
      image_style: FIXTURE_PERSONA_ROW.image_style,
      cta_default_stage: FIXTURE_PERSONA_ROW.cta_default_stage,
      is_active: FIXTURE_PERSONA_ROW.is_active,
    });

    // SELECT 句に必要な全カラムが指定されていること
    expect(selectCapture.columns).toHaveLength(1);
    const selectClause = selectCapture.columns[0];
    for (const col of [
      'id',
      'name',
      'age_range',
      'description',
      'search_patterns',
      'tone_guide',
      'cta_approach',
      'preferred_words',
      'avoided_words',
      'image_style',
      'cta_default_stage',
      'is_active',
    ]) {
      expect(selectClause).toContain(col);
    }
  });

  // ─── 5. null → [] へのフォールバック ────────────────────────────────────

  it('preferred_words / avoided_words が null の場合は [] にフォールバック', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-abc' } },
    });
    orderMock.mockResolvedValue({
      data: [
        {
          ...FIXTURE_PERSONA_ROW,
          search_patterns: null,
          preferred_words: null,
          avoided_words: null,
          age_range: null,
          description: null,
          tone_guide: null,
          cta_approach: null,
          image_style: null,
          cta_default_stage: null,
        },
      ],
      error: null,
    });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.personas).toHaveLength(1);
    const p = body.personas[0];
    expect(p.preferred_words).toEqual([]);
    expect(p.avoided_words).toEqual([]);
    expect(p.search_patterns).toEqual([]);
    // null をそのまま保持するフィールド（配列以外）
    expect(p.age_range).toBeNull();
    expect(p.description).toBeNull();
    expect(p.tone_guide).toBeNull();
    expect(p.cta_approach).toBeNull();
    expect(p.image_style).toBeNull();
    expect(p.cta_default_stage).toBeNull();
  });

  // ─── 6. DB エラー → 500 ──────────────────────────────────────────────────

  it('500 を返す — DB エラー（Supabase が error を返す）', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-abc' } },
    });
    orderMock.mockResolvedValue({
      data: null,
      error: { message: 'connection refused', code: '08006' },
    });

    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/取得に失敗/);
  });

  // ─── 7. 例外 → 500（補助） ──────────────────────────────────────────────

  it('500 を返す — 予期せぬ例外（auth が throw）', async () => {
    authGetUserMock.mockRejectedValue(new Error('boom'));

    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/取得に失敗/);
  });
});
