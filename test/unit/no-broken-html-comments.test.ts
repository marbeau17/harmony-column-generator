// ============================================================================
// test/unit/no-broken-html-comments.test.ts
//
// CI lint テスト: zero-gen が生成する HTML に「不正コメント」パターン
// (`<!--<img` など) が一切出ないことを保証する regression テスト。
//
// 過去のインシデント (P5-57):
//   旧 Phase 1 の裸プレースホルダ regex `IMAGE:body(?::[^\s<]*)?` が `>` を
//   除外していなかったため、`<!--IMAGE:body:body.webp-->` の filename 部分
//   から後続の `-->` まで貪欲に消費し、closing `-->` が `<img>` の中身として
//   食われてしまう結果、`<!--<img src="..." />` という閉じない不正コメントが
//   生成 HTML 中に残るバグが発生した。これにより本番 HTML 上で <img> が
//   コメントアウトされてしまい、画像が一切表示されない事象が発生した。
//
// 本テストの責務:
//   1. 全 zero-gen 候補入力 (8 ケース) で `generateArticleHtml()` を実行し、
//      出力 HTML 全体に `<!--<img` パターンが 0 件であることをアサート。
//   2. `replaceImagePlaceholders()` の出力単体に対しても同様に 0 件アサート。
//   3. 念のため、生成された HTML 内のすべての HTML コメント (`<!-- ... -->`)
//      が正しく閉じられていることを構造ベースで検証する。
//
// 失敗時の合図:
//   - 画像プレースホルダ置換ロジックの regex を変更した結果、コメント開始
//     `<!--` だけが残ったり、閉じタグ `-->` を貪欲に消費するバグが混入した。
//   - generateArticleHtml() の bodyHtml 修復ロジック (バックスラッシュ修復、
//     <br> 除去、AI 生成 CTA 除去等) がコメントを破壊した。
// ============================================================================

import { describe, it, expect } from 'vitest';
import { generateArticleHtml } from '@/lib/generators/article-html-generator';
import {
  replaceImagePlaceholders,
  type ImageFileRow,
} from '@/lib/zero-gen/replace-placeholders';
import type { Article } from '@/types/article';

// ─── 共通 fixture ────────────────────────────────────────────────────────────

function makeImage(position: string): ImageFileRow {
  return {
    position,
    url: `https://example.com/${position}.webp`,
    alt: `${position} のイメージ`,
    filename: `${position}.webp`,
  };
}

const HERO = makeImage('hero');
const BODY = makeImage('body');
const SUMMARY = makeImage('summary');
const ALL_IMAGES: ImageFileRow[] = [HERO, BODY, SUMMARY];

/**
 * 不正コメントパターンの定義。
 * `<!--<img` (コメント開始直後に img 開始タグが続く) が出現したら、
 * 画像が実体化せず非表示になる致命バグなので即 fail とする。
 */
const BROKEN_COMMENT_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: '<!--<img', re: /<!--\s*<img\b/g },
  // 念のため、open comment が close されないまま <img> を含むケースも検出
  { name: '<!-- ... <img ... (unclosed)', re: /<!--(?:(?!-->)[\s\S])*<img\b/g },
];

/** 不正コメントパターンの出現件数を全パターン合算で返す */
function countBrokenCommentMatches(html: string): { name: string; count: number }[] {
  return BROKEN_COMMENT_PATTERNS.map((p) => ({
    name: p.name,
    count: (html.match(p.re) || []).length,
  }));
}

/**
 * HTML 内の `<!--` と `-->` の出現数が一致 (= すべてのコメントが閉じている) ことを検証。
 * <script> や属性値内の文字列偽陽性を避けるため、シンプルな数値突合のみ行う。
 */
function commentBalance(html: string): { open: number; close: number } {
  const open = (html.match(/<!--/g) || []).length;
  const close = (html.match(/-->/g) || []).length;
  return { open, close };
}

// ─── stage2_body_html の候補入力 8 ケース ─────────────────────────────────────
//
// 過去/現行 zero-gen が出力しうる stage2_body_html のバリエーションを網羅する。
// すべて `replaceImagePlaceholders` と `generateArticleHtml` の両方に渡す。

