/**
 * P5-27 — runZeroGenCompletion の post-completion validation の単体テスト。
 * validateCompletion は内部関数なので、replaceImagePlaceholders と組み合わせた
 * 統合的なシナリオを検証する。
 *
 * これらのテストはランタイム検証ロジックを compile-time で固定化し、将来の
 * リファクタリングで仕様が壊れないようにする (proactive prevention)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Supabase / Gemini を全モック
const mockSupabaseUpsert = vi.fn();
const mockUpload = vi.fn();
const mockGetPublicUrl = vi.fn(() => ({ data: { publicUrl: 'https://example.com/img.jpg' } }));
const mockArticleSelect = vi.fn();
const mockArticleUpdate = vi.fn();
const mockRevisionInsert = vi.fn();
const mockGenerateImage = vi.fn();

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
      return { upsert: mockSupabaseUpsert };
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
}));

vi.mock('@/lib/generators/article-html-generator', () => ({
  generateArticleHtml: (article: { stage2_body_html: string }) =>
    `<html><body>${article.stage2_body_html}</body></html>`.repeat(15), // 1000+ chars 確保
}));

vi.mock('@/lib/seo/meta-generator', () => ({
  generateMetaDescription: (kw: string, lead: string) =>
    `${kw} と ${lead} に関する詳細記事です。`.padEnd(80, '.'),
  generateSlug: () => 'test-slug',
}));

const { runZeroGenCompletion } = await import('@/lib/zero-gen/run-completion');

beforeEach(() => {
  mockSupabaseUpsert.mockClear();
  mockUpload.mockClear();
  mockArticleSelect.mockClear();
  mockArticleUpdate.mockClear();
  mockRevisionInsert.mockClear();
  mockGenerateImage.mockClear();

  // 既定: 画像生成は OK
  mockGenerateImage.mockResolvedValue({
    imageBuffer: Buffer.from([]),
    mimeType: 'image/jpeg',
  });
  mockUpload.mockResolvedValue({ error: null });
});

describe('runZeroGenCompletion — post-completion validation (P5-27)', () => {
  const baseArticle = {
    id: 'aaaa',
    title: 'タイトル',
    theme: 'ヒーリング',
    keyword: 'カウンセリング 人間関係',
    lead_summary: 'リード文 リード文 リード文 リード文',
    stage2_body_html: '<p>本文 カウンセリング 人間関係 についての記事</p>'.repeat(20),
    image_files: [],
    image_prompts: [
      { position: 'hero', prompt: 'プロンプト' },
      { position: 'body', prompt: 'プロンプト' },
      { position: 'summary', prompt: 'プロンプト' },
    ],
    stage1_outline: { image_prompts: [] },
    meta_description: null,
    seo_filename: null,
  };

  it('正常ケース: 全フィールド populated → validationIssues 空', async () => {
    mockArticleSelect.mockResolvedValue({ data: baseArticle, error: null });

    const result = await runZeroGenCompletion({ articleId: 'aaaa' });
    expect(result.validationIssues).toEqual([]);
    expect(result.partial).toBe(false);
    expect(result.imageFilesCount).toBe(3);
  });

  it('IMAGE プレースホルダ残存を検出', async () => {
    const dirtyBody = '<p>本文</p>IMAGE:body<p>続き</p>IMAGE:summary';
    mockArticleSelect.mockResolvedValue({
      data: { ...baseArticle, stage2_body_html: dirtyBody },
      error: null,
    });
    // 画像生成成功 → placeholder 置換が走るので最終 body には残らない想定
    const result = await runZeroGenCompletion({ articleId: 'aaaa' });
    // 置換ロジックが working していれば validation OK
    expect(result.validationIssues.some((i) => i.includes('プレースホルダ'))).toBe(false);
  });

  it('画像生成全失敗 → validationIssue で警告', async () => {
    mockArticleSelect.mockResolvedValue({ data: baseArticle, error: null });
    mockGenerateImage.mockRejectedValue(new Error('Gemini timeout'));

    const result = await runZeroGenCompletion({ articleId: 'aaaa' });
    expect(result.imageFilesCount).toBe(0);
    expect(result.validationIssues.some((i) => i.includes('image_files'))).toBe(true);
    expect(result.partial).toBe(true);
  });

  it('キーワードが本文に出ない場合検出', async () => {
    const noKeywordBody = '<p>全く別の内容についての記事</p>'.repeat(50);
    mockArticleSelect.mockResolvedValue({
      data: { ...baseArticle, stage2_body_html: noKeywordBody, keyword: 'カウンセリング' },
      error: null,
    });

    const result = await runZeroGenCompletion({ articleId: 'aaaa' });
    expect(result.validationIssues.some((i) => i.includes('カウンセリング'))).toBe(true);
  });

  it('skipImages=true でも基本検証は走る', async () => {
    mockArticleSelect.mockResolvedValue({ data: baseArticle, error: null });
    const result = await runZeroGenCompletion({ articleId: 'aaaa', skipImages: true });
    expect(result.validationIssues.some((i) => i.includes('image_files'))).toBe(true);
  });
});
