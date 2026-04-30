// ============================================================================
// test/unit/zero-generate-api.test.ts
// POST /api/articles/zero-generate（spec §12.1, P5-1）の単体テスト
//
// テスト戦略:
//   - 認証クライアント / service role クライアント / Gemini をすべてモック
//   - F7 の buildZeroOutlinePrompt は実物を呼び出して system/user prompt が
//     Gemini モックへ渡される事実確認（spy）
//   - articles INSERT は service role モックで in-memory に捕捉
//
// 検証ケース:
//   1. body 検証エラー → 400
//   2. 認証なし → 401
//   3. 正常系 → outline 生成 + articles INSERT + article_id 返却
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

// ─── モック宣言（vi.mock は hoist されるため vi.hoisted で安全に共有） ────

const mocks = vi.hoisted(() => {
  return {
    authGetUserMock: vi.fn(),
    themeMaybeSingleMock: vi.fn(),
    personaMaybeSingleMock: vi.fn(),
    articlesInsertSingleMock: vi.fn(),
    generateJsonMock: vi.fn(),
    articlesInsertCapture: { payload: null as Record<string, unknown> | null },
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
  };
});

vi.mock('@/lib/ai/gemini-client', () => {
  return {
    generateJson: mocks.generateJsonMock,
    // 他の export は本テストでは不要だが型解決のためダミーで残す
    callGemini: vi.fn(),
    generateText: vi.fn(),
    generateImage: vi.fn(),
    generateEmbedding: vi.fn(),
    estimateTokens: (s: string) => s.length,
  };
});

// session-guard はテストでは無効化（route 内は createArticle を経由しないため
// 直接呼ばれないが、インポート連鎖で経由する場合に備えてバイパス）
vi.mock('@/lib/publish-control/session-guard', () => ({
  assertArticleWriteAllowed: vi.fn(),
  assertArticleDeleteAllowed: vi.fn(),
}));

// ─── 既存変数名でアクセスしやすくするためのエイリアス ────────────────────────

const authGetUserMock = mocks.authGetUserMock;
const themeMaybeSingleMock = mocks.themeMaybeSingleMock;
const personaMaybeSingleMock = mocks.personaMaybeSingleMock;
const articlesInsertSingleMock = mocks.articlesInsertSingleMock;
const generateJsonMock = mocks.generateJsonMock;
const articlesInsertCapture = mocks.articlesInsertCapture;

// ─── 動的 import（モック適用後） ─────────────────────────────────────────────

// route ハンドラ本体
import { POST } from '@/app/api/articles/zero-generate/route';
// F7 prompt builder の spy のため
import * as zeroOutlineModule from '@/lib/ai/prompts/stage1-zero-outline';

// ─── ヘルパ ─────────────────────────────────────────────────────────────────

const VALID_BODY = {
  theme_id: '11111111-1111-1111-1111-111111111111',
  persona_id: '22222222-2222-2222-2222-222222222222',
  keywords: ['ペットロス', '立ち直り方'],
  intent: 'empathy' as const,
  target_length: 2000,
};

const FIXTURE_OUTLINE: zeroOutlineModule.ZeroOutlineOutput = {
  lead_summary:
    'ペットを失った悲しみは、時間が癒やすものではないかもしれません。それでも、いまここで小さく息を整える方法があります。',
  narrative_arc: {
    opening_hook: { type: 'empathy', text: 'あの子がいない朝が来るたび' },
    awareness: '悲しみの形は人それぞれ',
    wavering: 'けれど、忘れたいわけじゃない',
    acceptance: '思い出は、いまも一緒に呼吸している',
    action: '今日はひとつだけ、深呼吸をしてみてくださいね',
    closing_style: 'lingering',
  },
  emotion_curve: [-1, -2, 1, 2],
  h2_chapters: [
    { title: 'あの子のいない朝', summary: '...', target_chars: 500, arc_phase: 'awareness' },
    { title: '揺れる気持ち', summary: '...', target_chars: 500, arc_phase: 'wavering' },
    { title: 'そのままでいい', summary: '...', target_chars: 500, arc_phase: 'acceptance' },
    { title: '小さな一歩', summary: '...', target_chars: 500, arc_phase: 'action' },
  ],
  citation_highlights: [
    'ハイライト1（80〜120字相当のテキスト）'.padEnd(80, '。'),
    'ハイライト2（80〜120字相当のテキスト）'.padEnd(80, '。'),
    'ハイライト3（80〜120字相当のテキスト）'.padEnd(80, '。'),
  ],
  faq_items: [
    { q: 'ペットロスはどれくらい続きますか', a: '人それぞれです……' },
    { q: '泣いてばかりで眠れません', a: 'いいんです……' },
  ],
  image_prompts: [
    { slot: 'hero', prompt: '柔らかい朝日と窓辺の小さな影' },
    { slot: 'body', prompt: '木漏れ日の中の散歩道' },
    { slot: 'summary', prompt: '優しい光に包まれた夕暮れ' },
  ],
};

