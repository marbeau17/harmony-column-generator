// ============================================================================
// test/unit/inject-image-placeholders.test.ts
//
// P5-70: handleApplyImages の auto-inject 復旧路を保証する unit テスト。
//
// 対象: src/lib/zero-gen/inject-placeholders.ts の `injectImagePlaceholders`
//
// 検証観点 (CLAUDE.md anti-pattern と整合):
//   1. プレースホルダ無し本文 + image_files=3 → 注入後に再 replaceImagePlaceholders を
//      流すと <img> が 3 枚埋まること (本テストの主目的)。
//   2. <a>/<h2>/<p> の **内側** には絶対に注入しないこと (安全位置のみ)。
//   3. 既に該当 position の placeholder / <img> がある場合は idempotent (重複無し)。
//   4. h2 ゼロの本文では `body` 末尾 / `body` 末尾に挿入され、empty body でも
//      クラッシュせず injected.length===0 にはならない。
//   5. image_files 空配列 → no-op (本文は完全に保持)。
// ============================================================================

import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { injectImagePlaceholders } from '@/lib/zero-gen/inject-placeholders';
import {
  replaceImagePlaceholders,
  type ImageFileRow,
} from '@/lib/zero-gen/replace-placeholders';

function makeImage(position: string): ImageFileRow {
  return {
    position,
    url: `https://cdn.example.com/${position}.webp`,
    alt: `${position} の自動生成画像`,
    filename: `${position}.webp`,
  };
}

describe('injectImagePlaceholders (P5-70 auto-inject)', () => {
  it('1. placeholder 無し + image_files=3 → 注入後 replace で <img> が 3 枚埋まる', () => {
    const body = `
      <h2>導入</h2>
      <p>この記事では魂のテーマを扱います。</p>
      <h2>本論</h2>
      <p>多くの方が抱える悩みについて考えます。</p>
      <h2>結論</h2>
      <p>明日からできる行動をまとめました。</p>
    `;
    const imgs = [makeImage('hero'), makeImage('body'), makeImage('summary')];

    const inject = injectImagePlaceholders(body, imgs);
    expect(inject.injected.length).toBe(3);
    expect(inject.injected).toEqual(
      expect.arrayContaining(['hero', 'body', 'summary']),
    );

    const replaced = replaceImagePlaceholders(inject.html, imgs);
    expect(replaced.phase1 + replaced.phase2).toBe(3);

    const $ = cheerio.load(replaced.html, null, false);
    expect($('img').length).toBe(3);
    const srcs = $('img')
      .toArray()
      .map((el) => $(el).attr('src') ?? '');
    expect(srcs).toEqual(
      expect.arrayContaining([
        'https://cdn.example.com/hero.webp',
        'https://cdn.example.com/body.webp',
        'https://cdn.example.com/summary.webp',
      ]),
    );
  });

  it('2. <a>/<h2> の内側には placeholder を注入しない', () => {
    const body = `
      <h2><a href="#x">リンク見出し</a></h2>
      <p>本文。</p>
      <h2>結論</h2>
      <p>まとめ。</p>
    `;
    const imgs = [makeImage('hero'), makeImage('body'), makeImage('summary')];
    const inject = injectImagePlaceholders(body, imgs);

    const $ = cheerio.load(inject.html, null, false);
    // <a> の中にコメントが入っていない
    $('a').each((_, el) => {
      expect($(el).html() ?? '').not.toMatch(/<!--\s*IMAGE:/);
    });
    // <h2> の中にコメントが入っていない
    $('h2').each((_, el) => {
      expect($(el).html() ?? '').not.toMatch(/<!--\s*IMAGE:/);
    });
  });

  it('3. 既に該当 position の placeholder がある場合は注入しない (idempotent)', () => {
    const body = `
      <!--IMAGE:hero:hero.webp-->
      <h2>導入</h2>
      <p>本文。</p>
      <h2>本論</h2>
      <p>続き。</p>
      <h2>結論</h2>
      <p>まとめ。</p>
    `;
    const imgs = [makeImage('hero'), makeImage('body'), makeImage('summary')];
    const inject = injectImagePlaceholders(body, imgs);

    expect(inject.skipped).toContain('hero');
    expect(inject.injected).not.toContain('hero');
    // 注入された他 position はそのまま (body / summary)
    expect(inject.injected).toEqual(
      expect.arrayContaining(['body', 'summary']),
    );

    // hero placeholder が 1 つだけであることを確認
    const heroMatches = inject.html.match(/<!--\s*IMAGE:hero/gi);
    expect(heroMatches?.length).toBe(1);
  });

  it('4. h2 ゼロ + 本文ありでも summary/body は body 末尾に注入される', () => {
    const body = `<p>これは導入文です。</p><p>これは結論です。</p>`;
    const imgs = [makeImage('hero'), makeImage('body'), makeImage('summary')];
    const inject = injectImagePlaceholders(body, imgs);
    expect(inject.injected.length).toBe(3);

    const replaced = replaceImagePlaceholders(inject.html, imgs);
    expect(replaced.phase1 + replaced.phase2).toBe(3);
  });

  it('5. image_files 空配列 → 本文は完全保持', () => {
    const body = `<h2>テスト</h2><p>本文。</p>`;
    const inject = injectImagePlaceholders(body, []);
    expect(inject.html).toBe(body);
    expect(inject.injected).toEqual([]);
  });

  it('6. 既に <img alt="hero..."> が埋まっている場合は hero をスキップ', () => {
    const body = `
      <img src="https://cdn.example.com/hero.webp" alt="hero の画像" />
      <h2>導入</h2>
      <p>本文。</p>
      <h2>本論</h2>
      <p>続き。</p>
      <h2>結論</h2>
      <p>まとめ。</p>
    `;
    const imgs = [makeImage('hero'), makeImage('body'), makeImage('summary')];
    const inject = injectImagePlaceholders(body, imgs);
    expect(inject.skipped).toContain('hero');
    expect(inject.injected).toEqual(
      expect.arrayContaining(['body', 'summary']),
    );
  });
});
