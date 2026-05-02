/**
 * P5-44 後リグレッションガード: hub-generator URL パターン pin テスト
 *
 * 目的:
 *   - generateHubPage() が新しい URL 規約
 *     ({SITE_URL}/column/ — 単数形 + trailing slash) を出力することを担保。
 *   - 旧 /columns/ (複数形) バグが再発しないことを HTML 全体で完全排除アサーション。
 *   - page=1 / page=2 の canonical URL を pin。
 *   - 記事カードのリンクが /column/{slug}/ を指すことを pin。
 *
 * 失敗時の合図:
 *   - canonical / 記事リンクで /columns/ (複数) が混入した
 *   - canonical が /column/ を外れた
 *   - 記事カードリンクが旧 .html 形式に逆戻りした
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateHubPage, type HubPageData } from '@/lib/generators/hub-generator';

// ─── テスト用フィクスチャ ─────────────────────────────────────────────────

function makeHubData(overrides: Partial<HubPageData> = {}): HubPageData {
  return {
    articles: [
      {
        id: 'a1',
        title: '記事1: ヒーリングの実践',
        slug: 'article-one',
        excerpt: 'テスト抜粋1',
        date: '2026/04/01',
        theme: 'healing',
        categoryLabel: '癒しと浄化',
        thumbnailUrl: '/column/article-one/images/hero.jpg',
        articleUrl: '/column/article-one/',
      },
      {
        id: 'a2',
        title: '記事2: 人間関係の深い気づき',
        slug: 'article-two',
        excerpt: 'テスト抜粋2',
        date: '2026/04/02',
        theme: 'relationships',
        categoryLabel: '人間関係',
        thumbnailUrl: '/column/article-two/images/hero.jpg',
        articleUrl: '/column/article-two/',
      },
    ],
    currentPage: 1,
    totalPages: 3,
    categories: [
      { slug: 'healing', name: '癒しと浄化', count: 1 },
      { slug: 'relationships', name: '人間関係', count: 1 },
    ],
    recentArticles: [
      {
        id: 'a1',
        title: '記事1: ヒーリングの実践',
        slug: 'article-one',
        excerpt: 'テスト抜粋1',
        date: '2026/04/01',
        theme: 'healing',
        categoryLabel: '癒しと浄化',
        thumbnailUrl: '/column/article-one/images/hero.jpg',
        articleUrl: '/column/article-one/',
      },
    ],
    ...overrides,
  };
}

// ─── テスト本体 ────────────────────────────────────────────────────────────

describe('hub-generator URL pattern pinning (P5-44 後 regression guard)', () => {
  beforeEach(() => {
    // env をデフォルトに固定 (default = harmony-mc.com + /column)
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_HUB_PATH', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── case 1: HTML 全体に /columns/ (複数形) が一切含まれない ────────────────
  it('case 1: 出力 HTML 全体に旧 /columns/ (複数形) が一切含まれない (page=1)', () => {
    const html = generateHubPage(makeHubData({ currentPage: 1 }));
    expect(html).not.toContain('/columns/');
    // 念のためホスト付き旧形式も完全排除
    expect(html).not.toContain('harmony-mc.com/columns');
  });

  // ── case 2: page=2 以降でも /columns/ が混入しない ─────────────────────────
  it('case 2: 出力 HTML 全体に旧 /columns/ (複数形) が一切含まれない (page=2)', () => {
    const html = generateHubPage(makeHubData({ currentPage: 2 }));
    expect(html).not.toContain('/columns/');
    expect(html).not.toContain('harmony-mc.com/columns');
  });

  // ── case 3: page=1 canonical pin ─────────────────────────────────────────
  it('case 3: page=1 では canonical が /column/ (trailing slash 必須)', () => {
    const html = generateHubPage(makeHubData({ currentPage: 1 }));
    expect(html).toContain(
      '<link rel="canonical" href="https://harmony-mc.com/spiritual/column/"',
    );
  });

  // ── case 4: page=2 canonical pin ─────────────────────────────────────────
  it('case 4: page=2 では canonical が /column/page/2/ 形式', () => {
    const html = generateHubPage(makeHubData({ currentPage: 2 }));
    expect(html).toContain(
      '<link rel="canonical" href="https://harmony-mc.com/spiritual/column/page/2/"',
    );
    // 旧 /columns/page/ 形式に戻っていない
    expect(html).not.toContain('/columns/page/');
  });

  // ── case 5: 記事カードのリンクが /column/{slug}/ を指す ───────────
  it('case 5: 記事カードの href が /column/{slug}/ (相対 or 絶対) を指す', () => {
    const html = generateHubPage(makeHubData({ currentPage: 1 }));

    // 記事カード <a class="article-card" href="..."> を抽出
    const cardHrefs = Array.from(
      html.matchAll(/<a href="([^"]+)" class="article-card"/g),
    ).map((m) => m[1]);

    expect(cardHrefs.length).toBeGreaterThanOrEqual(2);
    for (const href of cardHrefs) {
      // 相対 or 絶対のいずれでも /column/{slug}/ パターンに一致 (P5-45)
      expect(href).toMatch(
        /^(https?:\/\/[^/]+)?\/column\/[a-z0-9-]+\/$/,
      );
      // 旧バグの再発防止
      expect(href).not.toContain('/columns/');
      expect(href).not.toMatch(/\.html(?:[?#]|$)/);
    }

    // フィクスチャ slug が確実に含まれていること
    expect(cardHrefs.some((h) => h.includes('/column/article-one/'))).toBe(true);
    expect(cardHrefs.some((h) => h.includes('/column/article-two/'))).toBe(true);
  });

  // ── case 6: ナビゲーションの「コラム一覧」リンクも新形式 ──────────────────
  it('case 6: ナビゲーション「コラム一覧」リンクが /column/ を指す', () => {
    const html = generateHubPage(makeHubData({ currentPage: 1 }));
    // sticky-nav 内の「コラム一覧」リンク
    expect(html).toContain('href="https://harmony-mc.com/spiritual/column/"');
    // 旧 /columns/ 複数形に戻っていない
    expect(html).not.toContain('href="https://harmony-mc.com/columns/"');
  });

  // ── case 7: og:url も新形式 ──────────────────────────────────────────────
  it('case 7: og:url が canonical と同一の新形式を指す (page=1)', () => {
    const html = generateHubPage(makeHubData({ currentPage: 1 }));
    expect(html).toContain(
      '<meta property="og:url" content="https://harmony-mc.com/spiritual/column/"',
    );
    // 旧形式が混入していない
    const ogMatch = html.match(/<meta property="og:url" content="([^"]+)"/);
    expect(ogMatch).not.toBeNull();
    expect(ogMatch?.[1] ?? '').not.toContain('/columns/');
  });
});
