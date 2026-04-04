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
  const html = buildCtaHtml('intro', 'キャッチコピー', 'サブテキスト', 'test-slug');

  it('HTMLにharmony-booking.web.appのURLが含まれる', () => {
    expect(html).toContain('harmony-booking.web.app');
  });

  it('UTMパラメータが含まれる', () => {
    expect(html).toContain('utm_source=column');
    expect(html).toContain('utm_medium=cta');
    expect(html).toContain('utm_campaign=test-slug');
    expect(html).toContain('utm_content=intro');
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