const STAGE2_BODY_CASES: ReadonlyArray<{ label: string; html: string }> = [
  // 1. HTML コメント形式: filename 付き (P5-57 の元バグ再現入力)
  {
    label: 'comment placeholders with filename',
    html:
      '<h2>導入</h2><p>本文1。</p>' +
      '<!--IMAGE:hero:hero.webp-->' +
      '<h2>本論</h2><p>本文2。</p>' +
      '<!--IMAGE:body:body.webp-->' +
      '<h2>結び</h2><p>本文3。</p>' +
      '<!--IMAGE:summary:summary.webp-->',
  },
  // 2. HTML コメント形式: filename なし
  {
    label: 'comment placeholders without filename',
    html:
      '<p>導入。</p><!--IMAGE:hero--><p>本文。</p>' +
      '<!--IMAGE:body--><p>結び。</p><!--IMAGE:summary-->',
  },
  // 3. <p> ラップ形式
  {
    label: '<p>-wrapped placeholders',
    html:
      '<p>第一段落。</p><p>IMAGE:hero</p><p>第二段落。</p>' +
      '<p>IMAGE:body</p><p>第三段落。</p><p>IMAGE:summary</p>',
  },
  // 4. <div> + コメント形式 (filename 付き)
  {
    label: '<div>-wrapped comment placeholders',
    html:
      '<div class="img-wrap"><!--IMAGE:hero:hero.webp--></div>' +
      '<p>本文。</p>' +
      '<div class="img-wrap"><!--IMAGE:body:body.webp--></div>' +
      '<p>結び。</p>' +
      '<div class="img-wrap"><!--IMAGE:summary:summary.webp--></div>',
  },
  // 5. 混在形式 (コメント / <p> / <div> がランダムに登場)
  {
    label: 'mixed placeholder formats',
    html:
      '<!--IMAGE:hero:hero.webp-->' +
      '<p>第一段落の長めの本文がここに入ります。</p>' +
      '<p>IMAGE:body</p>' +
      '<p>第二段落の本文。</p>' +
      '<div><!--IMAGE:summary:summary.webp--></div>',
  },
  // 6. 自然文中に「IMAGE:」を含む (誤マッチ防止検証)
  {
    label: 'natural text containing IMAGE: substring',
    html:
      '<p>これは「IMAGE: hero」というキーワードに関する解説で、後続文章は決して消えてはいけない大切な本文です。</p>' +
      '<!--IMAGE:hero:hero.webp-->' +
      '<p>続く本文。</p>' +
      '<!--IMAGE:body:body.webp-->' +
      '<p>結び。</p>' +
      '<!--IMAGE:summary:summary.webp-->',
  },
  // 7. AI 生成バックスラッシュ・エスケープ + 余計な <br> + 偽 CTA を含む荒れた入力
  {
    label: 'noisy AI output with escapes and stray CTAs',
    html:
      '<p>導入。</p>' +
      '<br/><nav class="article-toc"><details><summary>目次</summary></details></nav>' +
      '<!--IMAGE:hero:hero.webp-->' +
      '<p>本文。</p>' +
      '<div class="harmony-cta"><p class="harmony-cta-catch">予約は<a href="https://harmony-booking.web.app/">こちら</a></p></div>' +
      '<!--IMAGE:body:body.webp-->' +
      '<p>結び <a href="" class=\\&quot;cta-button\\&quot;>link</a>。</p>' +
      '<!--IMAGE:summary:summary.webp-->',
  },
  // 8. 既知の正常入力 (placeholder 完全置換済み相当): 不正コメントが混入しないことの sanity
  {
    label: 'already-resolved body without placeholders',
    html:
      '<h2>セクション1</h2><p>本文1。</p>' +
      '<img src="https://example.com/hero.webp" alt="hero" />' +
      '<h2>セクション2</h2><p>本文2。</p>' +
      '<img src="https://example.com/body.webp" alt="body" />' +
      '<h2>まとめ</h2><p>結び。</p>',
  },
];

// ─── Article fixture ファクトリ ──────────────────────────────────────────────

