// ============================================================================
// src/lib/seo/structured-data.ts
// JSON-LD 構造化データ生成 (P5-18 で settings ベースに refactor)
//
// 旧版 (commit ~bc4049a) は SITE_URL / PERSON_INFO 等の hardcoded 定数を
// 持っていたが、それらは src/lib/seo/seo-settings.ts に DEFAULT_SEO_SETTINGS と
// して移管され、本ファイルは settings 引数を受け取る純粋関数になった。
// 後方互換: settings 未指定 → DEFAULT_SEO_SETTINGS を使うため既存呼出はそのまま動く。
// ============================================================================

import type { Article } from '@/types/article';
import {
  DEFAULT_SEO_SETTINGS,
  type SeoSettings,
} from '@/lib/seo/seo-settings';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

interface FAQItem {
  question: string;
  answer: string;
}

interface BreadcrumbItem {
  name: string;
  url: string;
}

interface JsonLdSchema {
  '@context'?: string;
  '@type': string;
  [key: string]: unknown;
}

// ─── Article JSON-LD ────────────────────────────────────────────────────────

export function generateArticleSchema(
  article: Article,
  settings: SeoSettings = DEFAULT_SEO_SETTINGS,
): JsonLdSchema {
  const publishedDate = article.published_at ?? article.created_at;
  const modifiedDate = article.updated_at;
  const slug = article.slug ?? article.id;
  const url = `${settings.site_url}/column/${slug}`;
  const title = article.title ?? '';
  const description = article.meta_description ?? '';
  const imageUrl = article.image_files
    ? extractFirstImageUrl(article.image_files, settings.og_default_image_url)
    : settings.og_default_image_url;

  return {
    '@type': 'Article',
    headline: title,
    description,
    url,
    datePublished: publishedDate,
    dateModified: modifiedDate,
    image: imageUrl,
    author: {
      '@type': 'Person',
      name: settings.author_name,
      url: settings.author_profile_url,
    },
    publisher: {
      '@type': 'Organization',
      name: settings.publisher_name,
      url: settings.publisher_url,
      logo: {
        '@type': 'ImageObject',
        url: settings.publisher_logo_url,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': url,
    },
    wordCount: article.target_word_count,
    keywords: article.keyword,
    articleSection: article.theme,
    inLanguage: 'ja',
  };
}

// ─── FAQPage JSON-LD ────────────────────────────────────────────────────────

export function generateFAQSchema(faqs: FAQItem[]): JsonLdSchema {
  if (faqs.length === 0) {
    return { '@type': 'FAQPage', mainEntity: [] };
  }
  return {
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };
}

// ─── BreadcrumbList JSON-LD ─────────────────────────────────────────────────

export function generateBreadcrumbSchema(items: BreadcrumbItem[]): JsonLdSchema {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

// ─── Person JSON-LD ─────────────────────────────────────────────────────────

export function generatePersonSchema(
  settings: SeoSettings = DEFAULT_SEO_SETTINGS,
): JsonLdSchema {
  // sameAs: profile_url を必ず先頭に含める。重複は除去。
  const sameAsRaw = [settings.author_profile_url, ...settings.author_same_as].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
  const sameAs = Array.from(new Set(sameAsRaw));

  const out: JsonLdSchema = {
    '@type': 'Person',
    name: settings.author_name,
    jobTitle: settings.author_job_title,
    url: settings.author_profile_url,
    knowsAbout: [...settings.author_knows_about],
    sameAs,
  };
  if (settings.author_image_url) out.image = settings.author_image_url;
  if (settings.author_bio) out.description = settings.author_bio;
  return out;
}

// ─── 統合 @graph 形式 ───────────────────────────────────────────────────────

/**
 * @graph 形式で全スキーマを統合した JSON-LD オブジェクトを生成する。
 * 戻り値はオブジェクトのまま（呼び出し側で JSON.stringify する）。
 *
 * settings の enable_* トグルが false の schema は `@graph` から除外される。
 */
export function generateFullSchema(
  article: Article,
  settings: SeoSettings = DEFAULT_SEO_SETTINGS,
): string {
  const slug = article.slug ?? article.id;
  const url = `${settings.site_url}/column/${slug}`;

  const faqs = parseFaqData(article.faq_data);

  const breadcrumbs: BreadcrumbItem[] = [
    { name: settings.breadcrumb_home_label, url: settings.site_url },
    {
      name: settings.breadcrumb_section_label,
      url: settings.breadcrumb_section_url.startsWith('http')
        ? settings.breadcrumb_section_url
        : `${settings.site_url}${settings.breadcrumb_section_url}`,
    },
    { name: article.title ?? settings.breadcrumb_section_label, url },
  ];

  const graph: JsonLdSchema[] = [];
  if (settings.enable_article_schema) graph.push(generateArticleSchema(article, settings));
  if (settings.enable_person_schema) graph.push(generatePersonSchema(settings));
  if (settings.enable_breadcrumb_schema) graph.push(generateBreadcrumbSchema(breadcrumbs));
  if (settings.enable_faq_schema && faqs.length > 0) graph.push(generateFAQSchema(faqs));

  const fullSchema = {
    '@context': 'https://schema.org',
    '@graph': graph,
  };

  return JSON.stringify(fullSchema, null, 2);
}

// ─── ヘルパー ───────────────────────────────────────────────────────────────

function extractFirstImageUrl(imageFiles: unknown, fallback: string): string {
  if (typeof imageFiles === 'string') {
    try {
      const parsed = JSON.parse(imageFiles);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return (parsed[0].url as string | undefined) ?? (parsed[0].src as string | undefined) ?? fallback;
      }
    } catch {
      return fallback;
    }
  }
  if (Array.isArray(imageFiles) && imageFiles.length > 0) {
    const first = imageFiles[0] as Record<string, string>;
    return first.url ?? first.src ?? fallback;
  }
  return fallback;
}

function parseFaqData(faqData: unknown): FAQItem[] {
  if (!faqData) return [];
  let items: unknown[];
  if (typeof faqData === 'string') {
    try {
      items = JSON.parse(faqData);
    } catch {
      return [];
    }
  } else if (Array.isArray(faqData)) {
    items = faqData;
  } else {
    return [];
  }
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item): item is FAQItem =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as FAQItem).question === 'string' &&
      typeof (item as FAQItem).answer === 'string',
  );
}
