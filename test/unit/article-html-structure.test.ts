/**
 * 記事 HTML 構造の regression テスト
 *
 * 目的:
 *   - generateArticleHtml() が生成する完全な HTML について、
 *     プロフィール / 関連記事 / footer / Copyright / disclaimer といった
 *     主要セクションが「ちょうど 1 回だけ」出現することを担保する。
 *   - さらに DOM 構造上の出現順序 (本文 → 関連記事 → プロフィール → 免責事項 → footer) が
 *     崩れないことを位置インデックスベースで pin する。
 *
 * 失敗時の合図:
 *   - テンプレート改修時に同セクションが二重描画されるバグが混入した
 *   - プロフィールが <main> の外 (footer の後ろ) に追い出された
 *   - 関連記事ブロックが本文より前に移動した、もしくは複数描画された
 *   - DOCTYPE 宣言や </html> の閉じタグが欠落した
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateArticleHtml } from '@/lib/generators/article-html-generator';
import type { Article } from '@/types/article';

// ─── テスト用フィクスチャ ─────────────────────────────────────────────────

/**
 * law-of-attraction 相当のフィクスチャ記事。
 * 「引き寄せの法則」テーマでカウンセリング予約導線を含む構造を再現する。
 */
function makeLawOfAttractionArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'article-uuid-structure-0001',
    status: 'published',
    title: '引き寄せの法則に疲れたときに読む — 力を抜く小さな練習',
    slug: 'law-of-attraction-tired',
    content: '<p>本文ダミー。</p>',
    meta_description:
      '引き寄せの法則を実践していて疲れてしまったあなたへ。力を抜いて自分の心と再びつながるための、小さな日常の練習をお伝えします。',
    keyword: '引き寄せの法則 疲れた',
    theme: 'self_growth',
    persona: 'spiritual_beginner',
    source_article_id: null,
    perspective_type: null,
    target_word_count: 2000,
    stage1_outline: null,
    stage2_body_html:
      '<h2>引き寄せに疲れる理由</h2><p>頑張りすぎてしまうと、本来の願いから遠ざかることがあります。</p><h2>力を抜く小さな練習</h2><p>朝の深呼吸や、空を見上げる時間が、心を整えてくれます。</p><h2>あなたのペースで歩く</h2><p>誰かのスピードに合わせなくて大丈夫です。あなただけのリズムを大切にしてください。</p>',
    stage3_final_html: null,
    published_html: null,
    image_prompts: null,
    image_files: null,
    cta_texts: null,
    faq_data: null,
    structured_data: null,
    seo_score: null,
    related_articles: [
      { slug: 'gratitude-practice', title: '感謝のワーク入門', href: '/column/gratitude-practice/' },
      { slug: 'morning-meditation', title: '朝の瞑想10分', href: '/column/morning-meditation/' },
      { slug: 'inner-child-care', title: 'インナーチャイルドのケア', href: '/column/inner-child-care/' },
    ] as unknown as Article['related_articles'],
    published_url: null,
    published_at: '2026-04-01T00:00:00.000Z',
    reviewed_at: null,
    reviewed_by: null,
    created_at: '2026-03-25T00:00:00.000Z',
    updated_at: '2026-03-25T00:00:00.000Z',
    ...overrides,
  };
}

/** ある substring が HTML 内に何回出現するかを数える小さなヘルパー */
function countOccurrences(html: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = html.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = html.indexOf(needle, idx + needle.length);
  }
  return count;
}

// ─── テスト本体 ────────────────────────────────────────────────────────────

