// ============================================================================
// test/unit/hallucination-check-api.test.ts
// POST /api/articles/[id]/hallucination-check の単体テスト
//
// 検証ケース:
//   1. 認証なし → 401
//   2. 記事 not found → 404
//   3. 正常系 → 200 + JSON（claim 5 件）
//   4. 検証エラー時 → 500
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
import type { Claim } from '@/types/hallucination';

// ─── モック宣言（vi.mock は hoist されるので vi.hoisted を経由） ──────────────

const mocks = vi.hoisted(() => {
  return {
    authGetUserMock: vi.fn(),
    articlesMaybeSingleMock: vi.fn(),
    articlesUpdateMock: vi.fn(),
    runHallucinationChecksMock: vi.fn(),
    persistClaimsMock: vi.fn(),
    articlesUpdateCapture: { payload: null as Record<string, unknown> | null },
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
        if (table !== 'articles') {
          throw new Error(`unexpected table: ${table}`);
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: mocks.articlesMaybeSingleMock,
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            mocks.articlesUpdateCapture.payload = payload;
            return {
              eq: () => mocks.articlesUpdateMock(payload),
            };
          },
        };
      },
    })),
  };
});

vi.mock('@/lib/hallucination/run-checks', () => {
  return {
    runHallucinationChecks: mocks.runHallucinationChecksMock,
  };
});

vi.mock('@/lib/hallucination/persist-claims', () => {
  return {
    persistClaims: mocks.persistClaimsMock,
  };
});

// ─── ヘルパエイリアス ────────────────────────────────────────────────────────

const authGetUserMock = mocks.authGetUserMock;
const articlesMaybeSingleMock = mocks.articlesMaybeSingleMock;
const articlesUpdateMock = mocks.articlesUpdateMock;
const runHallucinationChecksMock = mocks.runHallucinationChecksMock;
const persistClaimsMock = mocks.persistClaimsMock;
const articlesUpdateCapture = mocks.articlesUpdateCapture;

// ─── 動的 import（モック適用後） ─────────────────────────────────────────────

import { POST } from '@/app/api/articles/[id]/hallucination-check/route';

// ─── ヘルパ ─────────────────────────────────────────────────────────────────

const ARTICLE_ID = '11111111-1111-1111-1111-111111111111';

function makeReq(): NextRequest {
  return new NextRequest(
    new Request(
      `http://localhost/api/articles/${ARTICLE_ID}/hallucination-check`,
      { method: 'POST' },
    ),
  );
}

function callPost(articleId: string = ARTICLE_ID) {
  return POST(makeReq(), { params: { id: articleId } });
}

const FIXTURE_CLAIMS: Claim[] = [
  {
    sentence_idx: 0,
    claim_text: '2024年に発表された統計があります。',
    claim_type: 'factual',
  },
  {
    sentence_idx: 1,
    claim_text: '田中博士の論文によれば...',
    claim_type: 'attribution',
  },
  {
    sentence_idx: 2,
    claim_text: '波動が高まる瞬間があります。',
    claim_type: 'spiritual',
  },
  { sentence_idx: 3, claim_text: '今日は晴れ。', claim_type: 'general' },
  {
    sentence_idx: 4,
    claim_text: 'だから心が落ち着く。',
    claim_type: 'logical',
  },
];

function setupHappyPath() {
  authGetUserMock.mockResolvedValue({
    data: { user: { id: 'user-abc', email: 'tester@example.com' } },
  });
  articlesMaybeSingleMock.mockResolvedValue({
    data: { id: ARTICLE_ID, stage2_body_html: '<p>本文。</p>' },
    error: null,
  });
  articlesUpdateMock.mockResolvedValue({ error: null });
  persistClaimsMock.mockResolvedValue(undefined);
  runHallucinationChecksMock.mockResolvedValue({
    hallucination_score: 75,
    criticals: 1,
    claims: FIXTURE_CLAIMS,
    results: [],
    summary: {
      total: 5,
      grounded: 3,
      weak: 0,
      unsupported: 0,
      flagged: 1,
      critical_hits: 1,
    },
  });
}

// ─── テスト ─────────────────────────────────────────────────────────────────

describe('POST /api/articles/[id]/hallucination-check', () => {
  beforeEach(() => {
    articlesUpdateCapture.payload = null;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy-anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── 401 ────────────────────────────────────────────────────────────────

  it('401 を返す — 認証なし（auth.getUser が user=null）', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const res = await callPost();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/認証/);

    // 後続処理は呼ばれていない
    expect(articlesMaybeSingleMock).not.toHaveBeenCalled();
    expect(runHallucinationChecksMock).not.toHaveBeenCalled();
    expect(persistClaimsMock).not.toHaveBeenCalled();
    expect(articlesUpdateMock).not.toHaveBeenCalled();
  });

  // ─── 404 ────────────────────────────────────────────────────────────────

  it('404 を返す — 記事が見つからない', async () => {
    authGetUserMock.mockResolvedValue({
      data: { user: { id: 'user-abc' } },
    });
    articlesMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const res = await callPost();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/見つかりません/);

    // 検証パイプラインは呼ばれない
    expect(runHallucinationChecksMock).not.toHaveBeenCalled();
    expect(persistClaimsMock).not.toHaveBeenCalled();
    expect(articlesUpdateMock).not.toHaveBeenCalled();
  });

  // ─── 200（正常系） ──────────────────────────────────────────────────────

  it('200 を返す — claim 5 件を抽出し score / criticals を返却', async () => {
    setupHappyPath();

    const res = await callPost();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.hallucination_score).toBe(75);
    expect(body.criticals).toBe(1);
    expect(body.claims_count).toBe(5);
    expect(Array.isArray(body.claims)).toBe(true);
    expect(body.claims).toHaveLength(5);
    expect(body.claims[0].claim_type).toBe('factual');

    // runHallucinationChecks に htmlBody が渡る
    expect(runHallucinationChecksMock).toHaveBeenCalledTimes(1);
    const [htmlArg, retrieveArg] = runHallucinationChecksMock.mock.calls[0];
    expect(htmlArg).toBe('<p>本文。</p>');
    expect(typeof retrieveArg).toBe('function');

    // persistClaims が articleId + claims で呼ばれる
    expect(persistClaimsMock).toHaveBeenCalledTimes(1);
    expect(persistClaimsMock).toHaveBeenCalledWith(ARTICLE_ID, FIXTURE_CLAIMS);

    // articles.hallucination_score のみが UPDATE される（本文は触らない）
    expect(articlesUpdateMock).toHaveBeenCalledTimes(1);
    expect(articlesUpdateCapture.payload).toEqual({ hallucination_score: 75 });
    // stage2_body_html / title 等を含まないことを明示確認
    expect(articlesUpdateCapture.payload).not.toHaveProperty('stage2_body_html');
    expect(articlesUpdateCapture.payload).not.toHaveProperty('title');
    expect(articlesUpdateCapture.payload).not.toHaveProperty('stage3_final_html');
  });

  // ─── 500（検証エラー） ──────────────────────────────────────────────────

  it('500 を返す — runHallucinationChecks が throw', async () => {
    setupHappyPath();
    runHallucinationChecksMock.mockRejectedValueOnce(
      new Error('gemini timeout'),
    );

    const res = await callPost();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/gemini timeout/);

    // 後続の persist / update は呼ばれない
    expect(persistClaimsMock).not.toHaveBeenCalled();
    expect(articlesUpdateMock).not.toHaveBeenCalled();
  });
});
