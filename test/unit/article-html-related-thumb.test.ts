/**
 * P5-44: 関連記事サムネイル URL の hubPath 反映 pin テスト
 *
 * 目的:
 *   - generateArticleHtml() の関連記事 (related_articles) ブロックで
 *     thumbSrc が `/column/{slug}/images/hero.jpg` 形式
 *     (env 駆動の hubPath 反映) で生成されることを担保する。
 *   - 旧 `/column/{slug}/images/hero.jpg` ハードコード形式が
 *     再発しないことを完全排除アサーションで検出する。
 *
 * 失敗時の合図:
 *   - 旧 `/column/` (hubPath 抜き) ハードコードが混入した
 *   - hubPath が反映されず slug 抽出が壊れた
 *   - サムネイル <img src=...> が `/{hubPath}/{slug}/images/hero.jpg`
 *     形式から逸脱した
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateArticleHtml } from '@/lib/generators/article-html-generator';
import type { Article } from '@/types/article';

// ─── テスト用フィクスチャ ─────────────────────────────────────────────────

/** 単純な公開済み記事フィクスチャ (related_articles を上書きできる) */
function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'article-uuid-related-0001',
    status: 'published',
    title: 'テスト記事タイトル',
    slug: 'parent-slug',
    content: '<p>本文ダミー。</p>',
    meta_description: 'テスト用メタディスクリプション',
    keyword: 'テスト',
    theme: 'healing',
    persona: 'spiritual_beginner',
    source_article_id: null,
    perspective_type: null,
    target_word_count: 2000,
    stage1_outline: null,
    stage2_body_html:
      '<h2>セクション1</h2><p>段落1の本文。</p><h2>セクション2</h2><p>段落2の本文。</p>',
    stage3_final_html: null,
    published_html: null,
    image_prompts: null,
    image_files: null,
    cta_texts: null,
    faq_data: null,
    structured_data: null,
    seo_score: null,
    related_articles: null,
    published_url: null,
    published_at: '2026-04-01T00:00:00.000Z',
    reviewed_at: null,
    reviewed_by: null,
    created_at: '2026-03-25T00:00:00.000Z',
    updated_at: '2026-03-25T00:00:00.000Z',
    ...overrides,
  };
}

// ─── テスト本体 ────────────────────────────────────────────────────────────

describe('generateArticleHtml() related thumbnail URL pinning (P5-44)', () => {
  beforeEach(() => {
    // env をデフォルトに固定 (default = harmony-mc.com + /column)
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_HUB_PATH', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('case 1: thumbSrc は /column/{slug}/images/hero.jpg 形式 (hubPath 反映)', () => {
    const html = generateArticleHtml(
      makeArticle({
        related_articles: [
          { slug: 'related-slug-1', title: '関連記事1', href: '/column/related-slug-1/' },
        ] as unknown as Article['related_articles'],
      }),
    );
    expect(html).toContain(
      '<img src="/column/related-slug-1/images/hero.jpg" alt="関連記事1"',
    );
  });

  it('case 2: /columns/ 複数形バグ + .html 拡張子が thumb に混入しない', () => {
    const html = generateArticleHtml(
      makeArticle({
        related_articles: [
          { slug: 'related-slug-1', title: '関連記事1', href: '/column/related-slug-1/' },
          { slug: 'related-slug-2', title: '関連記事2', href: '/column/related-slug-2/' },
          { slug: 'related-slug-3', title: '関連記事3', href: '/column/related-slug-3/' },
        ] as unknown as Article['related_articles'],
      }),
    );
    // P5-45: /column/ 配下統一後は /columns/ 複数形 + .html 拡張子の再発防止のみ
    expect(html).not.toContain('/columns/related-slug-1/');
    expect(html).not.toContain('related-slug-1.html');
  });

  it('case 3: 全 3 件の関連記事サムネイルが順番通り新形式で出力される', () => {
    const html = generateArticleHtml(
      makeArticle({
        related_articles: [
          { slug: 'related-slug-1', title: '関連記事1', href: '/column/related-slug-1/' },
          { slug: 'related-slug-2', title: '関連記事2', href: '/column/related-slug-2/' },
          { slug: 'related-slug-3', title: '関連記事3', href: '/column/related-slug-3/' },
        ] as unknown as Article['related_articles'],
      }),
    );

    // すべての関連記事 thumb が hubPath 込みの新形式で並んでいる
    expect(html).toContain('src="/column/related-slug-1/images/hero.jpg"');
    expect(html).toContain('src="/column/related-slug-2/images/hero.jpg"');
    expect(html).toContain('src="/column/related-slug-3/images/hero.jpg"');

    // 出現順が related_articles 配列順と一致 (related-1 → related-2 → related-3)
    const idx1 = html.indexOf('/column/related-slug-1/images/hero.jpg');
    const idx2 = html.indexOf('/column/related-slug-2/images/hero.jpg');
    const idx3 = html.indexOf('/column/related-slug-3/images/hero.jpg');
    expect(idx1).toBeGreaterThan(0);
    expect(idx2).toBeGreaterThan(idx1);
    expect(idx3).toBeGreaterThan(idx2);
  });

  it('case 4: 旧 hardcoded `/column/` 形式の href も新 hubPath 形式 thumb に正規化される (fallback)', () => {
    // 旧データ互換: href が `/column/{slug}/` (hubPath 抜き) で来た場合でも
    // thumbSrc は新形式の `/column/{slug}/images/hero.jpg` で出力されること。
    // (article-html-generator.ts の `.replace(/^\/column\//, '')` fallback で
    //  slug が抽出され、hubPath ベースで thumb URL が再構築される。)
    const html = generateArticleHtml(
      makeArticle({
        related_articles: [
          { slug: 'legacy-slug', title: '旧形式リンクの関連記事', href: '/column/legacy-slug/' },
        ] as unknown as Article['related_articles'],
      }),
    );

    // 新形式の thumb URL が出力されている
    expect(html).toContain(
      '<img src="/column/legacy-slug/images/hero.jpg" alt="旧形式リンクの関連記事"',
    );
    // P5-45: 複数形 / .html 拡張子バグの再発防止
    expect(html).not.toContain('/columns/legacy-slug/');
    expect(html).not.toContain('legacy-slug.html');
  });
});