describe('generateArticleHtml() HTML 構造 regression (重複/順序/骨格 pin)', () => {
  let html: string;

  beforeEach(() => {
    // env をデフォルトに固定 (default = harmony-mc.com + /column)
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_HUB_PATH', '');
    vi.stubEnv('NEXT_PUBLIC_GA_ID', 'G-TEST-STRUCTURE');

    html = generateArticleHtml(makeLawOfAttractionArticle());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('case 1: 著者プロフィール (小林由起子) は author ブロック内に 1 回だけ出現する', () => {
    // ─ 検証ポリシー ─
    // 「小林由起子」自体はヘッダーロゴ・OGP・ブレッドクラムなど複数箇所に出現するため、
    // ここでは「著者プロフィール枠」を一意に表す `<p class="article-author-name">小林由起子</p>`
    // のフルマッチで 1 回だけであることを担保する。
    const profileMarker = '<p class="article-author-name">小林由起子</p>';
    expect(countOccurrences(html, profileMarker)).toBe(1);
  });

  it('case 2: 関連記事セクションの見出し (関連記事) は 1 回だけ出現する', () => {
    // <section class="article-related"> 内の <h2>関連記事</h2> をピン留め。
    // (HTML コメント `<!-- 関連記事3件 -->` も生 HTML 内に存在するため、
    //  描画上の「関連記事」見出しを表す h2 マッチで一意性を担保する。)
    expect(countOccurrences(html, '<h2>関連記事</h2>')).toBe(1);
    // section 自体の class も 1 回。
    expect(countOccurrences(html, 'class="article-related"')).toBe(1);
  });

  it('case 3: <footer ... タグは 1 回だけ出現する', () => {
    // <footer タグのオープンが複数あれば二重 footer 描画バグ。
    expect(countOccurrences(html, '<footer')).toBe(1);
    // 対応する閉じタグも 1 回。
    expect(countOccurrences(html, '</footer>')).toBe(1);
  });

  it('case 4: Copyright 表記は 1 回だけ出現する', () => {
    // siteFooter-copyright クラスを持つ p 要素として 1 回だけ存在する。
    expect(countOccurrences(html, 'class="siteFooter-copyright"')).toBe(1);
    expect(countOccurrences(html, 'Copyright')).toBe(1);
  });

  it('case 5: 免責事項 (本コラムの内容) は 1 回だけ出現する', () => {
    // disclaimer の冒頭フレーズで一意性を担保する。
    expect(countOccurrences(html, '本コラムの内容')).toBe(1);
    // disclaimer 枠そのものも 1 回。
    expect(countOccurrences(html, 'class="article-disclaimer"')).toBe(1);
  });

  it('case 6: プロフィール枠は footer よりも前 (= main の中) に置かれる', () => {
    const profileIdx = html.indexOf('class="article-author"');
    const footerIdx = html.indexOf('<footer');
    expect(profileIdx).toBeGreaterThan(0);
    expect(footerIdx).toBeGreaterThan(0);
    expect(profileIdx).toBeLessThan(footerIdx);

    // さらに </main> よりも前にあることも担保 (main の外に出ていない)。
    const mainCloseIdx = html.indexOf('</main>');
    expect(mainCloseIdx).toBeGreaterThan(0);
    expect(profileIdx).toBeLessThan(mainCloseIdx);
  });

  it('case 7: ブロック順序は「本文 → 関連記事 → 著者プロフィール → 免責事項」 (P5-52)', () => {
    // P5-52: 本番ページ (https://harmony-mc.com/spiritual/column/law-of-attraction/)
    // でプロフィールが「関連記事の前」と「footer の後」に 2 回表示されていた事象を
    // 機に、「関連記事 → プロフィール → 免責事項 → footer」の標準順序へ統一した。
    // 旧テスト (本文 → プロフィール → 関連記事 → 免責事項) は誤った配置を pin して
    // しまっていたため、本ケースで新順序を真実として再 pin する。
    const profileIdx = html.indexOf('class="article-author"');
    const relatedIdx = html.indexOf('class="article-related"');
    const disclaimerIdx = html.indexOf('class="article-disclaimer"');
    const articleBodyIdx = html.indexOf('class="article-body"');

    expect(articleBodyIdx).toBeGreaterThan(0);
    expect(relatedIdx).toBeGreaterThan(articleBodyIdx);
    expect(profileIdx).toBeGreaterThan(relatedIdx);
    expect(disclaimerIdx).toBeGreaterThan(profileIdx);
  });

  it('case 8: HTML は <!DOCTYPE html> で始まり </html> で終わる', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    // 末尾は改行/空白を許容して </html> で終わる。
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    // DOCTYPE / </html> 自体は HTML 内で 1 回だけ。
    expect(countOccurrences(html, '<!DOCTYPE html>')).toBe(1);
    expect(countOccurrences(html, '</html>')).toBe(1);
  });
});
