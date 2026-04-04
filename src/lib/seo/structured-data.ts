// ============================================================================
// src/lib/seo/structured-data.ts
// JSON-LD 構造化データ生成
// ============================================================================

import type { Article } from '@/types/article';

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

// ─── 定数: Person 固定情報 ──────────────────────────────────────────────────

const PERSON_INFO = {
  name: '小林由起子',
  jobTitle: 'スピリチュアルカウンセラー',
  url: 'https://harmony-mc.com/profile',
  knowsAbout: [
    '霊視',
    '前世リーディング',
    'カルマ',
    'チャクラ',
    'エネルギーワーク',
  ],
} as const;

const SITE_URL = 'https://harmony-mc.com';

// ─── Article JSON-LD ────────────────────────────────────────────────────────

/**
 * Article スキーマを生成する。
 * Google が推奨する Article 構造化データに準拠。
 */
export function generateArticleSchema(article: Article): JsonLdSchema {
  const publishedDate = article.published_at ?? article.created_at;
  const modifiedDate = article.updated_at;
  const slug = article.slug ?? article.id;
  const url = `${SITE_URL}/column/${slug}`;
  const title = article.title ?? '';
  const description = article.meta_description ?? '';
  const imageUrl = article.image_files
    ? extractFirstImageUrl(article.image_files)
    : `${SITE_URL}/og-default.jpg`;

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
      name: PERSON_INFO.name,
      url: PERSON_INFO.url,
    },
    publisher: {
      '@type': 'Organization',
      name: 'Harmony スピリチュアルコラム',
      url: SITE_URL,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/logo.png`,
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

/**
 * FAQPage スキーマを生成する。
 * AIO（AI Overview）表示に有効。
 */
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

/**
 * BreadcrumbList スキーマを生成する。
 * パンくずリスト構造化データ。
 */
export function generateBreadcrumbSchema(
  items: BreadcrumbItem[],
): JsonLdSchema {
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

/**
 * Person スキーマを生成する。
 * 小林由起子の固定情報を返す。E-E-A-T シグナルとして重要。
 */
export function generatePersonSchema(): JsonLdSchema {
  return {
    '@type': 'Person',
    name: PERSON_INFO.name,
    jobTitle: PERSON_INFO.jobTitle,
    url: PERSON_INFO.url,
    knowsAbout: [...PERSON_INFO.knowsAbout],
    sameAs: [SITE_URL],
  };
}

// ─── 統合 @graph 形式 ───────────────────────────────────────────────────────

/**
 * @graph 形式で全スキーマを統合した JSON-LD 文字列を生成する。
 * head 内に <script type="application/ld+json"> として埋め込む。
 */
export function generateFullSchema(article: Article): string {
  const slug = article.slug ?? article.id;
  const url = `${SITE_URL}/column/${slug}`;

  // FAQ データをパース
  const faqs = parseFaqData(article.faq_data);

  // パンくずリスト
  const breadcrumbs: BreadcrumbItem[] = [
    { name: 'ホーム', url: SITE_URL },
    { name: 'コラム', url: `${SITE_URL}/column` },
    { name: article.title ?? 'コラム記事', url },
  ];

  const graph: JsonLdSchema[] = [
    generateArticleSchema(article),
    generatePersonSchema(),
    generateBreadcrumbSchema(breadcrumbs),
  ];

  // FAQ がある場合のみ追加
  if (faqs.length > 0) {
    graph.push(generateFAQSchema(faqs));
  }

  const fullSchema = {
    '@context': 'https://schema.org',
    '@graph': graph,
  };

  return JSON.stringify(fullSchema, null, 2);
}

// ─── ヘルパー ───────────────────────────────────────────────────────────────

/**
 * image_files フィールドから最初の画像 URL を抽出する。
 */
function extractFirstImageUrl(imageFiles: unknown): string {
  if (typeof imageFiles === 'string') {
    try {
      const parsed = JSON.parse(imageFiles);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed[0].url ?? parsed[0].src ?? `${SITE_URL}/og-default.jpg`;
      }
    } catch {
      return `${SITE_URL}/og-default.jpg`;
    }
  }

  if (Array.isArray(imageFiles) && imageFiles.length > 0) {
    const first = imageFiles[0] as Record<string, string>;
    return first.url ?? first.src ?? `${SITE_URL}/og-default.jpg`;
  }

  return `${SITE_URL}/og-default.jpg`;
}

/**
 * faq_data フィールドを FAQItem[] にパースする。
 */
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
