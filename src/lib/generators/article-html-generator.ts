// ============================================================================
// src/lib/generators/article-html-generator.ts
// 個別記事の静的HTML生成エンジン
//
// テンプレート templates/hub/article.html に記事データを埋め込んで
// FTPアップロード用の完全なHTMLを生成する。
// harmony-mc.com と完全にシームレスな見た目を実現。
// ============================================================================

import { insertCtasIntoHtml, selectCtaTexts } from '@/lib/content/cta-generator';
import { getStickyCtaBarCss, getStickyCtaBarHtml } from '@/lib/generators/sticky-cta-bar';
import {
  generateArticleSchema,
  generateFAQSchema,
  generatePersonSchema,
  generateBreadcrumbSchema,
} from '@/lib/seo/structured-data';
import type { Article } from '@/types/article';

// ─── 定数 ──────────────────────────────────────────────────────────────────

const SITE_URL = 'https://harmony-mc.com';
const BOOKING_URL = 'https://harmony-booking.web.app/';
const HUB_URL = `${SITE_URL}/column`;
const GA4_ID = process.env.NEXT_PUBLIC_GA_ID || 'G-TH2XJ24V3T';

function buildGA4Tag(): string {
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA4_ID}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${GA4_ID}');
  </script>`;
}

const COUNSELOR = {
  name: '小林由起子',
  role: 'スピリチュアルカウンセラー',
  bio: '20年以上のスピリチュアルカウンセリング経験を持つ。ツインレイ・前世療法・チャクラヒーリングを専門とし、多くの方の魂の成長をサポート。グリーフケアにも力を入れ、悲しみを抱える方々に寄り添うセッションを提供している。',
  avatarUrl: 'https://khsorerqojgwbmtiqrac.supabase.co/storage/v1/object/public/article-images/profile/author-sketch.jpg',
} as const;

const DISCLAIMER_TEXT =
  '※ 本コラムの内容はスピリチュアルカウンセラーの経験と知見に基づく情報提供を目的としており、医学的・科学的根拠に基づくものではありません。心身の不調がある場合は、必ず医療専門家にご相談ください。スピリチュアルカウンセリングは医療行為ではなく、効果には個人差があります。本コラムの情報を参考にした判断や行動について、当方は一切の責任を負いかねます。';

/** テーマ → カテゴリ表示名マッピング */
const THEME_LABELS: Record<string, string> = {
  soul_mission: '魂の使命',
  relationships: '人間関係',
  grief_care: 'グリーフケア',
  self_growth: '自己成長',
  healing: 'ヒーリング',
  daily_awareness: '日常の気づき',
  spiritual_intro: 'スピリチュアル入門',
};

// ─── ヘルパー ──────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** ISO日付文字列を日本語表記に変換 */
function formatDateJa(isoDate: string): string {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return isoDate;
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}年${m}月${day}日`;
}

// ─── FAQ HTML生成 ──────────────────────────────────────────────────────────

