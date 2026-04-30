// ============================================================================
// test/unit/regenerate-segment-api.test.ts
// POST /api/articles/[id]/regenerate-segment の単体テスト
//
// 検証ケース:
//   1. 認証なし → 401
//   2. body validation エラー → 400
//   3. 記事 not found → 404
//   4. sentence scope → 200 + before/after + claims_count_before/after
//   5. full scope → 200 + 全体再生成（generateJson が outline + writing で 2 回）
//
// 注意:
//   - 既存 publish-control コア / articles.ts は変更しない
//   - 履歴先行 INSERT (saveRevision) は session-guard / DB を介さずモックで検証
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

// ─── hoisted mocks ─────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  authGetUserMock: vi.fn(),
  articleMaybeSingleMock: vi.fn(),
  articlesUpdateMock: vi.fn(),
  generateJsonMock: vi.fn(),
  saveRevisionMock: vi.fn(),
  assertArticleWriteAllowedMock: vi.fn(),
  extractClaimsMock: vi.fn(),
  runHallucinationChecksMock: vi.fn(),
  runToneChecksMock: vi.fn(),
  articlesUpdateCapture: { payload: null as Record<string, unknown> | null },
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.authGetUserMock },
  })),
  createServiceRoleClient: vi.fn(async () => ({
    from: (table: string) => {
      if (table === 'articles') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: mocks.articleMaybeSingleMock }),
          }),
          update: (payload: Record<string, unknown>) => {
            mocks.articlesUpdateCapture.payload = payload;
            return {
              eq: async () => mocks.articlesUpdateMock(payload),
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  })),
}));

vi.mock('@/lib/ai/gemini-client', () => ({
  generateJson: mocks.generateJsonMock,
  callGemini: vi.fn(),
  generateText: vi.fn(),
  generateImage: vi.fn(),
  generateEmbedding: vi.fn(),
  estimateTokens: (s: string) => s.length,
}));

vi.mock('@/lib/db/article-revisions', () => ({
  saveRevision: mocks.saveRevisionMock,
}));

vi.mock('@/lib/publish-control/session-guard', () => ({
  assertArticleWriteAllowed: mocks.assertArticleWriteAllowedMock,
  assertArticleDeleteAllowed: vi.fn(),
}));

vi.mock('@/lib/hallucination/claim-extractor', () => ({
  extractClaims: mocks.extractClaimsMock,
  stripHtml: (s: string) => s,
  splitSentences: (s: string) => [s],
}));

vi.mock('@/lib/hallucination/run-checks', () => ({
  runHallucinationChecks: mocks.runHallucinationChecksMock,
}));

vi.mock('@/lib/tone/run-tone-checks', () => ({
  runToneChecks: mocks.runToneChecksMock,
  CENTROID_SIMILARITY_THRESHOLD: 0.85,
}));

// ─── alias ─────────────────────────────────────────────────────────────────

const authGetUserMock = mocks.authGetUserMock;
const articleMaybeSingleMock = mocks.articleMaybeSingleMock;
const articlesUpdateMock = mocks.articlesUpdateMock;
const generateJsonMock = mocks.generateJsonMock;
const saveRevisionMock = mocks.saveRevisionMock;
const assertArticleWriteAllowedMock = mocks.assertArticleWriteAllowedMock;
const extractClaimsMock = mocks.extractClaimsMock;
const runHallucinationChecksMock = mocks.runHallucinationChecksMock;
const runToneChecksMock = mocks.runToneChecksMock;
const articlesUpdateCapture = mocks.articlesUpdateCapture;

// ─── route import ──────────────────────────────────────────────────────────

import { POST } from '@/app/api/articles/[id]/regenerate-segment/route';

// ─── fixtures ──────────────────────────────────────────────────────────────

const ARTICLE_ID = '11111111-1111-1111-1111-111111111111';
const BEFORE_HTML =
  '<h2 id="ch1">章1</h2><p>これは古い文1。</p><p>これは古い文2。</p>';
const AFTER_HTML_SENTENCE =
  '<h2 id="ch1">章1</h2><p>これは古い文1。</p><p>これは新しい文2です。</p>';
