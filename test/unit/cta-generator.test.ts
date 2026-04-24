import { describe, it, expect } from 'vitest';
import {
  selectCtaTexts,
  buildCtaHtml,
  insertCtasIntoHtml,
  CTA_TEMPLATES,
} from '@/lib/content/cta-generator';

describe('selectCtaTexts', () => {
  const themes = Object.keys(CTA_TEMPLATES);

  it.each(themes)('テーマ "%s" でcta2/cta3が返る', (theme) => {
    const result = selectCtaTexts(theme, 'test-article-id');
    expect(result).toHaveProperty('cta2');
    expect(result).toHaveProperty('cta3');
    expect(result.cta2.catch).toBeTruthy();
    expect(result.cta2.sub).toBeTruthy();
    expect(result.cta3.catch).toBeTruthy();
    expect(result.cta3.sub).toBeTruthy();
  });
});

describe('buildCtaHtml', () => {
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
    const html = buildCtaHtml('cta2', 'mid', 'キャッチコピー', 'サブテキスト', 'test-slug');
    expect(html).toContain('utm_source=column');
    expect(html).toContain('utm_medium=cta');
    expect(html).toContain('utm_campaign=test-slug');
  });

  it('バナー画像関連の要素が含まれない（CSS-onlyデザイン）', () => {
    const html = buildCtaHtml('cta2', 'mid', 'キャッチ', 'サブ', 'test-slug');
    expect(html).not.toContain('background-image');
    expect(html).not.toContain('harmony-cta-seo-img');
    expect(html).not.toContain('harmony-cta-overlay');
  });

  it('CTAバッジが含まれる', () => {
    const html = buildCtaHtml('cta2', 'mid', 'キャッチ', 'サブ', 'test-slug');
    expect(html).toContain('harmony-cta-badge');
    expect(html).toContain('ご予約の流れ');
  });

  it('data-cta-key属性とCSSクラスが含まれる', () => {
    const html = buildCtaHtml('cta2', 'mid', 'キャッチ', 'サブ', 'test-slug');
    expect(html).toContain('data-cta-key="cta2"');
    expect(html).toContain('harmony-cta-2');
  });
});

describe('insertCtasIntoHtml', () => {
  it('H2が3つあるHTMLに2つのCTAが挿入される', () => {
    const html = `
      <h2>セクション1</h2>
      <p>本文1</p>
      <h2>セクション2</h2>
      <p>本文2</p>
      <h2>セクション3</h2>
      <p>本文3</p>
    `;
    const ctaTexts = {
      cta2: { catch: 'CTA2キャッチ', sub: 'CTA2サブ' },
      cta3: { catch: 'CTA3キャッチ', sub: 'CTA3サブ' },
    };

    const result = insertCtasIntoHtml(html, ctaTexts, 'test-slug');

    expect(result).toContain('data-cta-position="mid"');
    expect(result).toContain('data-cta-position="end"');
  });
});