interface FAQItem {
  question: string;
  answer: string;
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

function buildFaqHtml(faqs: FAQItem[]): string {
  if (faqs.length === 0) return '';
  return faqs
    .map(
      (faq) =>
        `<dl class="faq-item">
          <dt>${escHtml(faq.question)}</dt>
          <dd>${escHtml(faq.answer)}</dd>
        </dl>`,
    )
    .join('\n');
}

// ─── 関連記事HTML生成 ──────────────────────────────────────────────────────

function buildRelatedArticlesHtml(
  articles: { href: string; title: string }[] | null,
): string {
  if (!articles || articles.length === 0) return '<p class="article-related-empty">他のコラムも準備中です。お楽しみに。</p>';

  return articles
    .slice(0, 3)
    .map((a) => {
      // hrefからslugを抽出してサムネイルパスを生成
      const slug = a.href.replace(/^\/column\//, '').replace(/\/$/, '');
      const thumbSrc = `/column/${slug}/images/hero.jpg`;
      return `<a href="${escAttr(a.href)}" class="article-related-card">
          <div class="article-related-card-thumb">
            <img src="${escAttr(thumbSrc)}" alt="${escHtml(a.title)}" loading="lazy">
          </div>
          <div class="article-related-card-title">${escHtml(a.title)}</div>
        </a>`;
    })
    .join('\n');
}

// ─── サイドバーHTML生成 ────────────────────────────────────────────────────

function buildSidebarRecentHtml(
  articles: { url: string; title: string; thumbnail?: string }[],
): string {
  if (!articles || articles.length === 0) return '';
  return articles
    .map(
      (a) =>
        `<li>
          <a href="${escAttr(a.url)}">
            ${a.thumbnail ? `<img src="${escAttr(a.thumbnail)}" alt="${escHtml(a.title)}" width="60" height="60" loading="lazy">` : ''}
            <span>${escHtml(a.title)}</span>
          </a>
        </li>`,
    )
    .join('\n');
}

function buildSidebarCategoriesHtml(
  categories: { slug: string; name: string; count?: number }[],
): string {
  if (!categories || categories.length === 0) {
    // デフォルトカテゴリ
    return Object.entries(THEME_LABELS)
      .map(
        ([, name]) => `<li><a href="javascript:void(0)">${escHtml(name)}</a></li>`,
      )
      .join('\n');
  }
  return categories
    .map(
      (c) =>
        `<li><a href="javascript:void(0)" data-filter="${escAttr(c.slug)}">${escHtml(c.name)}${c.count != null ? ` (${c.count})` : ''}</a></li>`,
    )
    .join('\n');
}

// ─── 構造化データ生成（JSON-LD） ──────────────────────────────────────────

function buildStructuredDataScripts(article: Article, faqs: FAQItem[]): string {
  const slug = article.slug ?? article.id;
  const articleUrl = `${HUB_URL}/${slug}.html`;

  // Article schema
  const articleSchema = generateArticleSchema(article);

  // Person schema
  const personSchema = generatePersonSchema();

  // BreadcrumbList schema
  const categoryLabel = THEME_LABELS[article.theme] ?? article.theme;
  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: 'HOME', url: SITE_URL },
    { name: 'コラム', url: HUB_URL },
    { name: categoryLabel, url: `${HUB_URL}/?filter=${article.theme}` },
    { name: article.title ?? 'コラム記事', url: articleUrl },
  ]);

  const graph: Record<string, unknown>[] = [
    articleSchema as Record<string, unknown>,
    personSchema as Record<string, unknown>,
    breadcrumbSchema as Record<string, unknown>,
  ];

  // FAQPage (optional)
  if (faqs.length > 0) {
    const faqSchema = generateFAQSchema(faqs);
    graph.push(faqSchema as Record<string, unknown>);
  }

  const fullSchema = {
    '@context': 'https://schema.org',
    '@graph': graph,
  };

  return `<script type="application/ld+json">\n${JSON.stringify(fullSchema, null, 2)}\n  </script>`;
}

// ─── 入力型: generateArticleHtml に渡すオプション ─────────────────────────

export interface ArticleHtmlOptions {
  /** サイドバー用の最近の記事一覧 */
  recentArticles?: { url: string; title: string; thumbnail?: string }[];
  /** サイドバー用のカテゴリ一覧 */
  categories?: { slug: string; name: string; count?: number }[];
  /** ハブページURL（デフォルト: HUB_URL） */
  hubUrl?: string;
  /** AIO用簡潔回答（未指定時は meta_description を使用） */
  quickAnswer?: string;
  /** アイキャッチ画像URL */
  heroImage?: string;
  /** アイキャッチ画像alt */
  heroImageAlt?: string;
  /** OG画像URL */
  ogImage?: string;
}

// ─── メイン生成関数 ────────────────────────────────────────────────────────

/**
 * 記事データからFTPアップロード用の完全なHTMLを生成する。
 *
 * - CTA自動挿入（cta-generator の insertCtasIntoHtml 使用）
 * - 構造化データ（structured-data の各生成関数使用）
 * - 免責事項自動付記
 * - harmony-mc.com と同一のヘッダー/フッター/サイドバー
 */
