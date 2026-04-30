// ============================================================================
// test/unit/zero-generate-full-api.test.ts
// POST /api/articles/zero-generate-full（spec §3 + §12）の単体テスト
//
// テスト戦略:
//   - vi.mock で全依存をモック化:
//       * supabase server client (auth + service role)
//       * gemini-client.generateJson
//       * @/lib/rag/retrieve-chunks
//       * @/lib/hallucination/run-checks
//       * @/lib/hallucination/claim-extractor
//       * @/lib/tone/run-tone-checks
//       * @/lib/ai/prompts/zero-image-prompt
//       * publish-control session-guard（インポート連鎖の遮断）
//
// 検証ケース:
//   1. 認証なし → 401
//   2. 正常系（全モジュール成功）→ 201 + partial_success=false
//   3. 一部失敗（hallucination throw）→ 207 + partial_success=true
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
  themeMaybeSingleMock: vi.fn(),
  personaMaybeSingleMock: vi.fn(),
  articlesInsertSingleMock: vi.fn(),
  generateJsonMock: vi.fn(),
  retrieveChunksMock: vi.fn(),
  runHallucinationChecksMock: vi.fn(),
  runToneChecksMock: vi.fn(),
  buildZeroImagePromptsMock: vi.fn(),
  extractClaimsMock: vi.fn(),
  buildZeroWritingPromptMock: vi.fn(),
  articlesInsertCapture: { payload: null as Record<string, unknown> | null },
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.authGetUserMock },
  })),
  createServiceRoleClient: vi.fn(async () => ({
    rpc: vi.fn(async () => ({ data: [], error: null })),
    from: (table: string) => {
      if (table === 'themes') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: mocks.themeMaybeSingleMock }),
          }),
        };
      }
      if (table === 'personas') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: mocks.personaMaybeSingleMock }),
          }),
        };
      }
      if (table === 'articles') {
        return {
          insert: (payload: Record<string, unknown>) => {
            mocks.articlesInsertCapture.payload = payload;
            return {
              select: () => ({ single: mocks.articlesInsertSingleMock }),
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

vi.mock('@/lib/rag/retrieve-chunks', () => ({
  retrieveChunks: mocks.retrieveChunksMock,
}));

vi.mock('@/lib/hallucination/run-checks', () => ({
  runHallucinationChecks: mocks.runHallucinationChecksMock,
}));

vi.mock('@/lib/hallucination/claim-extractor', () => ({
  extractClaims: mocks.extractClaimsMock,
  stripHtml: (s: string) => s,
  splitSentences: (s: string) => [s],
}));

vi.mock('@/lib/tone/run-tone-checks', () => ({
  runToneChecks: mocks.runToneChecksMock,
  CENTROID_SIMILARITY_THRESHOLD: 0.85,
}));

vi.mock('@/lib/ai/prompts/zero-image-prompt', () => ({
  buildZeroImagePrompts: mocks.buildZeroImagePromptsMock,
  ZERO_NEGATIVE_PROMPT: 'negative',
  ZERO_IMAGE_STYLE_PRESETS: {},
}));

vi.mock('@/lib/publish-control/session-guard', () => ({
  assertArticleWriteAllowed: vi.fn(),
  assertArticleDeleteAllowed: vi.fn(),
}));

// G3 persistClaims / G9 cta-variants 系は本テストでは未着地扱い
// （vitest の auto-mock factory 例外を回避するため空モジュールを供給）
vi.mock('@/lib/hallucination/persist-claims', () => ({}));
vi.mock('@/lib/cta/generate-variants', () => ({}));
vi.mock('@/lib/cta-variants/generate', () => ({}));
vi.mock('@/lib/content/cta-variants', () => ({}));
vi.mock('@/lib/cta/persist-variants', () => ({}));
vi.mock('@/lib/cta-variants/persist', () => ({}));
vi.mock('@/lib/content/cta-variants-persist', () => ({}));
vi.mock('@/lib/ai/prompts/stage2-zero-writing', () => ({
  buildZeroWritingPrompt: mocks.buildZeroWritingPromptMock,
}));

// ─── alias for readability ─────────────────────────────────────────────────

const authGetUserMock = mocks.authGetUserMock;
const themeMaybeSingleMock = mocks.themeMaybeSingleMock;
const personaMaybeSingleMock = mocks.personaMaybeSingleMock;
const articlesInsertSingleMock = mocks.articlesInsertSingleMock;
const generateJsonMock = mocks.generateJsonMock;
const retrieveChunksMock = mocks.retrieveChunksMock;
const runHallucinationChecksMock = mocks.runHallucinationChecksMock;
const runToneChecksMock = mocks.runToneChecksMock;
const buildZeroImagePromptsMock = mocks.buildZeroImagePromptsMock;
const extractClaimsMock = mocks.extractClaimsMock;
const buildZeroWritingPromptMock = mocks.buildZeroWritingPromptMock;
const articlesInsertCapture = mocks.articlesInsertCapture;

// ─── route import ──────────────────────────────────────────────────────────

import { POST } from '@/app/api/articles/zero-generate-full/route';

// ─── fixtures ──────────────────────────────────────────────────────────────

const VALID_BODY = {
  theme_id: '11111111-1111-1111-1111-111111111111',
  persona_id: '22222222-2222-2222-2222-222222222222',
  keywords: ['ペットロス', '立ち直り方'],
  intent: 'empathy' as const,
  target_length: 2000,
};

const FIXTURE_OUTLINE = {
  lead_summary: 'ペットを失った悲しみは…時間が癒すとは限りません。',
  narrative_arc: {
    opening_hook: { type: 'empathy', text: 'あの子のいない朝' },
    awareness: '悲しみの形は人それぞれ',
    wavering: 'けれど、忘れたいわけじゃない',
    acceptance: '思い出は、いまも一緒に呼吸している',
    action: '今日はひとつだけ、深呼吸してみてくださいね',
    closing_style: 'lingering',
  },
  emotion_curve: [-1, -2, 1, 2],
  h2_chapters: [
    { title: 'あの子のいない朝', summary: '...', target_chars: 500, arc_phase: 'awareness' },
    { title: '揺れる気持ち', summary: '...', target_chars: 500, arc_phase: 'wavering' },
    { title: 'そのままでいい', summary: '...', target_chars: 500, arc_phase: 'acceptance' },
    { title: '小さな一歩', summary: '...', target_chars: 500, arc_phase: 'action' },
  ],
  citation_highlights: ['ハイライト1', 'ハイライト2', 'ハイライト3'],
  faq_items: [{ q: 'Q1', a: 'A1' }],
  image_prompts: [
    { slot: 'hero', prompt: 'hero scene' },
    { slot: 'body', prompt: 'body scene' },
    { slot: 'summary', prompt: 'summary scene' },
  ],
};

const FIXTURE_BODY_HTML = '<h2 id="section-1">あの子のいない朝</h2><p>本文...</p>';
const NEW_ARTICLE_ID = '99999999-9999-9999-9999-999999999999';

function makeReq(body: unknown): NextRequest {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
  return new NextRequest(
    new Request('http://localhost/api/articles/zero-generate-full', init),
  );
}

function setupHappyPath() {
  authGetUserMock.mockResolvedValue({
    data: { user: { id: 'user-abc', email: 'tester@example.com' } },
  });
  themeMaybeSingleMock.mockResolvedValue({
    data: {
      id: VALID_BODY.theme_id,
      name: 'ペットロス',
      category: 'healing',
      visual_mood: { palette: 'warm gold' },
    },
    error: null,
  });
  personaMaybeSingleMock.mockResolvedValue({
    data: {
      id: VALID_BODY.persona_id,
      name: '30代女性',
      age_range: '30s',
      tone_guide: 'やさしく寄り添う',
      image_style: { preset: '30s_homemaker' },
    },
    error: null,
  });
  articlesInsertSingleMock.mockResolvedValue({
    data: { id: NEW_ARTICLE_ID },
    error: null,
  });

  // generateJson は 1 回目: outline、2 回目: stage2 body html
  generateJsonMock.mockReset();
  generateJsonMock
    .mockResolvedValueOnce({
      data: FIXTURE_OUTLINE,
      response: { text: '', finishReason: 'STOP', tokenUsage: {} },
    })
    .mockResolvedValueOnce({
      data: { html: FIXTURE_BODY_HTML },
      response: { text: '', finishReason: 'STOP', tokenUsage: {} },
    });

  retrieveChunksMock.mockResolvedValue({
    chunks: [
      {
        id: 'c1',
        source_article_id: 's1',
        chunk_text: 'chunk text',
        themes: ['ペットロス'],
        emotional_tone: null,
        spiritual_concepts: [],
        similarity: 0.9,
      },
    ],
    meta: {
      candidateCount: 1,
      afterFilterCount: 1,
      afterThresholdCount: 1,
      finalCount: 1,
    },
  });

  extractClaimsMock.mockResolvedValue([
    { sentence_idx: 0, claim_text: '本文...', claim_type: 'general' },
  ]);

  runHallucinationChecksMock.mockResolvedValue({
    hallucination_score: 92,
    criticals: 0,
    claims: [
      { sentence_idx: 0, claim_text: '本文...', claim_type: 'general' },
    ],
    results: [],
    summary: {
      total: 1,
      grounded: 1,
      weak: 0,
      unsupported: 0,
      flagged: 0,
      critical_hits: 0,
    },
  });

  runToneChecksMock.mockResolvedValue({
    tone: { total: 88, passed: true },
    centroidSimilarity: 0.9,
    passed: true,
  });

  buildZeroImagePromptsMock.mockReturnValue({
    hero: 'hero prompt',
    body: 'body prompt',
    summary: 'summary prompt',
  });

  buildZeroWritingPromptMock.mockReturnValue({
    system: 'sys-zero-writing',
    user: 'user-zero-writing',
  });
}

// ─── tests ─────────────────────────────────────────────────────────────────

describe('POST /api/articles/zero-generate-full (spec §3 + §12)', () => {
  beforeEach(() => {
    articlesInsertCapture.payload = null;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy-anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role';
    process.env.GEMINI_API_KEY = 'dummy-gemini';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── 401 ────────────────────────────────────────────────────────────────

  it('401 を返す — 認証なし', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/認証/);

    expect(themeMaybeSingleMock).not.toHaveBeenCalled();
    expect(generateJsonMock).not.toHaveBeenCalled();
    expect(articlesInsertSingleMock).not.toHaveBeenCalled();
  });

  // ─── 201 全成功 ──────────────────────────────────────────────────────────

  it('201 を返す — 全モジュール成功 + scores / claims_count を返却', async () => {
    setupHappyPath();

    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.article_id).toBe(NEW_ARTICLE_ID);
    expect(body.status).toBe('draft');
    expect(body.generation_mode).toBe('zero');
    expect(body.partial_success).toBe(false);

    // scores / claims_count
    expect(body.scores.hallucination).toBe(92);
    expect(body.scores.yukiko_tone).toBe(88);
    expect(body.scores.centroid_similarity).toBe(0.9);
    expect(body.claims_count).toBe(1);
    expect(body.criticals).toBe(0);
    expect(body.tone_passed).toBe(true);

    // RAG
    expect(body.rag.chunks_count).toBe(1);
    expect(body.rag.status).toBe('ok');

    // image prompts
    expect(body.image_prompts.hero).toBe('hero prompt');
    expect(body.image_prompts.body).toBe('body prompt');
    expect(body.image_prompts.summary).toBe('summary prompt');

    // stages: 必須 ok
    expect(body.stages.outline).toBe('ok');
    expect(body.stages.writing).toBe('ok');
    expect(body.stages.hallucination).toBe('ok');
    expect(body.stages.tone).toBe('ok');
    expect(body.stages.images).toBe('ok');
    expect(body.stages.insert_article).toBe('ok');

    // articles insert payload 確認
    const inserted = articlesInsertCapture.payload;
    expect(inserted).toBeTruthy();
    expect(inserted!.status).toBe('draft');
    expect(inserted!.generation_mode).toBe('zero');
    expect(inserted!.intent).toBe(VALID_BODY.intent);
    expect(inserted!.stage1_outline).toEqual(FIXTURE_OUTLINE);
    expect(inserted!.stage2_body_html).toBe(FIXTURE_BODY_HTML);
    expect(inserted!.hallucination_score).toBe(92);
    expect(inserted!.yukiko_tone_score).toBe(88);
    expect(inserted!.lead_summary).toBe(FIXTURE_OUTLINE.lead_summary);
    expect(inserted!.narrative_arc).toEqual(FIXTURE_OUTLINE.narrative_arc);

    // generateJson は outline + writing で 2 回呼ばれる
    expect(generateJsonMock).toHaveBeenCalledTimes(2);
    // 各検証モジュールが呼ばれている
    expect(retrieveChunksMock).toHaveBeenCalledTimes(1);
    expect(extractClaimsMock).toHaveBeenCalledTimes(1);
    expect(runHallucinationChecksMock).toHaveBeenCalledTimes(1);
    expect(runToneChecksMock).toHaveBeenCalledTimes(1);
    expect(buildZeroImagePromptsMock).toHaveBeenCalledTimes(1);
  });

  // ─── 207 partial ─────────────────────────────────────────────────────────

  it('207 を返す — hallucination が throw しても他段階は継続し partial_success=true', async () => {
    setupHappyPath();
    runHallucinationChecksMock.mockRejectedValueOnce(
      new Error('Gemini judge timeout'),
    );

    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(207);

    const body = await res.json();
    expect(body.partial_success).toBe(true);
    expect(body.article_id).toBe(NEW_ARTICLE_ID);

    // hallucination は failed、他は ok
    expect(body.stages.hallucination).toBe('failed');
    expect(body.stages.outline).toBe('ok');
    expect(body.stages.writing).toBe('ok');
    expect(body.stages.tone).toBe('ok');
    expect(body.stages.insert_article).toBe('ok');

    // hallucination が失敗してもスコアは null で許容
    expect(body.scores.hallucination).toBeNull();

    // articles INSERT は実行され記事は draft で保存される
    const inserted = articlesInsertCapture.payload;
    expect(inserted).toBeTruthy();
    expect(inserted!.hallucination_score).toBeNull();
    expect(inserted!.yukiko_tone_score).toBe(88);
  });
});