const NEW_ARTICLE_ID = '99999999-9999-9999-9999-999999999999';

function makeReq(body: unknown): NextRequest {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
  return new NextRequest(
    new Request('http://localhost/api/articles/zero-generate', init),
  );
}

function setupSupabaseHappyPath() {
  // 認証 OK
  authGetUserMock.mockResolvedValue({
    data: { user: { id: 'user-abc', email: 'tester@example.com' } },
  });

  // theme / persona ヒット
  themeMaybeSingleMock.mockResolvedValue({
    data: {
      id: VALID_BODY.theme_id,
      name: 'ペットロス',
      category: 'healing',
    },
    error: null,
  });
  personaMaybeSingleMock.mockResolvedValue({
    data: {
      id: VALID_BODY.persona_id,
      name: '30代女性 / ペットを亡くしたばかり',
      age_range: '30s',
      tone_guide: 'やさしく寄り添う',
    },
    error: null,
  });

  // articles INSERT 成功
  articlesInsertSingleMock.mockResolvedValue({
    data: { id: NEW_ARTICLE_ID },
    error: null,
  });

  // Gemini outline 返却
  generateJsonMock.mockResolvedValue({
    data: FIXTURE_OUTLINE,
    response: {
      text: JSON.stringify(FIXTURE_OUTLINE),
      finishReason: 'STOP',
      tokenUsage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
    },
  });
}

// ─── テスト ─────────────────────────────────────────────────────────────────

