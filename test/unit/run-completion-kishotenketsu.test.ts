// ============================================================================
// test/unit/run-completion-kishotenketsu.test.ts
//
// P5-101: runZeroGenCompletion の起承転結 412 ガード + 転 H2 post-validate。
//
// spec: docs/specs/kishotenketsu-flow.md §5.2 (run-completion ガード)
//        / §5.4 (検証ポイント)
//        / §10 P5-101 (post-validate に core_message / 転換語含有チェック)
//
// 対象ケース:
//   TC1: flag OFF + zero + approved_at null  → 通常進行 (gate skip)
//   TC2: flag ON  + zero + approved_at null  → throw "起承転結が未承認"
//   TC3: flag ON  + source-mode + null       → 通常進行 (zero only gate)
//   TC4: flag ON  + zero + approved_at set   → 通常進行
//   TC5: post-validate (転 H2 内に転換語の有無で logger.warn)
//
// 注意: 実 DB / 実 Gemini / 実 FTP は使用しない。すべて vi.mock。
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── logger を spy 可能なモックに差し替える ────────────────────────────────
// 公開ガード違反時の logger.warn / 転換語不在時の logger.warn を assert する。
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    timed: vi.fn(),
  },
}));

// ─── Supabase / Gemini を全モック (run-completion-validation.test.ts mirror) ─
const mockArticleSelect = vi.fn();
const mockArticleUpdate = vi.fn();
const mockRevisionInsert = vi.fn();
const mockSettingsSelect = vi.fn();
const mockUpload = vi.fn();
const mockGetPublicUrl = vi.fn(() => ({ data: { publicUrl: 'https://example.com/img.jpg' } }));
const mockGenerateImage = vi.fn();
const mockGenerateText = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: async () => ({
    from: (tbl: string) => {
      if (tbl === 'articles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => mockArticleSelect(),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            mockArticleUpdate(payload);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      if (tbl === 'article_revisions') {
        return {
          insert: (payload: Record<string, unknown>) => {
            mockRevisionInsert(payload);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (tbl === 'settings') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => mockSettingsSelect(),
            }),
          }),
        };
      }
      return {};
    },
    storage: {
      from: () => ({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
      }),
    },
  }),
}));

vi.mock('@/lib/ai/gemini-client', () => ({
  generateImage: (...args: unknown[]) => mockGenerateImage(...args),
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  // 起承転結 quality_check で参照される generateJson も safety で mock 化
  generateJson: vi.fn(),
}));

vi.mock('@/lib/generators/article-html-generator', () => ({
  generateArticleHtml: (article: { stage2_body_html: string }) =>
    `<html><body>${article.stage2_body_html}</body></html>`.repeat(15),
}));

vi.mock('@/lib/seo/meta-generator', () => ({
  generateMetaDescription: (kw: string, lead: string) =>
    `${kw} と ${lead} に関する詳細記事です。`.padEnd(120, '.'),
  generateSlug: () => 'test-slug',
}));

// 公開向け HTML 整合チェックは zero-mode で常に走るため
// 「passed: true」を返すスタブで素通りさせる (本テストの対象外)。
vi.mock('@/lib/deploy/article-html-builder', () => ({
  buildDeployHtml: (article: { stage2_body_html: string }) => ({
    html: `<!DOCTYPE html><html><body>${article.stage2_body_html}<div class="harmony-cta-inner"></div><div class="harmony-cta-inner"></div></body></html>`,
  }),
}));
vi.mock('@/lib/content/html-template-validator', () => ({
  runTemplateCheck: () => ({ passed: true, failures: [] }),
}));

// production code import (parallel agent 完了前は throw 場所が違うかもしれない)
const { runZeroGenCompletion } = await import('@/lib/zero-gen/run-completion');
const { logger } = await import('@/lib/logger');

