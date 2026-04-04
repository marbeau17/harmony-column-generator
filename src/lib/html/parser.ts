// ============================================================================
// src/lib/html/parser.ts
// cheerioベースのHTMLパーサー
//
// 公開済み記事HTMLをパースし、
// エディタで再編集可能な構造化データに変換する。
// ============================================================================

import * as cheerio from 'cheerio';
import { logger } from '@/lib/logger';

// ─── パース結果型 ──────────────────────────────────────────────────────────

export interface TocItem {
  href: string;
  text: string;
}

export interface BodySection {
  tag: 'h2' | 'h3';
  id: string;
  text: string;
  contentHtml: string;
}

export interface RelatedArticleRef {
  href: string;
  title: string;
}

export interface ImageRef {
  src: string;
  alt: string;
}

export interface ParsedArticle {
  title: string;
  metaDescription: string;
  introduction: string;
  tocItems: TocItem[];
  bodySections: BodySection[];
  relatedArticles: RelatedArticleRef[];
  ctaSection: string;
  storeInfoBox: string;
  images: ImageRef[];
}

// ─── メインパーサー ─────────────────────────────────────────────────────────

export function parseArticleHtml(html: string): ParsedArticle {
  const $ = cheerio.load(html, { xml: { decodeEntities: false } } as any);

  // 1. title — <h1> テキスト
  const title = $('h1').first().text().trim();

  // 2. meta description
  const metaDescription = $('meta[name="description"]').attr('content') || '';

  // 3. introduction — h1直後〜.toc-box直前のHTML
  let introduction = '';
  const container = $('.container').first();
  const h1 = container.find('h1').first();
  if (h1.length) {
    let node = h1.get(0)?.nextSibling;
    const parts: string[] = [];
    while (node) {
      const $node = $(node);
      if ($node.hasClass('toc-box') || $node.is('h2')) break;
      if ($node.hasClass('placeholder-container')) { node = node.nextSibling; continue; }
      const outer = $.html(node);
      if (outer && outer.trim()) parts.push(outer);
      node = node.nextSibling;
    }
    introduction = parts.join('').trim();
  }

  // 4. TOC items — .toc-list li > a
  const tocItems: TocItem[] = [];
  $('.toc-list li a').each((_, el) => {
    tocItems.push({
      href: $(el).attr('href') || '',
      text: $(el).text().trim(),
    });
  });

  // 5. body sections — h2/h3 とその後続コンテンツ
  const bodySections: BodySection[] = [];
  container.find('h2, h3').each((_, el) => {
    const $heading = $(el);
    const tag = el.tagName.toLowerCase() as 'h2' | 'h3';
    const id = $heading.attr('id') || `section-${bodySections.length + 1}`;
    const text = $heading.text().trim();

    // 除外チェック: toc-box, related-articles, cta-section, store-info-box 内の見出しは無視
    if ($heading.closest('.toc-box, .related-articles, .cta-section, .store-info-box').length > 0) return;

    // h2/h3 の直後〜次の h2/h3 or .related-articles or .cta-section まで
    const contentParts: string[] = [];
    let sibling = el.nextSibling;
    while (sibling) {
      const $sib = $(sibling);
      if ($sib.is('h2') || $sib.is('h3') || $sib.hasClass('related-articles') || $sib.hasClass('cta-section')) break;
      const outer = $.html(sibling);
      if (outer && outer.trim()) contentParts.push(outer);
      sibling = sibling.nextSibling;
    }

    bodySections.push({ tag, id, text, contentHtml: contentParts.join('').trim() });
  });

  // 6. related articles — .related-list li > a
  const relatedArticles: RelatedArticleRef[] = [];
  $('.related-list li a').each((_, el) => {
    relatedArticles.push({
      href: $(el).attr('href') || '',
      title: $(el).text().trim(),
    });
  });

  // 7. CTA section innerHTML
  const ctaSection = $('.cta-section').html()?.trim() || '';

  // 8. store info box innerHTML
  const storeInfoBox = $('.store-info-box').html()?.trim() || '';

  // 9. images — all img[src]
  const images: ImageRef[] = [];
  $('img').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (src) images.push({ src, alt: $(el).attr('alt') || '' });
  });

  logger.info('system', 'html-parser.parsed', {
    title: title.slice(0, 40),
    sections: bodySections.length,
    images: images.length,
  });

  return {
    title,
    metaDescription,
    introduction,
    tocItems,
    bodySections,
    relatedArticles,
    ctaSection,
    storeInfoBox,
    images,
  };
}

// ─── 本文HTMLの再構築 (bodySections → HTML文字列) ───────────────────────────

export function sectionsToHtml(sections: BodySection[]): string {
  return sections
    .map((s) => {
      const idAttr = s.id ? ` id="${s.id}"` : '';
      return `<${s.tag}${idAttr}>${s.text}</${s.tag}>\n${s.contentHtml}`;
    })
    .join('\n\n');
}

// ─── 記事HTML全体から本文部分のみ抽出 ───────────────────────────────────────

export function extractBodyHtml(html: string): string {
  const $ = cheerio.load(html, { xml: { decodeEntities: false } } as any);
  const container = $('.container').first().clone();

  // 本文に不要な要素を除去
  container.find('h1, .toc-box, .related-articles, .cta-section').remove();
  container.find('.placeholder-container').first().remove();

  return container.html()?.trim() || '';
}