const AFTER_HTML_FULL =
  '<h2 id="ch1">章A</h2><p>全体再生成された本文。</p>';

const ARTICLE_ROW = {
  id: ARTICLE_ID,
  title: 'テスト記事',
  intent: 'empathy',
  keyword: 'ペットロス, 立ち直り方',
  theme: 'ペットロス',
  persona: '30代女性',
  target_word_count: 2000,
  stage1_outline: {
    h2_chapters: [
      { title: '章1', summary: '...', target_chars: 500, arc_phase: 'awareness' },
      { title: '章2', summary: '...', target_chars: 500, arc_phase: 'wavering' },
    ],
  },
  stage2_body_html: BEFORE_HTML,
  html_body: BEFORE_HTML,
  yukiko_tone_score: 80,
  hallucination_score: 90,
};

function makeReq(body: unknown): NextRequest {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
  return new NextRequest(
    new Request(
      `http://localhost/api/articles/${ARTICLE_ID}/regenerate-segment`,
      init,
    ),
  );
}

function setupAuthOk() {
  authGetUserMock.mockResolvedValue({
    data: { user: { id: 'user-abc', email: 'tester@example.com' } },
  });
}

function setupArticleFound() {
  articleMaybeSingleMock.mockResolvedValue({
    data: ARTICLE_ROW,
    error: null,
  });
}

function setupValidationModulesOk() {
  // before: 2 件、after: 1 件として claim_count 差を作る
  extractClaimsMock
    .mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }])
    .mockResolvedValueOnce([{ id: 'c3' }]);
  runHallucinationChecksMock.mockResolvedValue({
    hallucination_score: 95,
    criticals: 0,
  });
  runToneChecksMock.mockResolvedValue({
    tone: { total: 88, passed: true },
    centroidSimilarity: 0.9,
    passed: true,
  });
}

// ─── tests ─────────────────────────────────────────────────────────────────

