/**
 * buildDeployHtml() post-process pin テスト
 *
 * 背景:
 *   src/lib/deploy/article-html-builder.ts の buildDeployHtml() は
 *   generateArticleHtml() の出力に対して以下の post-process を行う:
 *     1. Supabase Storage URL → ./images/{position}.jpg 相対化
 *     2. ./css/hub.css / ./js/hub.js → ../../css/hub.css / ../../js/hub.js
 *     3. 関連記事 href / thumb src を ../{slug}/index.html・../{slug}/images/ へ書換
 *     4. 不正な hero <img style="max-width:100%..."> の除去 (本文重複防止)
 *     5. <!--IMAGE:hero:--> placeholder の除去
 *
 *   これらは deploy/route.ts と redeploy-all-articles.ts で重複していた regex を
 *   共通ヘルパー化したもの (P5-43 周辺リファクタ)。本テストは以下の再発を防ぐ:
 *     - P5-86: 関連記事サムネ src に `index.html/images/` が混入する 404 バグ
 *     - 旧 hero <img>＋placeholder の HTML への mojibake/重複混入
 *     - hub.css/hub.js の相対パス書換漏れ
 *
 * 失敗時の合図:
 *   - Supabase Storage の絶対 URL が出力に残っている
 *   - hub.css/hub.js が ./ のまま (../../ 化されていない)
 *   - 関連記事 thumb が `index.html/images/` を含む
 *   - hero <img> または `<!--IMAGE:hero:` が出力に残っている
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDeployHtml } from '@/lib/deploy/article-html-builder';
import type { Article } from '@/types/article';

// ─── テスト用フィクスチャ ─────────────────────────────────────────────────

/**
 * 最小限の Article オブジェクトを生成する。
 * stage2_body_html を中心に、各テストで必要な部分だけ overrides で差し替える。
 */
function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'article-uuid-builder-0001',
    status: 'published',
    title: 'デプロイビルダーテスト記事',
    slug: 'healing-30',
    content: null,
    meta_description: 'テスト用メタ説明',
    keyword: 'テスト',
    theme: 'healing',
    persona: 'spiritual_beginner',
    source_article_id: null,
    perspective_type: null,
    target_word_count: 2000,
    stage1_outline: null,
    stage2_body_html:
      '<h2>セクション1</h2><p>段落1の本文ダミー。十分な長さの本文を確保するためのダミーテキスト。</p>' +
      '<h2>セクション2</h2><p>段落2の本文ダミー。十分な長さの本文を確保するためのダミーテキスト。</p>',
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
    generation_mode: 'zero',
    created_at: '2026-03-25T00:00:00.000Z',
    updated_at: '2026-03-25T00:00:00.000Z',
    ...overrides,
  };
}

// ─── テスト本体 ────────────────────────────────────────────────────────────