// ─── ベースとなる article fixture ───────────────────────────────────────────
//
// kishotenketsu_phase: 'ten' に対応する H2 を 1 つだけ独立させる。
// 転 H2 配下の <p> に転換語 (「けれど」など) が含まれているかで
// post-validate (TC5) の挙動を切替える。
function buildBody(args: { tenHasTransitionWord: boolean }): string {
  const tenLead = args.tenHasTransitionWord
    ? '<p>けれど、視点を一段ずらしてみると、別の景色が見えてきます。</p>'
    : '<p>そして、その気づきはとても大切なものです。</p>';
  return [
    '<h2 id="section-1">起：気づきの夜</h2>',
    '<p>夜にふと心が静まりかえる瞬間がありますね。</p>'.repeat(3),
    '<h2 id="section-2">承：欠落と感じる声</h2>',
    '<p>その感覚は実は多くの人が抱えているものです。</p>'.repeat(3),
    '<h2 id="section-3">転：扉としての孤独</h2>',
    tenLead,
    '<p>承の前提を問い直してみてくださいね。</p>'.repeat(3),
    '<h2 id="section-4">結：今日からのちいさな一歩</h2>',
    '<p>今日は深呼吸を 5 分してみてくださいね。</p>'.repeat(3),
  ].join('');
}

const baseArticle = {
  id: 'art-001',
  title: 'タイトル',
  slug: 'art-001',
  theme: '孤独',
  keyword: 'カウンセリング 孤独',
  lead_summary: 'リード文 リード文 リード文 リード文',
  generation_mode: 'zero',
  stage2_body_html: buildBody({ tenHasTransitionWord: true }),
  image_files: [
    { position: 'hero', url: 'h.jpg', alt: 'h', filename: 'hero.webp' },
    { position: 'body', url: 'b.jpg', alt: 'b', filename: 'body.webp' },
    { position: 'summary', url: 's.jpg', alt: 's', filename: 'summary.webp' },
  ],
  image_prompts: [
    { position: 'hero', prompt: 'p' },
    { position: 'body', prompt: 'p' },
    { position: 'summary', prompt: 'p' },
  ],
  stage1_outline: {
    image_prompts: [],
    h2_chapters: [
      { title: '起：気づきの夜', kishotenketsu_phase: 'ki' },
      { title: '承：欠落と感じる声', kishotenketsu_phase: 'sho' },
      { title: '転：扉としての孤独', kishotenketsu_phase: 'ten' },
      { title: '結：今日からのちいさな一歩', kishotenketsu_phase: 'ketsu' },
    ],
  },
  meta_description: 'テスト用 meta description テスト用 meta description テスト用 meta description テスト用 meta description'.padEnd(120, '.'),
  seo_filename: 'test',
  kishotenketsu: {
    ki: 'KI', sho: 'SHO', ten: 'TEN', ketsu: 'KETSU',
    ten_perspective_shift: '視点を変えました',
  },
  kishotenketsu_approved_at: null as string | null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateImage.mockResolvedValue({
    imageBuffer: Buffer.from([]),
    mimeType: 'image/jpeg',
  });
  mockUpload.mockResolvedValue({ error: null });
  mockSettingsSelect.mockResolvedValue({ data: null });
  // env 変数のデフォルトはクリア
  delete process.env.NEXT_PUBLIC_KISHOTENKETSU_ENABLED;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_KISHOTENKETSU_ENABLED;
});

// ─── TC1: flag OFF + zero + approved_at null → 通常進行 (gate skip) ─────────

describe('runZeroGenCompletion kishotenketsu gate — TC1: flag OFF', () => {
  it('TC1: flag OFF なら approved_at が null でも throw しない', async () => {
    process.env.NEXT_PUBLIC_KISHOTENKETSU_ENABLED = 'false';
    mockArticleSelect.mockResolvedValue({
      data: { ...baseArticle, kishotenketsu_approved_at: null },
      error: null,
    });
    // 通常進行することのみ確認 (validation issue は他テストの対象)
    await expect(
      runZeroGenCompletion({ articleId: 'art-001' }),
    ).resolves.toBeDefined();
  });
});

