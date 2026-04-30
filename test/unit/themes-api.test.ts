// ============================================================================
// test/unit/themes-api.test.ts
// GET /api/themes の単体テスト
//
// 検証ケース:
//   1. 認証なし → 401 + {error}
//   2. is_active 未指定（default true）→ themes select with is_active=true filter
//   3. is_active=false → themes with is_active=false
//   4. 正常応答 → {themes:[...]} 200
//   5. DB エラー → 500
//   6. name 昇順ソート（.order('name', { ascending: true })）
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

// ─── モック宣言（vi.mock は hoist されるので vi.hoisted を経由） ──────────────

const mocks = vi.hoisted(() => {
  return {
    authGetUserMock: vi.fn(),
    // themes クエリ呼出キャプチャ
    capture: {
      table: null as string | null,
      selectColumns: null as string | null,
      eqCalls: [] as Array<{ column: string; value: unknown }>,
      orderCalls: [] as Array<{ column: string; options: unknown }>,
    },
    // 最終 await 結果（{ data, error }）
    queryResultMock: vi.fn(),
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
        mocks.capture.table = table;
        // チェーン可能な thenable オブジェクトを返す
        const builder: {
          select: (cols: string) => typeof builder;
          eq: (col: string, val: unknown) => typeof builder;
          order: (col: string, opts: unknown) => Promise<unknown>;
        } = {
          select(cols: string) {
            mocks.capture.selectColumns = cols;
            return builder;
          },
          eq(col: string, val: unknown) {
            mocks.capture.eqCalls.push({ column: col, value: val });
            return builder;
          },
          order(col: string, opts: unknown) {
            mocks.capture.orderCalls.push({ column: col, options: opts });
            // ここで await されるので Promise を返す
            return Promise.resolve(mocks.queryResultMock());
          },
        };
        return builder;
      },
    })),
  };
});

// logger は副作用ノイズになるので静かにする
vi.mock('@/lib/logger', () => {
  return {
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  };
});

// ─── ヘルパエイリアス ────────────────────────────────────────────────────────

const authGetUserMock = mocks.authGetUserMock;
const queryResultMock = mocks.queryResultMock;
const capture = mocks.capture;

// ─── 動的 import（モック適用後） ─────────────────────────────────────────────

import { GET } from '@/app/api/themes/route';

// ─── ヘルパ ─────────────────────────────────────────────────────────────────

function makeReq(query: string = ''): NextRequest {
  const url = `http://localhost/api/themes${query}`;
  return new NextRequest(new Request(url, { method: 'GET' }));
}

const FIXTURE_THEMES = [
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'あ：内省',
    slug: 'introspection',
    category: 'inner',
    description: '自己との対話',
    is_active: true,
    visual_mood: { palette: 'warm' },
  },
  {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    name: 'か：感謝',
    slug: 'gratitude',
    category: 'relation',
    description: '日々への感謝',
    is_active: true,
    visual_mood: null,
  },
  {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    name: 'は：始まり',
    slug: 'beginnings',
    category: null,
    description: null,
    is_active: true,
    visual_mood: null,
  },
];

function resetCapture() {
  capture.table = null;
  capture.selectColumns = null;
  capture.eqCalls = [];
  capture.orderCalls = [];
}

// ─── テスト ─────────────────────────────────────────────────────────────────

describe('GET /api/themes', () => {
  beforeEach(() => {
    resetCapture();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy-anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. 認証なし → 401 ──────────────────────────────────────────────────

  it('401 を返す — 認証なし（auth.getUser が user=null）', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error).toMatch(/認証/);

    // DB クエリは発行されない
    expect(capture.table).toBeNull();
    expect(queryResultMock).not.toHaveBeenCalled();
  });

  // ─── 2. is_active 未指定（default true） ─────────────────────────────────

  it('is_active 未指定なら themes を is_active=true で SELECT する', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-abc' } },
    });
    queryResultMock.mockReturnValue({ data: FIXTURE_THEMES, error: null });

    const res = await GET(makeReq()); // クエリ無し
    expect(res.status).toBe(200);

    // themes テーブルへのアクセス
    expect(capture.table).toBe('themes');

    // .eq('is_active', true) で呼ばれる
    expect(capture.eqCalls).toEqual([{ column: 'is_active', value: true }]);
  });

  // ─── 3. is_active=false ─────────────────────────────────────────────────

  it('is_active=false クエリで themes を is_active=false で SELECT する', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-abc' } },
    });
    queryResultMock.mockReturnValue({ data: [], error: null });

    const res = await GET(makeReq('?is_active=false'));
    expect(res.status).toBe(200);

    expect(capture.table).toBe('themes');
    expect(capture.eqCalls).toEqual([{ column: 'is_active', value: false }]);
  });

  // ─── 4. 正常応答 → 200 + {themes:[...]} ────────────────────────────────

  it('200 を返す — themes 配列を必須キーで整形して返却', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-abc' } },
    });
    queryResultMock.mockReturnValue({ data: FIXTURE_THEMES, error: null });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('themes');
    expect(Array.isArray(body.themes)).toBe(true);
    expect(body.themes).toHaveLength(3);

    // 各 theme が必須キーを保持していること
    for (const t of body.themes) {
      expect(t).toHaveProperty('id');
      expect(t).toHaveProperty('name');
      expect(t).toHaveProperty('slug');
      expect(t).toHaveProperty('category');
      expect(t).toHaveProperty('description');
      expect(t).toHaveProperty('is_active');
      expect(t).toHaveProperty('visual_mood');
    }

    // 1 件目の値も具体的に検証
    expect(body.themes[0].id).toBe(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    );
    expect(body.themes[0].name).toBe('あ：内省');
    expect(body.themes[0].slug).toBe('introspection');
    expect(body.themes[0].category).toBe('inner');
    expect(body.themes[0].description).toBe('自己との対話');
    expect(body.themes[0].is_active).toBe(true);
    expect(body.themes[0].visual_mood).toEqual({ palette: 'warm' });

    // route.ts が SELECT する列を確認
    expect(capture.selectColumns).toBe(
      'id, name, slug, category, description, is_active, visual_mood',
    );
  });

  it('200 を返す — data=null でも空配列にフォールバックする', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-abc' } },
    });
    queryResultMock.mockReturnValue({ data: null, error: null });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.themes).toEqual([]);
  });

  // ─── 5. DB エラー → 500 ────────────────────────────────────────────────

  it('500 を返す — Supabase が error を返した場合', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-abc' } },
    });
    queryResultMock.mockReturnValue({
      data: null,
      error: { message: 'connection refused', code: 'PGRST000' },
    });

    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
  });

  it('500 を返す — auth.getUser が throw した場合', async () => {
    authGetUserMock.mockRejectedValue(new Error('boom'));

    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // ─── 6. name 昇順ソート ─────────────────────────────────────────────────

  it('name 昇順で order が呼ばれる', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-abc' } },
    });
    queryResultMock.mockReturnValue({ data: FIXTURE_THEMES, error: null });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);

    // .order('name', { ascending: true }) が 1 回だけ呼ばれている
    expect(capture.orderCalls).toHaveLength(1);
    expect(capture.orderCalls[0].column).toBe('name');
    expect(capture.orderCalls[0].options).toEqual({ ascending: true });
  });
});
