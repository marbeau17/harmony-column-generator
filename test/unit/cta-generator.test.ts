import { describe, it, expect } from 'vitest';
import {
  selectCtaTexts,
  buildCtaHtml,
  insertCtasIntoHtml,
  CTA_TEMPLATES,
} from '@/lib/content/cta-generator';

describe('selectCtaTexts', () => {
  const themes = Object.keys(CTA_TEMPLATES);

  it.each(themes)('テーマ "%s" でcta1/cta2/cta3が返る', (theme) => {
    const result = selectCtaTexts(theme, 'test-article-id');
    expect(result).toHaveProperty('cta1');
    expect(result).toHaveProperty('cta2');
    expect(result).toHaveProperty('cta3');
    expect(result.cta1.catch).toBeTruthy();
    expect(result.cta1.sub).toBeTruthy();
    expect(result.cta2.catch).toBeTruthy();
    expect(result.cta2.sub).toBeTruthy();
    expect(result.cta3.catch).toBeTruthy();
    expect(result.cta3.sub).toBeTruthy();
  });
});

describe('buildCtaHtml', () => {
  it('CTA1はcounselingページのURLが含まれる', () => {
    const html = buildCtaHtml('cta1', 'intro', 'キャッチコピー', 'サブテキスト', 'test-slug');
    expect(html).toContain('harmony-mc.com/counseling/');
    expect(html).toContain('utm_content=cta1_information');
    expect(html).toContain('カウンセリングについて詳しく見る');
  });

  it('CTA2はsystemページのURLが含まれる', () => {
    const html = buildCtaHtml('cta2', 'mid', 'キャッチコピー', 'サブテキスト', 'test-slug');
    expect(html).toContain('harmony-mc.com/system/');
    expect(html).toContain('utm_content=cta2_consideration');
    expect(html).toContain('ご予約の流れを確認する');
  });

  it('CTA3はbookingページのURLが含まれる', () => {
    const html = buildCtaHtml('cta3', 'end', 'キャッチコピー', 'サブテキスト', 'test-slug');
    expect(html).toContain('harmony-booking.web.app');
    expect(html).toContain('utm_content=cta3_conversion');
    expect(html).toContain('カウンセリングを予約する');
  });

  it('UTMパラメータが含まれる', () => {
    const html = buildCtaHtml('cta1', 'intro', 'キャッチコピー', 'サブテキスト', 'test-slug');
    expect(html).toContain('utm_source=column');
    expect(html).toContain('utm_medium=cta');
    expect(html).toContain('utm_campaign=test-slug');
  });

  it('バナー画像URLが指定された場合にバナーHTMLが含まれる', () => {
    const html = buildCtaHtml('cta1', 'intro', 'キャッチ', 'サブ', 'test-slug', {
      bannerUrl: 'https://example.com/banner.webp',
      bannerAlt: 'テストバナー',
    });
    expect(html).toContain('harmony-cta-banner');
    expect(html).toContain('https://example.com/banner.webp');
    expect(html).toContain('テストバナー');
  });

  it('バナー画像URLが空の場合にバナーHTMLが含まれない', () => {
    const html = buildCtaHtml('cta1', 'intro', 'キャッチ', 'サブ', 'test-slug');
    expect(html).not.toContain('harmony-cta-banner');
  });
});

describe('insertCtasIntoHtml', () => {
  it('H2が3つあるHTMLに3つのCTAが挿入される', () => {
    const html = `
      <h2>セクション1</h2>
      <p>本文1</p>
      <h2>セクション2</h2>
      <p>本文2</p>
      <h2>セクション3</h2>
      <p>本文3</p>
    `;
    const ctaTexts = {
      cta1: { catch: 'CTA1キャッチ', sub: 'CTA1サブ' },
      cta2: { catch: 'CTA2キャッチ', sub: 'CTA2サブ' },
      cta3: { catch: 'CTA3キャッチ', sub: 'CTA3サブ' },
    };

    const result = insertCtasIntoHtml(html, ctaTexts, 'test-slug');

    expect(result).toContain('data-cta-position="intro"');
    expect(result).toContain('data-cta-position="mid"');
    expect(result).toContain('data-cta-position="end"');
  });
});