describe('POST /api/articles/zero-generate (spec §12.1)', () => {
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

  it('401 を返す — 認証なし（auth.getUser が user=null）', async () => {
    authGetUserMock.mockResolvedValue({ data: { user: null } });

    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/認証/);

    // 後続の DB / Gemini は呼ばれていない
    expect(themeMaybeSingleMock).not.toHaveBeenCalled();
    expect(personaMaybeSingleMock).not.toHaveBeenCalled();
    expect(generateJsonMock).not.toHaveBeenCalled();
    expect(articlesInsertSingleMock).not.toHaveBeenCalled();
  });

  // ─── 400 系 ─────────────────────────────────────────────────────────────

  describe('400 — body 検証エラー', () => {
    beforeEach(() => {
      authGetUserMock.mockResolvedValue({
        data: { user: { id: 'user-abc' } },
      });
    });

    it('theme_id が UUID でない', async () => {
      const res = await POST(
        makeReq({ ...VALID_BODY, theme_id: 'not-a-uuid' }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/バリデーション/);
      expect(body.details).toBeDefined();
      expect(generateJsonMock).not.toHaveBeenCalled();
    });

    it('keywords が空配列', async () => {
      const res = await POST(makeReq({ ...VALID_BODY, keywords: [] }));
      expect(res.status).toBe(400);
      expect(generateJsonMock).not.toHaveBeenCalled();
    });

    it('keywords が 9 件以上', async () => {
      const res = await POST(
        makeReq({
          ...VALID_BODY,
          keywords: ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9'],
        }),
      );
      expect(res.status).toBe(400);
      expect(generateJsonMock).not.toHaveBeenCalled();
    });

    it('intent が enum 外', async () => {
      const res = await POST(
        makeReq({ ...VALID_BODY, intent: 'unknown' as unknown as string }),
      );
      expect(res.status).toBe(400);
      expect(generateJsonMock).not.toHaveBeenCalled();
    });

    it('target_length が 500 未満', async () => {
      const res = await POST(makeReq({ ...VALID_BODY, target_length: 100 }));
      expect(res.status).toBe(400);
      expect(generateJsonMock).not.toHaveBeenCalled();
    });

    it('target_length が 10000 超', async () => {
      const res = await POST(
        makeReq({ ...VALID_BODY, target_length: 99999 }),
      );
      expect(res.status).toBe(400);
      expect(generateJsonMock).not.toHaveBeenCalled();
    });

    it('JSON が壊れている', async () => {
      const res = await POST(makeReq('this is not json'));
      expect(res.status).toBe(400);
      expect(generateJsonMock).not.toHaveBeenCalled();
    });
  });

  // ─── 正常系 ─────────────────────────────────────────────────────────────

  it('正常系 — outline 生成 + articles INSERT + 201 で article_id 返却', async () => {
    setupSupabaseHappyPath();

    // F7 prompt builder が呼ばれることを spy（中身は実物を実行）
    const buildSpy = vi.spyOn(zeroOutlineModule, 'buildZeroOutlinePrompt');

    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.article_id).toBe(NEW_ARTICLE_ID);
    expect(body.status).toBe('draft');
    expect(body.lead_summary).toBe(FIXTURE_OUTLINE.lead_summary);
    expect(body.narrative_arc).toEqual(FIXTURE_OUTLINE.narrative_arc);

    // F7 prompt builder が呼ばれている（ZeroOutlineInput 形式で）
    expect(buildSpy).toHaveBeenCalledTimes(1);
    const builderArg = buildSpy.mock.calls[0][0];
    expect(builderArg.theme.id).toBe(VALID_BODY.theme_id);
    expect(builderArg.theme.name).toBe('ペットロス');
    expect(builderArg.persona.id).toBe(VALID_BODY.persona_id);
    expect(builderArg.keywords).toEqual(VALID_BODY.keywords);
    expect(builderArg.intent).toBe(VALID_BODY.intent);
    expect(builderArg.target_length).toBe(VALID_BODY.target_length);

    // Gemini が呼ばれた（system/user は文字列、temperature/topP がスペック準拠）
    expect(generateJsonMock).toHaveBeenCalledTimes(1);
    const [systemArg, userArg, optsArg] = generateJsonMock.mock.calls[0];
    expect(typeof systemArg).toBe('string');
    expect(systemArg.length).toBeGreaterThan(0);
    expect(typeof userArg).toBe('string');
    expect(userArg.length).toBeGreaterThan(0);
    expect(optsArg).toMatchObject({
      temperature: zeroOutlineModule.ZERO_OUTLINE_TEMPERATURE,
      topP: 0.9,
    });

    // articles INSERT の payload が ZG モードで保存されていること
    const inserted = articlesInsertCapture.payload;
    expect(inserted).toBeTruthy();
    expect(inserted!.status).toBe('draft');
    expect(inserted!.generation_mode).toBe('zero');
    expect(inserted!.intent).toBe(VALID_BODY.intent);
    expect(inserted!.target_word_count).toBe(VALID_BODY.target_length);
    expect(inserted!.theme).toBe('ペットロス');
    expect(inserted!.stage1_outline).toEqual(FIXTURE_OUTLINE);
    expect(inserted!.lead_summary).toBe(FIXTURE_OUTLINE.lead_summary);
    expect(inserted!.narrative_arc).toEqual(FIXTURE_OUTLINE.narrative_arc);

    buildSpy.mockRestore();
  });

  // ─── 500 系（補助） ─────────────────────────────────────────────────────

  it('500 を返す — theme が見つからない', async () => {
    setupSupabaseHappyPath();
    themeMaybeSingleMock.mockResolvedValue({ data: null, error: null });

    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/theme not found/);
    // Gemini / articles 段階に到達しない
    expect(generateJsonMock).not.toHaveBeenCalled();
    expect(articlesInsertSingleMock).not.toHaveBeenCalled();
  });

  it('500 を返す — Gemini が失敗', async () => {
    setupSupabaseHappyPath();
    generateJsonMock.mockRejectedValueOnce(new Error('Gemini timeout'));

    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/Gemini timeout/);
    // articles INSERT に到達しない
    expect(articlesInsertSingleMock).not.toHaveBeenCalled();
  });
});
