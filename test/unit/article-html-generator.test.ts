/**
 * P5-86: buildRelatedArticlesHtml() の slug 抽出 fix 単体テスト
 *
 * 背景:
 *   a.href は getArticleRelativePath() で
 *   `${hubPath}/${slug}/index.html` 形式 (P5-46 canonical) で生成される。
 *   旧 slug 抽出は trailing `/` のみ剥がしていたため、`index.html` が
 *   slug に混入し、thumbSrc が
 *   `${hubPath}/${slug}/index.html/images/hero.jpg` という壊れた URL
 *   になっていた (関連記事サムネイル全件 404)。
 *
 * 期待動作:
 *   - 末尾 `/index.html` (canonical) も trailing `/` (legacy) も安全に剥がす
 *   - 旧 `/column/` prefix の fallback も維持
 *   - 出力 HTML に `index.html/images/` が含まれてはならない
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRelatedArticlesHtml } from '@/lib/generators/article-html-generator';

describe('buildRelatedArticlesHtml() slug extraction (P5-86)', () => {
  beforeEach(() => {
    // env をデフォルト (harmony-mc.com + /spiritual/column) に固定
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_HUB_PATH', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('(a) canonical href `/spiritual/column/{slug}/index.html` (P5-46) — `/index.html` を剥がす', () => {
    const html = buildRelatedArticlesHtml([
      { href: '/spiritual/column/healing/index.html', title: '癒しのコラム' },
    ]);

    expect(html).toContain('src="/spiritual/column/healing/images/hero.jpg"');
    // 旧バグ: index.html/images/ が混入してはならない
    expect(html).not.toContain('index.html/images/');
  });

  it('(b) legacy trailing slash href `/spiritual/column/{slug}/` — trailing `/` を剥がす', () => {
    const html = buildRelatedArticlesHtml([
      { href: '/spiritual/column/healing/', title: '癒しのコラム' },
    ]);

    expect(html).toContain('src="/spiritual/column/healing/images/hero.jpg"');
    expect(html).not.toContain('index.html/images/');
  });

  it('(c) legacy fallback prefix href `/column/{slug}/index.html` — `/column/` fallback で正規化', () => {
    const html = buildRelatedArticlesHtml([
      { href: '/column/healing/index.html', title: '癒しのコラム' },
    ]);

    expect(html).toContain('src="/spiritual/column/healing/images/hero.jpg"');
    expect(html).not.toContain('index.html/images/');
  });

  it('(d) 空配列 → 空文字 (空状態プレースホルダ) を返す', () => {
    // null 入力時のみプレースホルダ HTML、空配列は早期 return される実装
    const htmlEmpty = buildRelatedArticlesHtml([]);
    const htmlNull = buildRelatedArticlesHtml(null);

    // 空配列: 早期 return で空状態プレースホルダ
    expect(htmlEmpty).toBe('<p class="article-related-empty">他のコラムも準備中です。お楽しみに。</p>');
    // null も同じく空状態プレースホルダ
    expect(htmlNull).toBe('<p class="article-related-empty">他のコラムも準備中です。お楽しみに。</p>');
    // どちらも壊れた URL を含まない
    expect(htmlEmpty).not.toContain('index.html/images/');
    expect(htmlNull).not.toContain('index.html/images/');
  });
});