export function generateArticleHtml(
  article: Article,
  options: ArticleHtmlOptions = {},
): string {
  const slug = article.slug ?? article.id;
  const hubUrl = options.hubUrl ?? HUB_URL;
  // canonical / OG URL は常に絶対URLを使用（hubUrl がリラティブの場合でも正しく動作）
  const canonicalUrl = `${HUB_URL}/${slug}.html`;
  const dateIso = article.published_at ?? article.created_at;
  const dateDisplay = formatDateJa(dateIso);
  const categoryLabel = THEME_LABELS[article.theme] ?? article.theme;
  const categoryUrl = `${hubUrl}/?filter=${encodeURIComponent(article.theme)}`;
  const title = article.title ?? 'コラム記事';
  const metaDescription = article.meta_description ?? '';
  const keywords = article.keyword ?? '';

  // Hero image
  const heroImage = options.heroImage ?? resolveHeroImage(article);
  const heroImageAlt = options.heroImageAlt ?? title;
  const ogImage = options.ogImage ?? heroImage;

  // Quick answer
  const quickAnswer =
    options.quickAnswer ??
    metaDescription;

  // Body HTML with CTA insertion
  const bodyHtml = buildBodyWithCtas(article, slug);

  // FAQ
  const faqs = parseFaqData(article.faq_data);
  const faqHtml = buildFaqHtml(faqs);

  // Related articles
  const relatedArticlesHtml = buildRelatedArticlesHtml(article.related_articles);

  // Structured data
  const structuredData = buildStructuredDataScripts(article, faqs);

  // Sidebar
  const sidebarRecentHtml = buildSidebarRecentHtml(options.recentArticles ?? []);
  const sidebarCategoriesHtml = buildSidebarCategoriesHtml(options.categories ?? []);

  // ── テンプレート組み立て ──────────────────────────────────────────────

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)} | スピリチュアルカウンセラー小林由起子</title>
  <meta name="description" content="${escAttr(metaDescription)}">
  ${keywords ? `<meta name="keywords" content="${escAttr(keywords)}">` : ''}
  <link rel="canonical" href="${escAttr(canonicalUrl)}">

  <!-- Google Analytics 4 -->
  ${buildGA4Tag()}

  <!-- OGP -->
  <meta property="og:title" content="${escAttr(title)} | スピリチュアルカウンセラー小林由起子">
  <meta property="og:description" content="${escAttr(metaDescription)}">
  <meta property="og:image" content="${escAttr(ogImage)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${escAttr(canonicalUrl)}">
  <meta property="og:site_name" content="スピリチュアルカウンセラー小林由起子">
  <meta property="og:locale" content="ja_JP">
  <meta property="article:published_time" content="${escAttr(dateIso)}">
  <meta property="article:author" content="${escAttr(COUNSELOR.name)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escAttr(title)} | スピリチュアルカウンセラー小林由起子">
  <meta name="twitter:description" content="${escAttr(metaDescription)}">
  <meta name="twitter:image" content="${escAttr(ogImage)}">

  <!-- JSON-LD Structured Data -->
  ${structuredData}

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">

  <!-- Styles -->
  <link rel="stylesheet" href="./css/hub.css">

  <!-- Critical inline styles (CTA, TOC, markers, related articles) -->
  <style>
    /* ─── CTA Blocks ─── */
    .harmony-cta {
      margin: 2rem 0;
      border-radius: 12px;
      padding: 1.2rem 1.5rem;
      max-width: 100%;
      text-align: center;
    }
    .harmony-cta-inner {
      max-width: 520px;
      margin: 0 auto;
    }
    .harmony-cta-badge {
      display: inline-block;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      border-radius: 20px;
      padding: 0.15rem 0.7rem;
      margin-bottom: 0.5rem;
    }
    .harmony-cta-catch {
      font-size: 0.95rem;
      font-weight: 600;
      margin: 0 0 0.25rem;
      line-height: 1.6;
    }
    .harmony-cta-sub {
      font-size: 0.82rem;
      margin: 0 0 0.7rem;
      line-height: 1.5;
      opacity: 0.85;
    }
    .harmony-cta-btn {
      display: inline-block;
      padding: 0.55rem 1.8rem;
      border-radius: 25px;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.88rem;
      transition: transform 0.2s ease, box-shadow 0.3s ease, opacity 0.3s ease;
    }
    .harmony-cta-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      opacity: 0.9;
    }
    /* CTA2: ラベンダー系 */
    .harmony-cta[data-cta-key="cta2"] {
      background: linear-gradient(135deg, #ede7f0 0%, #ddd5e4 100%);
      border-left: 4px solid #9b8bb4;
    }
    .harmony-cta[data-cta-key="cta2"] .harmony-cta-badge {
      background: rgba(155,139,180,0.15);
      color: #9b8bb4;
    }
    .harmony-cta[data-cta-key="cta2"] .harmony-cta-catch,
    .harmony-cta[data-cta-key="cta2"] .harmony-cta-sub {
      color: #53352b;
    }
    .harmony-cta[data-cta-key="cta2"] .harmony-cta-btn {
      background: #9b8bb4;
      color: #fff;
      box-shadow: 0 2px 8px rgba(155,139,180,0.3);
    }
    /* CTA3: ダークブラウン */
    .harmony-cta[data-cta-key="cta3"] {
      background: linear-gradient(135deg, #53352b 0%, #7a5c4f 100%);
      border-left: none;
    }
    .harmony-cta[data-cta-key="cta3"] .harmony-cta-badge {
      background: rgba(255,255,255,0.15);
      color: rgba(255,255,255,0.9);
    }
    .harmony-cta[data-cta-key="cta3"] .harmony-cta-catch {
      color: #fff;
    }
    .harmony-cta[data-cta-key="cta3"] .harmony-cta-sub {
      color: rgba(255,255,255,0.85);
    }
    .harmony-cta[data-cta-key="cta3"] .harmony-cta-btn {
      background: linear-gradient(135deg, #d4a574, #c4856e);
      color: #fff;
      font-size: 0.95rem;
      padding: 0.65rem 2rem;
      box-shadow: 0 3px 12px rgba(212,165,116,0.4);
    }
    .harmony-cta[data-cta-key="cta3"] .harmony-cta-btn:hover {
      box-shadow: 0 5px 16px rgba(212,165,116,0.5);
    }

    /* ─── TOC (Table of Contents) ─── */
    .article-toc {
      background: #faf5f0;
      border: 1px solid #e8ddd0;
      border-radius: 8px;
      padding: 1.2rem 1.5rem;
      margin: 1.5rem 0 2rem;
    }
    .article-toc details summary {
      cursor: pointer;
      list-style: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .article-toc details summary::after {
      content: '▼';
      font-size: 12px;
      color: #8b6f5e;
      transition: transform 0.2s;
    }
    .article-toc details[open] summary::after {
      transform: rotate(180deg);
    }
    .article-toc-title {
      font-size: 15px;
      font-weight: 600;
      color: #53352b;
      margin: 0;
      padding: 0;
      border: none !important;
    }
    .article-toc-list {
      list-style: none;
      padding: 0;
      margin: 0.75rem 0 0;
    }
    .article-toc-list li { padding: 0.2rem 0; }
    .article-toc-list li a { color: #53352b; text-decoration: none; font-size: 14px; }
    .article-toc-list li a:hover { color: #8b6f5e; text-decoration: underline; }
    .article-toc-list ol { list-style: none; padding-left: 1.2rem; margin: 0.2rem 0 0; }

    /* ─── Highlight Markers ─── */
    .marker-yellow {
      background: linear-gradient(transparent 60%, #fff3b0 60%);
      padding: 0 2px;
    }
    .marker-pink {
      background: linear-gradient(transparent 60%, #ffd6e0 60%);
      padding: 0 2px;
    }

    /* ─── Related Articles ─── */
    .article-related { margin: 2rem 0; }
    .article-related h2 { font-size: 1.1rem; font-weight: 600; color: #53352b; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 2px solid #8b6f5e; }
    .article-related-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
    .article-related-card { display: block; border-radius: 8px; overflow: hidden; border: 1px solid #e8ddd0; transition: transform 0.2s, box-shadow 0.2s; text-decoration: none; }
    .article-related-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(83,53,43,0.1); }
    .article-related-card-thumb { height: 120px; background: linear-gradient(135deg, #f5ebe0, #e8ddd0); overflow: hidden; }
    .article-related-card-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .article-related-card-title { font-size: 0.85rem; font-weight: 600; color: #53352b; padding: 0.75rem; margin: 0; line-height: 1.4; }
    .article-related-empty { font-size: 0.9rem; color: #8b6f5e; font-style: italic; }
    @media (max-width: 767px) { .article-related-grid { grid-template-columns: 1fr; } }

    /* ─── Critical Layout (prevents broken display if hub.css loads late) ─── */
    .siteHeader-logo img { max-height: 50px; width: auto; }
    .siteHeader-container { display: flex; align-items: center; justify-content: space-between; max-width: 1100px; margin: 0 auto; padding: 0 15px; min-height: 70px; }
    .article-hero img { width: 100%; max-width: 800px; height: auto; display: block; }
    img { max-width: 100%; height: auto; }

    /* ─── Article Layout ─── */
    .article-hero { margin: 0 0 24px; }
    .article-hero img { width: 100%; max-width: 800px; border-radius: 4px; display: block; height: auto; }
    .article-title { font-size: 26px; color: #333; font-weight: 700; line-height: 1.5; margin-bottom: 20px; }
    .article-quick-answer { background: #faf5f0; border: 1px solid #8b6f5e; border-radius: 4px; padding: 20px 24px; margin-bottom: 32px; font-size: 15px; line-height: 1.9; color: #333; }
    .article-quick-answer::before { content: "\u2728 この記事のポイント"; display: block; font-weight: 700; font-size: 14px; color: #8b6f5e; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px dashed #d4c5b5; }

    /* ─── Article Body ─── */
    .article-body { margin-bottom: 48px; }
    .article-body h2 { font-size: 22px; color: #333; font-weight: 700; border-left: 4px solid #8b6f5e; background: #faf5f0; padding: 12px 15px; margin: 2.5rem 0 1rem; line-height: 1.5; }
    .article-body h3 { font-size: 18px; color: #333; font-weight: 700; border-bottom: 2px solid #8b6f5e; padding-bottom: 8px; margin: 2rem 0 0.8rem; line-height: 1.5; }
    .article-body h4 { font-size: 16px; color: #333; font-weight: 700; padding-left: 12px; border-left: 3px solid #d4c5b5; margin: 1.5rem 0 0.6rem; }
    .article-body p { margin-bottom: 1.4em; font-size: 16px; line-height: 1.9; }
    .article-body img { border-radius: 4px; margin: 1.2em 0; display: block; max-width: 100%; height: auto; }
    .article-body ul, .article-body ol { margin: 1em 0 1.4em 1.5em; }
    .article-body li { margin-bottom: 0.5em; font-size: 15px; line-height: 1.8; }
    .article-body blockquote { border-left: 4px solid #8b6f5e; padding: 12px 16px; margin: 1.5em 0; background: #faf5f0; border-radius: 0 4px 4px 0; color: #555; font-style: italic; }
    .article-body table { width: 100%; border-collapse: collapse; margin: 1.5em 0; }
    .article-body th { background: #faf5f0; font-weight: 700; color: #333; padding: 10px 12px; border: 1px solid #ddd; text-align: left; }
    .article-body td { padding: 10px 12px; border: 1px solid #ddd; }
    .article-body strong { color: #53352b; }

    /* ─── Author Profile ─── */
    .article-author { margin-bottom: 40px; }
    .article-author-inner { display: flex; gap: 20px; padding: 24px; background: #fff; border: 1px solid #eee; border-radius: 4px; align-items: flex-start; }
    .article-author-avatar img { width: 80px; height: 80px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
    .article-author-name { font-size: 16px; font-weight: 700; color: #333; margin-bottom: 2px; }
    .article-author-role { font-size: 13px; color: #8b6f5e; font-weight: 500; margin-bottom: 8px; }
    .article-author-bio { font-size: 14px; color: #666; line-height: 1.7; }
    .article-disclaimer { margin-bottom: 30px; padding: 16px 20px; background: #faf5f0; border-radius: 4px; font-size: 13px; color: #999; line-height: 1.7; }
    /* ─── Footer ─── */
    .siteFooter { background: #53352b; color: rgba(255,255,255,0.7); padding: 30px 0; }
    .siteFooter-inner { max-width: 1100px; margin: 0 auto; padding: 0 15px; }
    .siteFooter-copyright { text-align: center; font-size: 13px; padding-top: 20px; }

    /* ─── Global image safety ─── */
    img { max-width: 100%; height: auto; }
    ${getStickyCtaBarCss()}
  </style>
</head>
<body style="padding-bottom:72px;">

  <!-- ヘッダー（hub/index.html と同一） -->
  <header class="siteHeader">
    <div class="siteHeader-container">
      <a href="https://harmony-mc.com/" class="siteHeader-logo">
        <img src="https://khsorerqojgwbmtiqrac.supabase.co/storage/v1/object/public/article-images/profile/author-sketch.jpg" alt="スピリチュアルカウンセラー小林由起子">
      </a>
      <nav class="gMenu">
        <ul>
          <li><a href="https://harmony-mc.com/">トップ</a></li>
          <li class="menu-item-has-children">
            <a href="https://harmony-mc.com/#howto">カウンセリング</a>
            <ul class="sub-menu">
              <li><a href="https://harmony-mc.com/counseling/">メニュー</a></li>
              <li><a href="https://harmony-mc.com/system/">ご予約の流れ</a></li>
              <li><a href="https://harmony-mc.com/caution/">注意事項</a></li>
            </ul>
          </li>
          <li><a href="https://harmony-mc.com/seminar/">講座・セミナー</a></li>
          <li><a href="https://harmony-mc.com/spiritual-books/">出版書籍</a></li>
          <li class="menu-item-has-children">
            <a href="https://harmony-mc.com/profile/">プロフィール</a>
            <ul class="sub-menu">
              <li><a href="${escAttr(hubUrl)}">コラム</a></li>
            </ul>
          </li>
        </ul>
      </nav>
      <button class="mobile-nav-btn" id="mobileNavBtn" aria-label="メニュー">
        <span></span><span></span><span></span>
      </button>
    </div>
  </header>

  <!-- モバイルナビ（hub/index.html と同一） -->
  <nav class="mobile-nav" id="mobileNav">
    <ul>
      <li><a href="https://harmony-mc.com/">トップ</a></li>
      <li class="mobile-menu-parent">
        <a href="https://harmony-mc.com/#howto">カウンセリング</a>
        <button class="mobile-submenu-toggle" aria-label="サブメニューを開く">+</button>
        <ul class="mobile-sub-menu">
          <li><a href="https://harmony-mc.com/counseling/">メニュー</a></li>
          <li><a href="https://harmony-mc.com/system/">ご予約の流れ</a></li>
          <li><a href="https://harmony-mc.com/caution/">注意事項</a></li>
        </ul>
      </li>
      <li><a href="https://harmony-mc.com/seminar/">講座・セミナー</a></li>
      <li><a href="https://harmony-mc.com/spiritual-books/">出版書籍</a></li>
      <li class="mobile-menu-parent">
        <a href="https://harmony-mc.com/profile/">プロフィール</a>
        <button class="mobile-submenu-toggle" aria-label="サブメニューを開く">+</button>
        <ul class="mobile-sub-menu">
          <li><a href="${escAttr(hubUrl)}">コラム</a></li>
        </ul>
      </li>
    </ul>
  </nav>

  <!-- パンくずリスト: HOME > コラム > カテゴリ > タイトル -->
  <nav class="breadcrumb" aria-label="パンくずリスト">
    <ol itemscope itemtype="https://schema.org/BreadcrumbList">
      <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
        <a itemprop="item" href="https://harmony-mc.com/"><span itemprop="name">HOME</span></a>
        <meta itemprop="position" content="1">
      </li>
      <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
        <a itemprop="item" href="${escAttr(hubUrl)}"><span itemprop="name">コラム</span></a>
        <meta itemprop="position" content="2">
      </li>
      <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
        <a itemprop="item" href="${escAttr(categoryUrl)}"><span itemprop="name">${escHtml(categoryLabel)}</span></a>
        <meta itemprop="position" content="3">
      </li>
      <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
        <span itemprop="name">${escHtml(title)}</span>
        <meta itemprop="position" content="4">
      </li>
    </ol>
  </nav>

  <!-- メインコンテンツ（2カラム） -->
  <div class="container">
    <!-- 左: mainSection -->
    <main class="mainSection">

      <!-- カテゴリバッジ + 日付 -->
      <div class="article-meta">
        <span class="article-category-badge">${escHtml(categoryLabel)}</span>
        <time class="article-date" datetime="${escAttr(dateIso)}">${escHtml(dateDisplay)}</time>
      </div>

      <!-- アイキャッチ画像 -->
      <figure class="article-hero">
        <img src="${escAttr(heroImage)}" alt="${escAttr(heroImageAlt)}" width="800" height="420" loading="eager">
      </figure>

      <!-- h1タイトル -->
      <h1 class="article-title">${escHtml(title)}</h1>

      <!-- AIO用簡潔回答ブロック -->
      <div class="article-quick-answer">
        <p>${escHtml(quickAnswer)}</p>
      </div>

      <!-- 本文HTML（CTA3箇所+画像含む） -->
      <div class="article-body">
        ${bodyHtml}
      </div>

      <!-- FAQ（構造化データ付き） -->
      ${faqs.length > 0 ? `<section class="article-faq">
        <h2>よくある質問</h2>
        ${faqHtml}
      </section>` : ''}

      <!-- 著者プロフィールカード -->
      <div class="article-author">
        <div class="article-author-inner">
          <div class="article-author-avatar">
            <img src="${escAttr(COUNSELOR.avatarUrl)}" alt="${escAttr(COUNSELOR.name)}" width="80" height="80">
          </div>
          <div class="article-author-info">
            <p class="article-author-name">${escHtml(COUNSELOR.name)}</p>
            <p class="article-author-role">${escHtml(COUNSELOR.role)}</p>
            <p class="article-author-bio">${escHtml(COUNSELOR.bio)}</p>
          </div>
        </div>
      </div>

      <!-- 関連記事3件 -->
      <section class="article-related">
        <h2>関連記事</h2>
        <div class="article-related-grid">
          ${relatedArticlesHtml}
        </div>
      </section>

      <!-- 免責事項 -->
      <div class="article-disclaimer">
        <p>${escHtml(DISCLAIMER_TEXT)}</p>
      </div>

    </main>

    <!-- 右: subSection（ハブページと同じサイドバー） -->
    <aside class="subSection">
      <div class="widget cta-widget">
        <h3 class="subSection-title">ご予約・ご相談</h3>
        <p>あなたの心に寄り添うスピリチュアルカウンセリング</p>
        <a href="${BOOKING_URL}?utm_source=column&utm_medium=sidebar&utm_campaign=${encodeURIComponent(slug)}" class="cta-button" target="_blank" rel="noopener">カウンセリングを予約する</a>
      </div>
      <div class="widget">
        <h3 class="subSection-title">最近のコラム</h3>
        <ul class="recent-posts">
          ${sidebarRecentHtml}
        </ul>
      </div>
      <div class="widget">
        <h3 class="subSection-title">カテゴリー</h3>
        <ul class="category-list">
          ${sidebarCategoriesHtml}
        </ul>
      </div>
    </aside>
  </div>

  <!-- フッター（hub/index.html と同一） -->
  <footer class="siteFooter">
    <div class="siteFooter-inner">
      <nav class="siteFooter-nav">
        <ul>
          <li><a href="https://harmony-mc.com/">トップ</a></li>
          <li><a href="https://harmony-mc.com/counseling/">カウンセリングメニュー</a></li>
          <li><a href="https://harmony-mc.com/system/">ご予約の流れ</a></li>
          <li><a href="https://harmony-mc.com/caution/">注意事項</a></li>
          <li><a href="https://harmony-mc.com/seminar/">講座・セミナー</a></li>
          <li><a href="https://harmony-mc.com/spiritual-books/">出版書籍</a></li>
          <li><a href="https://harmony-mc.com/profile/">プロフィール</a></li>
          <li><a href="${escAttr(hubUrl)}">コラム</a></li>
        </ul>
      </nav>
      <p class="siteFooter-copyright">Copyright &copy; スピリチュアルハーモニー All Rights Reserved.</p>
    </div>
  </footer>

  <!-- Scroll to Top Button -->
  <button class="scroll-to-top-btn" id="scrollToTopBtn" aria-label="トップに戻る">&uarr;</button>

  <script src="./js/hub.js"></script>
  ${getStickyCtaBarHtml()}
</body>
</html>`;
}

// ─── 内部ヘルパー: 本文にCTAを自動挿入 ────────────────────────────────────

/**
 * 記事本文HTMLにCTA3箇所を自動挿入する。
 * cta-generator の insertCtasIntoHtml / selectCtaTexts を使用。
 */
function buildBodyWithCtas(article: Article, slug: string): string {
  // 本文HTML取得（stage3 > stage2 > content の優先度）
  let bodyHtml = article.stage3_final_html ?? article.stage2_body_html ?? article.content ?? '';

  // Remove hero image from body (template already shows hero)
  bodyHtml = bodyHtml.replace(/<!--IMAGE:hero:[^>]*-->\s*/g, '');
  // Remove img tags that reference hero images (Supabase or local)
  bodyHtml = bodyHtml.replace(/<img[^>]*(?:hero\.jpg|hero\.webp|hero\.svg)[^>]*>\s*/g, '');

  if (!bodyHtml.trim()) return '';

  // ── AI生成HTMLの修復 ──
  // 1. バックスラッシュエスケープされた属性値を修復
  //    パターン: ="\"value\"" → ="value"  /  ="\&quot;value\&quot;" → ="value"
  bodyHtml = bodyHtml.replace(/="\\&quot;/g, '="').replace(/\\&quot;"/g, '"');
  bodyHtml = bodyHtml.replace(/="\\"/g, '="').replace(/\\""/g, '"');
  // 2. TOC/CTA内の不要な<br>タグを除去（構造タグの直後/直前）
  bodyHtml = bodyHtml.replace(/<br\s*\/?>\s*(<\/?(?:nav|details|summary|ol|li|div|a|p)\b)/gi, '$1');
  bodyHtml = bodyHtml.replace(/(<\/?(?:nav|details|summary|ol|li|div|a|p)[^>]*>)\s*<br\s*\/?>/gi, '$1');
  // 3. AI が勝手に挿入した壊れCTAを除去（正規のinsertCtasIntoHtmlで再挿入される）
  bodyHtml = bodyHtml.replace(/<div class="harmony-cta">\s*<p class="harmony-cta-catch">[\s\S]*?<\/a>\s*<\/div>/gi, '');
  // 4. <p> 内のブロック要素を修復（<p><div...> → </p><div...>）
  bodyHtml = bodyHtml.replace(/<p>\s*(<div\s)/gi, '$1');
  bodyHtml = bodyHtml.replace(/(<\/div>)\s*<\/p>/gi, '$1');

  // テーマからCTAテキスト選択
  // cta-generator の theme マッピング: daily_awareness → daily, spiritual_intro → introduction
  const themeMap: Record<string, string> = {
    daily_awareness: 'daily',
    spiritual_intro: 'introduction',
  };
  const ctaTheme = themeMap[article.theme] ?? article.theme;
  const ctaTexts = selectCtaTexts(ctaTheme, article.id);

  // CTA自動挿入
  bodyHtml = insertCtasIntoHtml(bodyHtml, ctaTexts, slug);

  return bodyHtml;
}

// ─── 内部ヘルパー: Hero画像URL解決 ────────────────────────────────────────

function resolveHeroImage(article: Article): string {
  // image_files から最初の画像を取得
  if (article.image_files) {
    try {
      const files =
        typeof article.image_files === 'string'
          ? JSON.parse(article.image_files)
          : article.image_files;

      if (Array.isArray(files) && files.length > 0) {
        const first = files[0] as Record<string, string>;
        if (first.url) return first.url;
        if (first.src) return first.src;
        if (first.filename) return `placeholders/${first.filename}`;
      }
    } catch {
      // ignore parse errors
    }
  }

  // フォールバック
  return `${SITE_URL}/og-default.jpg`;
}