describe('POST /api/articles/[id]/regenerate-segment', () => {
  beforeEach(() => {
    articlesUpdateCapture.payload = null;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy-anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role';
    process.env.GEMINI_API_KEY = 'dummy-gemini';
    articlesUpdateMock.mockResolvedValue({ error: null });
    saveRevisionMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── 401 ────────────────────────────────────────────────────────────────

  it('401 を返す — 認証なし', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const res = await POST(makeReq({ scope: 'sentence', target_idx: 1 }), {
      params: { id: ARTICLE_ID },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/認証/);
    expect(articleMaybeSingleMock).not.toHaveBeenCalled();
    expect(generateJsonMock).not.toHaveBeenCalled();
    expect(saveRevisionMock).not.toHaveBeenCalled();
  });

  // ─── 400 ────────────────────────────────────────────────────────────────

  it('400 を返す — body validation エラー（scope=invalid）', async () => {
    setupAuthOk();

    const res = await POST(makeReq({ scope: 'invalid' }), {
      params: { id: ARTICLE_ID },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/バリデーション/);
    expect(articleMaybeSingleMock).not.toHaveBeenCalled();
    expect(saveRevisionMock).not.toHaveBeenCalled();
  });

  it('400 を返す — sentence scope で target_idx 欠落', async () => {
    setupAuthOk();

    const res = await POST(makeReq({ scope: 'sentence' }), {
      params: { id: ARTICLE_ID },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/バリデーション/);
  });

  // ─── 404 ────────────────────────────────────────────────────────────────

  it('404 を返す — 記事 not found', async () => {
    setupAuthOk();
    articleMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const res = await POST(
      makeReq({ scope: 'sentence', target_idx: 1 }),
      { params: { id: ARTICLE_ID } },
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/見つかりません/);
    expect(saveRevisionMock).not.toHaveBeenCalled();
  });

  // ─── 200 sentence ───────────────────────────────────────────────────────

  it('200 を返す — sentence scope で before/after + claims_count を返却し履歴を先行 INSERT', async () => {
    setupAuthOk();
    setupArticleFound();
    setupValidationModulesOk();

    // sentence scope は generateJson 1 回（書換）
    generateJsonMock.mockResolvedValueOnce({
      data: { html: AFTER_HTML_SENTENCE },
      response: { text: '', finishReason: 'STOP', tokenUsage: {} },
    });

    const res = await POST(
      makeReq({ scope: 'sentence', target_idx: 1 }),
      { params: { id: ARTICLE_ID } },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.article_id).toBe(ARTICLE_ID);
    expect(body.scope).toBe('sentence');
    expect(body.target_idx).toBe(1);
    expect(body.before).toBe(BEFORE_HTML);
    expect(body.after).toBe(AFTER_HTML_SENTENCE);
    expect(body.claims_count_before).toBe(2);
    expect(body.claims_count_after).toBe(1);
    expect(body.scores.hallucination).toBe(95);
    expect(body.scores.yukiko_tone).toBe(88);

    // session-guard が呼ばれている
    expect(assertArticleWriteAllowedMock).toHaveBeenCalledWith(
      ARTICLE_ID,
      ['stage2_body_html'],
    );

    // 履歴先行 INSERT (HTML 履歴ルール) が articles.update よりも前に呼ばれている
    expect(saveRevisionMock).toHaveBeenCalledTimes(1);
    const saveCall = saveRevisionMock.mock.invocationCallOrder[0];
    const updateCall = articlesUpdateMock.mock.invocationCallOrder[0];
    expect(saveCall).toBeLessThan(updateCall);

    expect(saveRevisionMock).toHaveBeenCalledWith(
      ARTICLE_ID,
      expect.objectContaining({ body_html: BEFORE_HTML }),
      'regenerate_sentence',
      'user-abc',
    );

    // articles UPDATE payload
    expect(articlesUpdateCapture.payload).toBeTruthy();
    expect(articlesUpdateCapture.payload!.stage2_body_html).toBe(
      AFTER_HTML_SENTENCE,
    );
    expect(articlesUpdateCapture.payload!.hallucination_score).toBe(95);
    expect(articlesUpdateCapture.payload!.yukiko_tone_score).toBe(88);

    // generateJson は 1 回のみ
    expect(generateJsonMock).toHaveBeenCalledTimes(1);
  });

  // ─── 200 full ───────────────────────────────────────────────────────────

  it('200 を返す — full scope で Stage1+Stage2 が走り全体再生成', async () => {
    setupAuthOk();
    setupArticleFound();
    setupValidationModulesOk();

    // full scope は generateJson 2 回（outline → writing）
    generateJsonMock
      .mockResolvedValueOnce({
        data: {
          lead_summary: 'lead',
          h2_chapters: [
            {
              title: '新章1',
              summary: '...',
              target_chars: 500,
              arc_phase: 'awareness',
            },
          ],
          narrative_arc: {},
          emotion_curve: [-1],
        },
        response: { text: '', finishReason: 'STOP', tokenUsage: {} },
      })
      .mockResolvedValueOnce({
        data: { html: AFTER_HTML_FULL },
        response: { text: '', finishReason: 'STOP', tokenUsage: {} },
      });

    const res = await POST(makeReq({ scope: 'full' }), {
      params: { id: ARTICLE_ID },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.article_id).toBe(ARTICLE_ID);
    expect(body.scope).toBe('full');
    expect(body.target_idx).toBeNull();
    expect(body.before).toBe(BEFORE_HTML);
    expect(body.after).toBe(AFTER_HTML_FULL);
    expect(body.claims_count_before).toBe(2);
    expect(body.claims_count_after).toBe(1);

    // outline + writing で 2 回
    expect(generateJsonMock).toHaveBeenCalledTimes(2);

    // 履歴先行 INSERT が呼ばれている
    expect(saveRevisionMock).toHaveBeenCalledWith(
      ARTICLE_ID,
      expect.objectContaining({ body_html: BEFORE_HTML }),
      'regenerate_full',
      'user-abc',
    );

    // articles UPDATE
    expect(articlesUpdateCapture.payload).toBeTruthy();
    expect(articlesUpdateCapture.payload!.stage2_body_html).toBe(
      AFTER_HTML_FULL,
    );
  });
});