function makeArticle(stage2BodyHtml: string, idSuffix: string): Article {
  return {
    id: `article-no-broken-comments-${idSuffix}`,
    status: 'published',
    title: `不正コメント検証テスト #${idSuffix}`,
    slug: `no-broken-comments-${idSuffix}`,
    content: '<p>fallback。</p>',
    meta_description:
      '不正コメントパターンが生成 HTML に出現しないことを検証するテスト記事です。',
    keyword: '不正コメント 検証',
    theme: 'self_growth',
    persona: 'spiritual_beginner',
    source_article_id: null,
    perspective_type: null,
    target_word_count: 2000,
    stage1_outline: null,
    stage2_body_html: stage2BodyHtml,
    stage3_final_html: null,
    published_html: null,
    image_prompts: null,
    image_files: [
      { url: HERO.url, alt: HERO.alt, filename: HERO.filename, position: HERO.position },
      { url: BODY.url, alt: BODY.alt, filename: BODY.filename, position: BODY.position },
      { url: SUMMARY.url, alt: SUMMARY.alt, filename: SUMMARY.filename, position: SUMMARY.position },
    ] as unknown as Article['image_files'],
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
  };
}

// ─── テスト本体 ──────────────────────────────────────────────────────────────

describe('CI lint: 生成 HTML に不正コメント (<!--<img 等) が混入しない', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // (A) replaceImagePlaceholders 単体での lint
  // ──────────────────────────────────────────────────────────────────────────
  describe('replaceImagePlaceholders 単体出力', () => {
    for (const c of STAGE2_BODY_CASES) {
      it(`[${c.label}] 出力に <!--<img パターンが 0 件`, () => {
        const { html } = replaceImagePlaceholders(c.html, ALL_IMAGES);
        const matches = countBrokenCommentMatches(html);
        for (const m of matches) {
          expect(
            m.count,
            `pattern "${m.name}" was found in replaceImagePlaceholders output for case "${c.label}"`,
          ).toBe(0);
        }
        // 念のためコメントの open/close 数が一致 (未閉じコメント無し)
        const balance = commentBalance(html);
        expect(
          balance.open,
          `unclosed HTML comments detected (open=${balance.open}, close=${balance.close}) for case "${c.label}"`,
        ).toBe(balance.close);
      });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // (B) generateArticleHtml 統合出力での lint
  // ──────────────────────────────────────────────────────────────────────────
  describe('generateArticleHtml 統合出力', () => {
    for (const [idx, c] of STAGE2_BODY_CASES.entries()) {
      it(`[${c.label}] フル HTML に <!--<img パターンが 0 件`, () => {
        const article = makeArticle(c.html, String(idx + 1).padStart(2, '0'));
        // 事前に zero-gen 完了相当の placeholder 置換を適用してから流し込む
        // (本番フロー: run-completion → article-html-generator)
        const replaced = replaceImagePlaceholders(c.html, ALL_IMAGES);
        const articleResolved: Article = {
          ...article,
          stage2_body_html: replaced.html,
        };

        const fullHtml = generateArticleHtml(articleResolved, {
          heroImage: HERO.url,
          heroImageAlt: HERO.alt,
        });

        const matches = countBrokenCommentMatches(fullHtml);
        for (const m of matches) {
          expect(
            m.count,
            `pattern "${m.name}" was found in generateArticleHtml output for case "${c.label}"`,
          ).toBe(0);
        }
      });
    }

    // ──────────────────────────────────────────────────────────────────────
    // (C) 未置換 stage2_body_html を渡した場合 (=本番では起きないが安全網)
    //     generateArticleHtml が <!--<img を作らないことも検証する。
    // ──────────────────────────────────────────────────────────────────────
    it('未置換 placeholder を含む stage2_body_html でも <!--<img を生成しない', () => {
      // P5-57 の元バグ条件: filename 付き comment placeholder
      const dirty =
        '<h2>本論</h2><p>本文。</p>' +
        '<!--IMAGE:hero:hero.webp-->' +
        '<!--IMAGE:body:body.webp-->' +
        '<!--IMAGE:summary:summary.webp-->';
      const article = makeArticle(dirty, 'unresolved');
      const fullHtml = generateArticleHtml(article, {
        heroImage: HERO.url,
        heroImageAlt: HERO.alt,
      });
      const matches = countBrokenCommentMatches(fullHtml);
      for (const m of matches) {
        expect(
          m.count,
          `pattern "${m.name}" was found in generateArticleHtml output for unresolved input`,
        ).toBe(0);
      }
    });
  });
});
