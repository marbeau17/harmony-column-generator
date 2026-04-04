// ============================================================================
// src/lib/generators/article-html-generator.ts
// 個別記事の静的HTML生成エンジン
//
// テンプレート templates/hub/article.html に記事データを埋め込んで
// FTPアップロード用の完全なHTMLを生成する。
// harmony-mc.com と完全にシームレスな見た目を実現。
// ============================================================================

import { insertCtasIntoHtml, selectCtaTexts } from '@/lib/content/cta-generator';
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
  avatarUrl: 'https://harmony-mc.com/wp-content/uploads/2019/12/brand.png',
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
  if (!articles || articles.length === 0) return '<p>関連記事はありません。</p>';

  return articles
    .slice(0, 3)
    .map(
      (a) =>
        `<a href="${escAttr(a.href)}" class="article-related-card">
          <div class="article-related-card-title">${escHtml(a.title)}</div>
        </a>`,
    )
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
            ${a.thumbnail ? `<img src="${escAttr(a.thumbnail)}" alt="" width="60" height="60" loading="lazy">` : ''}
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
  const canonicalUrl = `${hubUrl}/${slug}.html`;
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
</head>
<body>

  <!-- ヘッダー（hub/index.html と同一） -->
  <header class="siteHeader">
    <div class="siteHeader-container">
      <a href="https://harmony-mc.com/" class="siteHeader-logo">
        <img src="https://harmony-mc.com/wp-content/uploads/2019/12/brand.png" alt="スピリチュアルカウンセラー小林由起子">
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

  <script src="./js/hub.js"></script>
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

  if (!bodyHtml.trim()) return '';

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