// ─── TC2: flag ON + zero + approved_at null → throw ─────────────────────────

describe('runZeroGenCompletion kishotenketsu gate — TC2: flag ON + null', () => {
  it('TC2: flag ON + zero + approved_at null なら "起承転結が未承認" を含むエラーで throw', async () => {
    process.env.NEXT_PUBLIC_KISHOTENKETSU_ENABLED = 'true';
    mockArticleSelect.mockResolvedValue({
      data: { ...baseArticle, kishotenketsu_approved_at: null },
      error: null,
    });
    await expect(
      runZeroGenCompletion({ articleId: 'art-001' }),
    ).rejects.toThrow(/起承転結.*未承認/);
  });
});

// ─── TC3: flag ON + source-mode + null → 通常進行 (zero only gate) ─────────

describe('runZeroGenCompletion kishotenketsu gate — TC3: source-mode 例外', () => {
  it('TC3: flag ON でも source-mode なら gate 無効 (zero only)', async () => {
    process.env.NEXT_PUBLIC_KISHOTENKETSU_ENABLED = 'true';
    mockArticleSelect.mockResolvedValue({
      data: {
        ...baseArticle,
        generation_mode: 'source',
        kishotenketsu_approved_at: null,
      },
      error: null,
    });
    await expect(
      runZeroGenCompletion({ articleId: 'art-001' }),
    ).resolves.toBeDefined();
  });
});

// ─── TC4: flag ON + zero + approved_at set → 通常進行 ──────────────────────

describe('runZeroGenCompletion kishotenketsu gate — TC4: 承認済み', () => {
  it('TC4: flag ON + zero + approved_at セット済みなら通常進行', async () => {
    process.env.NEXT_PUBLIC_KISHOTENKETSU_ENABLED = 'true';
    mockArticleSelect.mockResolvedValue({
      data: {
        ...baseArticle,
        kishotenketsu_approved_at: '2026-05-09T00:00:00Z',
      },
      error: null,
    });
    await expect(
      runZeroGenCompletion({ articleId: 'art-001' }),
    ).resolves.toBeDefined();
  });
});

// ─── TC5: post-validate 転換語含有 ─────────────────────────────────────────

describe('runZeroGenCompletion post-validate — TC5: 転 H2 転換語', () => {
  it('TC5-A: 転 H2 内に転換語あり → transition_word_absent warn は呼ばれない', async () => {
    process.env.NEXT_PUBLIC_KISHOTENKETSU_ENABLED = 'true';
    mockArticleSelect.mockResolvedValue({
      data: {
        ...baseArticle,
        kishotenketsu_approved_at: '2026-05-09T00:00:00Z',
        stage2_body_html: buildBody({ tenHasTransitionWord: true }),
      },
      error: null,
    });
    await runZeroGenCompletion({ articleId: 'art-001' });
    const warnCalls = (logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const hit = warnCalls.find(
      (c) => Array.isArray(c) && typeof c[1] === 'string' && c[1].includes('transition_word_absent'),
    );
    expect(hit).toBeUndefined();
  });

  it('TC5-B: 転 H2 内に転換語が無ければ logger.warn(transition_word_absent) が呼ばれる', async () => {
    process.env.NEXT_PUBLIC_KISHOTENKETSU_ENABLED = 'true';
    mockArticleSelect.mockResolvedValue({
      data: {
        ...baseArticle,
        kishotenketsu_approved_at: '2026-05-09T00:00:00Z',
        stage2_body_html: buildBody({ tenHasTransitionWord: false }),
      },
      error: null,
    });
    await runZeroGenCompletion({ articleId: 'art-001' });
    const warnCalls = (logger.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const hit = warnCalls.find(
      (c) => Array.isArray(c) && typeof c[1] === 'string' && c[1].includes('transition_word_absent'),
    );
    expect(hit).toBeDefined();
  });
});