describe('buildDeployHtml() post-process', () => {
  beforeEach(() => {
    // env をデフォルト (harmony-mc.com + /spiritual/column) に固定
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_HUB_PATH', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('TC1: Supabase Storage URL は ./images/{position}.jpg に書換えられる', () => {
    // stage2_body_html に Supabase Storage の絶対 URL を含める
    const stage2 =
      '<h2>導入</h2>' +
      '<p>本文中の body 画像です。</p>' +
      '<img src="https://khsorerqojgwbmtiqrac.supabase.co/storage/v1/object/public/article-images/articles/healing-30/body.jpg" alt="body">' +
      '<p>続く本文。十分な長さを確保するためのダミーテキスト。</p>' +
      '<h2>まとめ</h2>' +
      '<p>summary 画像です。</p>' +
      '<img src="https://khsorerqojgwbmtiqrac.supabase.co/storage/v1/object/public/article-images/articles/healing-30/summary.jpg" alt="summary">' +
      '<p>本文末尾。</p>';

    const { html } = buildDeployHtml(makeArticle({ stage2_body_html: stage2 }));

    // 相対パス化されている
    expect(html).toContain('src="./images/body.jpg"');
    expect(html).toContain('src="./images/summary.jpg"');
    // Supabase Storage の絶対 URL は post-process 後に残らない
    expect(html).not.toContain(
      'https://khsorerqojgwbmtiqrac.supabase.co/storage/v1/object/public/article-images/articles/healing-30/body.jpg',
    );
    expect(html).not.toContain(
      'https://khsorerqojgwbmtiqrac.supabase.co/storage/v1/object/public/article-images/articles/healing-30/summary.jpg',
    );
  });

  it('TC2: hub.css / hub.js のパスは ../../ に書換えられる', () => {
    const { html } = buildDeployHtml(makeArticle());

    // FTP デプロイ後の物理配置 (/{HUB}/{slug}/index.html) からの相対パス
    expect(html).toContain('href="../../css/hub.css"');
    expect(html).toContain('src="../../js/hub.js"');
    // 元の ./css/hub.css / ./js/hub.js は post-process で消える
    expect(html).not.toContain('href="./css/hub.css"');
    expect(html).not.toContain('src="./js/hub.js"');
  });

  it('TC3 (P5-86): 関連記事 thumb src は ../{slug}/images/hero.jpg 形式 (index.html 混入なし)', () => {
    // canonical href 形式 (P5-46): /spiritual/column/{slug}/index.html
    const article = makeArticle({
      related_articles: [
        { href: '/spiritual/column/related-slug-1/index.html', title: '関連記事1' },
        { href: '/spiritual/column/related-slug-2/index.html', title: '関連記事2' },
      ],
    });

    const { html } = buildDeployHtml(article);

    // thumb src は ../{slug}/images/hero.jpg (P5-86 の壊れた URL でないこと)
    // post-process の `src="${hubPath}/([^"]+)/images/` 書換が効いている。
    expect(html).toContain('src="../related-slug-1/images/hero.jpg"');
    expect(html).toContain('src="../related-slug-2/images/hero.jpg"');

    // P5-86 リグレッションガード: index.html/images/ という壊れた形が出ていない
    expect(html).not.toContain('index.html/images/');

    // 絶対パスの thumb src は post-process で消えている
    expect(html).not.toContain('src="/spiritual/column/related-slug-1/images/hero.jpg"');
    expect(html).not.toContain('src="/spiritual/column/related-slug-2/images/hero.jpg"');

    // 注: href 側 (`<a href=...>`) は post-process regex が trailing slash 形式
    //     (`href="${hubPath}/{X}/"`) のみマッチするため、canonical P5-46 形式
    //     (`href="${hubPath}/{X}/index.html"`) では現状書換されず絶対パスのまま
    //     残る (ブラウザ側で動作はする)。本テストは現状の挙動 (絶対パス維持) を pin する。
    expect(html).toContain('href="/spiritual/column/related-slug-1/index.html"');
    expect(html).toContain('href="/spiritual/column/related-slug-2/index.html"');
  });

  it('TC4: <!--IMAGE:hero:...--> placeholder は除去される', () => {
    const stage2 =
      '<!--IMAGE:hero:癒しの光に包まれる風景-->' +
      '<h2>導入</h2>' +
      '<p>本文ダミー。十分な長さを確保するためのダミーテキスト。さらに本文を継続します。</p>' +
      '<h2>本論</h2>' +
      '<p>続きの本文ダミー。十分な長さを確保するためのダミーテキスト。</p>';

    const { html } = buildDeployHtml(makeArticle({ stage2_body_html: stage2 }));

    // hero placeholder は除去される
    expect(html).not.toContain('<!--IMAGE:hero:');
    expect(html).not.toContain('癒しの光に包まれる風景');
  });

  it('TC5: 本文中の hero <img style="max-width:100%..."> は除去される (テンプレートとの重複防止)', () => {
    // stage2_body_html 内に hero <img> が紛れ込むケース (AI 出力ハルシネーション)
    const stage2 =
      '<h2>導入</h2>' +
      '<p>本文ダミー。十分な長さの本文を確保するためのダミーテキスト。</p>' +
      '<img src="./images/hero.jpg" alt="hero" style="max-width:100%;height:auto;">' +
      '<h2>本論</h2>' +
      '<p>続きの本文ダミー。十分な長さの本文を確保するためのダミーテキスト。</p>';

    const { html } = buildDeployHtml(makeArticle({ stage2_body_html: stage2 }));

    // 本文中の hero <img style="max-width:100%..."> は除去される
    expect(html).not.toContain('<img src="./images/hero.jpg" alt="hero" style="max-width:100%');
    // SVG 版も同じ regex で除去対象 (post-process の挙動を pin)
    // ただし正規 hero <img> (テンプレート由来) は別属性順で残ってよい
  });
});
