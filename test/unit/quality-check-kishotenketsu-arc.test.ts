// ============================================================================
// test/unit/quality-check-kishotenketsu-arc.test.ts
//
// P5-102: quality_check の `kishotenketsu_arc` (Gemini 構成判定) を検証する。
//
// spec: docs/specs/kishotenketsu-flow.md §8.1 / §8.4
//
// 対象ケース:
//   TC1: kishotenketsu null      → status='warn',  detail='プラン未生成のため判定スキップ'
//   TC2: body < 800 chars        → status='fail',  detail='本文が短すぎて...'
//   TC3: Gemini 成功 (all true)  → status='pass'
//   TC4: Gemini 失敗 (throw)     → status='warn',  detail='AI 判定エラー...'
//
// 注意: 実 Gemini は呼ばない。`@/lib/ai/gemini-client` を vi.mock で固定。
//        production code 名 (checkKishotenketsuArc / runQualityChecklistAsync)
//        は P5-102 の並列 agent が実装する。本テストは仕様書に沿って先行配置。
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Gemini を mock 化 (実 API は呼ばない) ──────────────────────────────────
vi.mock('@/lib/ai/gemini-client', () => ({
  generateJson: vi.fn(),
  // 周辺コードが import する可能性のある関数も safety で stub
  generateText: vi.fn(),
}));

// logger も spy 可能なモックに
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    timed: vi.fn(),
  },
}));

import { generateJson } from '@/lib/ai/gemini-client';
// production code (P5-102) は src/lib/content/checks/ に分離されている。
import { checkKishotenketsuArc } from '@/lib/content/checks/kishotenketsu-arc';

const generateJsonMock = generateJson as unknown as ReturnType<typeof vi.fn>;

// ─── テストフィクスチャ ─────────────────────────────────────────────────────

const VALID_PLAN = {
  ki:
    '最近、夜にふと心が静まりかえる瞬間はありませんか。' +
    '何でもない日常のなかで、少しだけ立ち止まりたくなる時間があるのかもしれません。',
  sho:
    'その静けさは、実は多くの人が同じように抱えているものなんです。' +
    '言葉にできないけれど心の奥でずっと響いている声があります。',
  ten:
    'でも視点を少し変えてみると、その静けさは欠落ではなく、自分と出会う扉かもしれません。' +
    '心が抵抗するときこそ、扉の向こうに気づきが待っています。',
  ketsu:
    '今日はひとつだけ、深呼吸をしてみてくださいね。小さな一歩が明日のあなたをそっと支えてくれます。' +
    '焦らず、自分のペースで歩いていきましょう。',
  ten_perspective_shift:
    '孤独を欠落と捉える視点から、孤独は自分と出会う扉と捉える視点へ角度を90度ずらしました。',
};

// 本文 800 文字以上を保証 (stripHtml 後でも 800+ になるよう <p> を厚めに重ねる)
function buildLongBodyHtml(): string {
  const paragraph =
    '<p>夜にふと心が静まりかえる瞬間がありますね。' +
    'その静けさは、実は多くの人が抱えているものなんです。' +
    'けれど、視点を少し変えてみると、欠落ではなく扉として現れます。' +
    '今日は深呼吸を 5 分だけしてみてくださいね。</p>';
  return paragraph.repeat(20);
}

// 本文 800 文字未満 (約 60 字 × 1)
const SHORT_BODY_HTML = '<p>短い本文です。' + 'あ'.repeat(50) + '</p>';

const baseArticle = {
  id: 'art-arc-001',
  title: 'タイトル',
  slug: 'art-arc-001',
  stage2_body_html: buildLongBodyHtml(),
  kishotenketsu: VALID_PLAN as Record<string, string>,
} as unknown as Parameters<typeof checkKishotenketsuArc>[0];

beforeEach(() => {
  vi.clearAllMocks();
  generateJsonMock.mockReset();
});

// ─── TC1: kishotenketsu null → warn (skip) ──────────────────────────────────

