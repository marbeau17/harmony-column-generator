// P5-111: 決定論的 format auto-fixer の動作検証

import { describe, it, expect } from 'vitest';
import {
  runDeterministicFix,
  isDeterministicFixable,
  listDeterministicFixableIds,
} from '@/lib/auto-fix/deterministic-fixers';

const ARTICLE_BASE = {
  id: 'test-id',
  title: 'テスト記事',
  slug: 'test-article',
};

describe('isDeterministicFixable / list', () => {
  it('image_placeholders / double_quotes / cta_urls / error_patterns を含む', () => {
    expect(isDeterministicFixable('image_placeholders')).toBe(true);
    expect(isDeterministicFixable('double_quotes')).toBe(true);
    expect(isDeterministicFixable('cta_urls')).toBe(true);
    expect(isDeterministicFixable('error_patterns')).toBe(true);
  });
  it('未対応 ID は false', () => {
    expect(isDeterministicFixable('content_length')).toBe(false);
    expect(isDeterministicFixable('hallucination_warning')).toBe(false);
  });
  it('listDeterministicFixableIds が 4 件', () => {
    expect(listDeterministicFixableIds().sort()).toEqual(
      ['cta_urls', 'double_quotes', 'error_patterns', 'image_placeholders'].sort(),
    );
  });
});

describe('double_quotes fixer', () => {
  it('"…" を 「…」 に変換', () => {
    const r = runDeterministicFix('double_quotes', {
      bodyHtml: '<p>彼女は"こんにちは"と言った。</p>',
      article: { ...ARTICLE_BASE, image_files: null },
    });
    expect(r.applied).toBe(true);
    expect(r.after_html).toBe('<p>彼女は「こんにちは」と言った。</p>');
  });

  it('U+201C/201D も置換', () => {
    const r = runDeterministicFix('double_quotes', {
      bodyHtml: '<p>“hello” world</p>',
      article: { ...ARTICLE_BASE, image_files: null },
    });
    expect(r.applied).toBe(true);
    expect(r.after_html).toBe('<p>「hello」 world</p>');
  });

  it('HTML 属性内の " は影響を受けない', () => {
    const r = runDeterministicFix('double_quotes', {
      bodyHtml: '<a href="https://example.com" class="link">link</a>',
      article: { ...ARTICLE_BASE, image_files: null },
    });
    expect(r.applied).toBe(false);
    expect(r.after_html).toBe('<a href="https://example.com" class="link">link</a>');
  });

  it('検出 0 の場合 applied=false', () => {
    const r = runDeterministicFix('double_quotes', {
      bodyHtml: '<p>クォート無し</p>',
      article: { ...ARTICLE_BASE, image_files: null },
    });
    expect(r.applied).toBe(false);
  });
});

describe('cta_urls fixer', () => {
  it('外部の不正 CTA href を canonical に置換', () => {
    const r = runDeterministicFix('cta_urls', {
      bodyHtml: '<a class="harmony-cta-btn" href="https://evil.example/">予約</a>',
      article: { ...ARTICLE_BASE, image_files: null },
    });
    expect(r.applied).toBe(true);
    expect(r.after_html).toContain('href="https://harmony-booking.web.app/"');
    expect(r.after_html).not.toContain('evil.example');
  });

  it('既に harmony-booking なら無変更', () => {
    const html = '<a class="harmony-cta-btn" href="https://harmony-booking.web.app/">予約</a>';
    const r = runDeterministicFix('cta_urls', {
      bodyHtml: html,
      article: { ...ARTICLE_BASE, image_files: null },
    });
    expect(r.applied).toBe(false);
    expect(r.after_html).toBe(html);
  });

  it('harmony-mc.com も valid 扱い', () => {
    const html = '<a class="harmony-cta-btn" href="https://harmony-mc.com/counseling/">案内</a>';
    const r = runDeterministicFix('cta_urls', {
      bodyHtml: html,
      article: { ...ARTICLE_BASE, image_files: null },
    });
    expect(r.applied).toBe(false);
  });
});

describe('error_patterns fixer', () => {
  it('CORRECTIONS_START / IMAGE:hero 等を除去', () => {
    const r = runDeterministicFix('error_patterns', {
      bodyHtml: '<p>本文 CORRECTIONS_START 続き IMAGE:hero です</p>',
      article: { ...ARTICLE_BASE, image_files: null },
    });
    expect(r.applied).toBe(true);
    expect(r.after_html).not.toMatch(/CORRECTIONS_START/);
    expect(r.after_html).not.toMatch(/IMAGE:hero/);
  });

  it('クリーンな本文には触らない', () => {
    const r = runDeterministicFix('error_patterns', {
      bodyHtml: '<p>クリーンな本文</p>',
      article: { ...ARTICLE_BASE, image_files: null },
    });
    expect(r.applied).toBe(false);
  });

  it('IMAGE:hero が単独単語の時のみ除去 (英文中の同名は残す)', () => {
    const r = runDeterministicFix('error_patterns', {
      bodyHtml: '<p>IMAGE:hero-section という名前は残る</p>',
      article: { ...ARTICLE_BASE, image_files: null },
    });
    // hero-section の hero と続くため境界マッチ → applied=false
    expect(r.after_html).toContain('IMAGE:hero-section');
  });
});

describe('image_placeholders fixer', () => {
  it('image_files が空なら applied=false', () => {
    const r = runDeterministicFix('image_placeholders', {
      bodyHtml: '<!--IMAGE:hero:hero.webp-->',
      article: { ...ARTICLE_BASE, image_files: null },
    });
    expect(r.applied).toBe(false);
    expect(r.detail).toMatch(/image_files が空/);
  });

  it('image_files があれば canonical helper 経由で置換', () => {
    const r = runDeterministicFix('image_placeholders', {
      bodyHtml: '<p>before</p><!--IMAGE:hero:hero.webp--><p>after</p>',
      article: {
        ...ARTICLE_BASE,
        image_files: [
          { position: 'hero', url: 'https://cdn.example.com/hero.jpg', alt: 'ヒーロー' },
        ],
      },
    });
    expect(r.applied).toBe(true);
    expect(r.after_html).toContain('<img src="https://cdn.example.com/hero.jpg"');
    expect(r.after_html).not.toMatch(/<!--IMAGE:hero/);
  });
});

describe('未対応 ID で throw', () => {
  it('content_length は throw', () => {
    expect(() =>
      runDeterministicFix('content_length', {
        bodyHtml: '<p>x</p>',
        article: { ...ARTICLE_BASE, image_files: null },
      }),
    ).toThrow(/決定論的修復器が存在しません/);
  });
});
