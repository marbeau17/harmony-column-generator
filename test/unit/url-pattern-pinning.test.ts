/**
 * P5-44: URL 生成パターン pin テスト
 *
 * 目的:
 *   - generateArticleHtml() / generateHubPage() が新しい URL 規約
 *     ({SITE_URL}/spiritual/column/{slug}/ — 単数形 + trailing slash)
 *     に従うことを担保する。
 *   - 既知の旧バグ (`.html` 拡張子形式 / `/columns/` 複数形) が
 *     再発しないことを完全排除アサーションで検出する。
 *
 * 失敗時の合図:
 *   - 旧 `.html` 拡張子形式が混入した
 *   - ハブパスが `/columns/` (複数) に戻った
 *   - canonical / og:url / og:image が乖離した
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateArticleHtml } from '@/lib/generators/article-html-generator';
import { generateHubPage, type HubPageData } from '@/lib/generators/hub-generator';
import type { Article } from '@/types/article';

// ─── テスト用フィクスチャ ─────────────────────────────────────────────────

/** 単純な公開済み記事フィクスチャ */
function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'article-uuid-0001',
    status: 'published',
    title: 'テスト記事タイトル',
    slug: 'test-slug',
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

/** 単純なハブページデータフィクスチャ */
function makeHubData(overrides: Partial<HubPageData> = {}): HubPageData {
  return {
    articles: [
      {
        id: 'a1',
        title: '記事1',
        slug: 'article-1',
        excerpt: 'テスト抜粋',
        date: '2026/04/01',
        theme: 'healing',
        categoryLabel: '癒しと浄化',
        thumbnailUrl: '/spiritual/column/article-1/images/hero.jpg',
        articleUrl: '/spiritual/column/article-1/',
      },
    ],
    currentPage: 1,
    totalPages: 3,
    categories: [{ slug: 'healing', name: '癒しと浄化', count: 1 }],
    recentArticles: [],
    ...overrides,
  };
}

// ─── テスト本体 ────────────────────────────────────────────────────────────

describe('URL pattern pinning (P5-44 regression guard)', () => {
  beforeEach(() => {
    // env をデフォルトに固定 (default = harmony-mc.com + /spiritual/column)
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_HUB_PATH', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── 記事 HTML ────────────────────────────────────────────────────────
  describe('generateArticleHtml() canonical / OG URL', () => {
    it('case 1: canonical link は /spiritual/column/{slug}/ 形式 (trailing slash 必須)', () => {
      const html = generateArticleHtml(makeArticle({ slug: 'test-slug' }));
      expect(html).toContain(
        '<link rel="canonical" href="https://harmony-mc.com/spiritual/column/test-slug/"',
      );
    });

    it('case 2: 旧 .html 拡張子形式は HTML 内に一切存在しない (test-slug.html)', () => {
      const html = generateArticleHtml(makeArticle({ slug: 'test-slug' }));
      expect(html).not.toContain('test-slug.html');
    });

    it('case 3: 旧 /column/ (単一/複数形) ハードコードが canonical に混じらない', () => {
      const html = generateArticleHtml(makeArticle({ slug: 'test-slug' }));
      // canonical 行だけ抽出 (<link rel="canonical" ... > の中身)
      const match = html.match(/<link rel="canonical" href="([^"]+)"/);
      expect(match).not.toBeNull();
      const canonicalUrl = match?.[1] ?? '';
      expect(canonicalUrl).toBe('https://harmony-mc.com/spiritual/column/test-slug/');
      // 旧 /columns/ 複数形バグの再発防止
      expect(canonicalUrl).not.toContain('/columns/');
      // 旧 .html 拡張子形式の再発防止
      expect(canonicalUrl).not.toMatch(/\.html(?:[?#]|$)/);
    });

    it('case 4: og:url は canonical と同一 (新形式)', () => {
      const html = generateArticleHtml(makeArticle({ slug: 'test-slug' }));
      expect(html).toContain(
        '<meta property="og:url" content="https://harmony-mc.com/spiritual/column/test-slug/"',
      );
    });

    it('case 5: og:image は新形式の /images/{position}.jpg を指す', () => {
      // ogImage オプション未指定の場合でもデフォルトに新形式 path が使われるか、
      // もしくは明示指定された画像が出力されること。
      // ここでは明示的に新形式の og:image を渡し、その値が反映されることを保証する。
      const html = generateArticleHtml(makeArticle({ slug: 'test-slug' }), {
        ogImage: 'https://harmony-mc.com/spiritual/column/test-slug/images/hero.jpg',
      });
      expect(html).toContain(
        '<meta property="og:image" content="https://harmony-mc.com/spiritual/column/test-slug/images/hero.jpg"',
      );
      // 旧 hardcoded URL `https://harmony-mc.com/column/...` が漏れていない
      // (`/spiritual/column/` は `/column/` を substring として含むので、
      //  ホスト直後の `/column/` のみを禁止する形でアサート)
      expect(html).not.toContain('https://harmony-mc.com/column/test-slug/');
    });
  });

  // ── ハブ HTML ────────────────────────────────────────────────────────
  describe('generateHubPage() canonical', () => {
    it('case 6: page 1 の canonical は /spiritual/column/ (単数形 + trailing slash)', () => {
      const html = generateHubPage(makeHubData({ currentPage: 1 }));
      expect(html).toContain(
        '<link rel="canonical" href="https://harmony-mc.com/spiritual/column/"',
      );
    });

    it('case 7: 旧 /columns/ 複数形バグが再発していない', () => {
      const html = generateHubPage(makeHubData({ currentPage: 1 }));
      const match = html.match(/<link rel="canonical" href="([^"]+)"/);
      expect(match).not.toBeNull();
      const canonicalUrl = match?.[1] ?? '';
      // 単数形 /column であって /columns ではない
      expect(canonicalUrl).toContain('/spiritual/column/');
      expect(canonicalUrl).not.toContain('/columns/');
      expect(canonicalUrl).not.toMatch(/\.html(?:[?#]|$)/);
    });

    it('case 8: page 2 以降の canonical は /spiritual/column/page/{N}/ 形式', () => {
      const html = generateHubPage(makeHubData({ currentPage: 2 }));
      expect(html).toContain(
        '<link rel="canonical" href="https://harmony-mc.com/spiritual/column/page/2/"',
      );
      // 旧 /columns/ 形式に戻っていない
      expect(html).not.toContain('/columns/page/');
      // 旧 .html 拡張子形式の再発防止
      const match = html.match(/<link rel="canonical" href="([^"]+)"/);
      expect(match?.[1] ?? '').not.toMatch(/\.html(?:[?#]|$)/);
    });
  });
});