describe('checkKishotenketsuArc — TC1: kishotenketsu null', () => {
  it('TC1: kishotenketsu が null なら status=warn / detail に「プラン未生成」', async () => {
    const article = {
      ...baseArticle,
      kishotenketsu: null,
    } as unknown as Parameters<typeof checkKishotenketsuArc>[0];
    const items = await checkKishotenketsuArc(article);
    expect(items.length).toBeGreaterThan(0);
    const arc = items.find((i) => i.id === 'kishotenketsu_arc');
    expect(arc).toBeDefined();
    expect(arc!.status).toBe('warn');
    expect(arc!.detail).toContain('プラン未生成');
    // Gemini は呼ばれない (course skip)
    expect(generateJsonMock).not.toHaveBeenCalled();
  });

  it('TC1-2: kishotenketsu が undefined でも skip 扱い', async () => {
    const article = {
      ...baseArticle,
      kishotenketsu: undefined,
    } as unknown as Parameters<typeof checkKishotenketsuArc>[0];
    const items = await checkKishotenketsuArc(article);
    const arc = items.find((i) => i.id === 'kishotenketsu_arc');
    expect(arc?.status).toBe('warn');
    expect(generateJsonMock).not.toHaveBeenCalled();
  });
});

// ─── TC2: body < 800 chars → fail ───────────────────────────────────────────

describe('checkKishotenketsuArc — TC2: body 短すぎ', () => {
  it('TC2: body_html stripped < 800 字なら status=fail / detail に「本文が短すぎ」', async () => {
    const article = {
      ...baseArticle,
      stage2_body_html: SHORT_BODY_HTML,
    } as unknown as Parameters<typeof checkKishotenketsuArc>[0];
    const items = await checkKishotenketsuArc(article);
    const arc = items.find((i) => i.id === 'kishotenketsu_arc');
    expect(arc).toBeDefined();
    expect(arc!.status).toBe('fail');
    expect(arc!.detail).toContain('本文が短すぎ');
    // Gemini は呼ばれない (cost saving)
    expect(generateJsonMock).not.toHaveBeenCalled();
  });
});

// ─── TC3: Gemini 成功 (all true) → pass ─────────────────────────────────────

describe('checkKishotenketsuArc — TC3: Gemini all-true', () => {
  it('TC3: Gemini が all true を返したら status=pass', async () => {
    generateJsonMock.mockResolvedValueOnce({
      data: {
        ki_identifiable: true,
        sho_identifiable: true,
        ten_identifiable: true,
        ten_pivot_explicit: true,
        ketsu_identifiable: true,
        missing: [],
        reason: '4 段すべて識別可能で転換も明示',
      },
      response: { text: '' },
    });
    const items = await checkKishotenketsuArc(baseArticle);
    const arc = items.find((i) => i.id === 'kishotenketsu_arc');
    expect(arc).toBeDefined();
    expect(arc!.status).toBe('pass');
    expect(generateJsonMock).toHaveBeenCalledTimes(1);
  });

  it('TC3-2: Gemini が ten_pivot_explicit=false を返したら fail (転換不明瞭)', async () => {
    generateJsonMock.mockResolvedValueOnce({
      data: {
        ki_identifiable: true,
        sho_identifiable: true,
        ten_identifiable: true,
        ten_pivot_explicit: false,
        ketsu_identifiable: true,
        missing: [],
        reason: '転は識別できるが視点転換が不明瞭',
      },
      response: { text: '' },
    });
    const items = await checkKishotenketsuArc(baseArticle);
    const arc = items.find((i) => i.id === 'kishotenketsu_arc');
    expect(arc!.status).toBe('fail');
    expect(arc!.detail).toContain('ten');
  });
});

// ─── TC4: Gemini 失敗 (throw) → warn ────────────────────────────────────────

describe('checkKishotenketsuArc — TC4: Gemini エラー', () => {
  it('TC4: Gemini が throw したら status=warn / detail に「AI 判定エラー」', async () => {
    generateJsonMock.mockRejectedValueOnce(new Error('Gemini timeout'));
    const items = await checkKishotenketsuArc(baseArticle);
    const arc = items.find((i) => i.id === 'kishotenketsu_arc');
    expect(arc).toBeDefined();
    expect(arc!.status).toBe('warn');
    expect(arc!.detail).toContain('AI 判定エラー');
    // 公開はブロックしない安全側 (severity=warning 固定 §8.4-1)
    expect(arc!.severity).toBe('warning');
  });

  it('TC4-2: Gemini が malformed JSON で throw しても warn で握る (silent done 回避)', async () => {
    generateJsonMock.mockRejectedValueOnce(new SyntaxError('Unexpected token'));
    const items = await checkKishotenketsuArc(baseArticle);
    const arc = items.find((i) => i.id === 'kishotenketsu_arc');
    expect(arc!.status).toBe('warn');
    expect(arc!.detail).toContain('AI 判定エラー');
  });
});
