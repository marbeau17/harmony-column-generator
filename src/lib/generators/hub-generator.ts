// ============================================================================
// src/lib/generators/hub-generator.ts
// ハブページ（コラム一覧）HTML生成エンジン
//
// Supabaseからpublished記事を取得し、ページネーション付きの
// 静的HTMLハブページを生成する。
// ============================================================================

import { createServiceRoleClient } from '@/lib/supabase/server';
import { applyPubliclyVisibleFilter } from '@/lib/publish-control/state-readers-sql';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

export interface HubArticleCard {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  date: string;        // YYYY/MM/DD形式
  theme: string;
  categoryLabel: string;
  thumbnailUrl: string;
  articleUrl: string;
}

export interface HubPageData {
  articles: HubArticleCard[];
  currentPage: number;
  totalPages: number;
  categories: { slug: string; name: string; count: number }[];
  recentArticles: HubArticleCard[];
}

// ─── 定数 ────────────────────────────────────────────────────────────────────

const ARTICLES_PER_PAGE = 10;
const SITE_NAME = 'Harmonyスピリチュアルコラム';
const SITE_URL = 'https://harmony-mc.com';
const COLUMNS_BASE = `${SITE_URL}/columns`;
const BOOKING_URL = 'https://harmony-booking.web.app/';
const GA4_ID = process.env.NEXT_PUBLIC_GA_ID || 'G-TH2XJ24V3T';

/** GA4タグを生成 */
function buildGA4Tag(): string {
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA4_ID}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${GA4_ID}');
  </script>`;
}

/** テーマ slug → 日本語ラベル */
const THEME_LABEL_MAP: Record<string, string> = {
  healing: '癒しと浄化',
  relationships: '人間関係',
  introduction: 'スピリチュアル入門',
  daily: '日常の気づき',
  self_growth: '自己成長',
  soul_mission: '魂と使命',
  grief_care: 'グリーフケア',
};

// ─── ヘルパー ────────────────────────────────────────────────────────────────

function esc(s: string): string {
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

function getThemeLabel(theme: string): string {
  return THEME_LABEL_MAP[theme] || theme;
}

/**
 * HTMLタグを除去してプレーンテキストを取得
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

/**
 * 抜粋を生成（最大120文字）
 */
function makeExcerpt(html: string, maxLen = 120): string {
  const text = stripHtml(html).replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? text.slice(0, maxLen - 3) + '...' : text;
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

function getHubCSS(): string {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Noto Sans JP', sans-serif; line-height: 1.8; color: #333; background-color: #faf8f5; letter-spacing: 0.05em; padding-top: 70px; }
    a { text-decoration: none; color: inherit; }

    /* ナビゲーション */
    #sticky-nav { position: fixed; top: 0; left: 0; width: 100%; height: 50px; background: linear-gradient(135deg, #53352b, #8b6f5e); box-shadow: 0 2px 5px rgba(83,53,43,0.15); z-index: 9999; display: flex; justify-content: center; align-items: center; }
    .nav-inner { width: 100%; max-width: 1000px; display: flex; justify-content: space-around; align-items: center; padding: 0 10px; }
    #sticky-nav a { text-decoration: none; font-weight: bold; color: #fff; font-size: 13px; padding: 6px 15px; border-radius: 20px; transition: all 0.3s; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
    #sticky-nav a:hover { background: #fff; color: #53352b; }

    /* ページヘッダー */
    .hub-header { text-align: center; padding: 40px 20px 30px; }
    .hub-header h1 { font-size: 28px; color: #53352b; margin-bottom: 10px; }
    .hub-header p { color: #888; font-size: 14px; }

    /* メインレイアウト */
    .hub-layout { max-width: 1100px; margin: 0 auto; padding: 0 20px 40px; display: grid; grid-template-columns: 1fr 280px; gap: 30px; }

    /* 記事カード */
    .article-grid { display: flex; flex-direction: column; gap: 20px; }
    .article-card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(83,53,43,0.06); overflow: hidden; display: grid; grid-template-columns: 240px 1fr; transition: box-shadow 0.3s, transform 0.2s; }
    .article-card:hover { box-shadow: 0 4px 20px rgba(83,53,43,0.12); transform: translateY(-2px); }
    .card-thumbnail { width: 100%; height: 100%; object-fit: cover; min-height: 160px; }
    .card-body { padding: 20px; display: flex; flex-direction: column; justify-content: space-between; }
    .card-meta { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .card-category { background: #f5ebe0; color: #8b6f5e; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 12px; }
    .card-date { font-size: 12px; color: #999; }
    .card-title { font-size: 17px; font-weight: 700; color: #53352b; margin-bottom: 8px; line-height: 1.5; }
    .card-excerpt { font-size: 13px; color: #666; line-height: 1.7; }
    .card-link { display: inline-block; margin-top: 10px; color: #8b6f5e; font-size: 13px; font-weight: 700; }
    .card-link:hover { text-decoration: underline; }

    /* サイドバー */
    .sidebar { display: flex; flex-direction: column; gap: 25px; }
    .sidebar-section { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(83,53,43,0.06); padding: 20px; }
    .sidebar-section h3 { font-size: 15px; color: #53352b; border-bottom: 2px solid #e8d5c4; padding-bottom: 8px; margin-bottom: 15px; }
    .category-list { list-style: none; }
    .category-list li { margin-bottom: 8px; }
    .category-list li a { display: flex; justify-content: space-between; align-items: center; color: #555; font-size: 14px; padding: 6px 0; border-bottom: 1px dashed #eee; transition: color 0.2s; }
    .category-list li a:hover { color: #8b6f5e; }
    .category-count { background: #f5ebe0; color: #8b6f5e; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px; }
    .recent-list { list-style: none; }
    .recent-list li { margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #f0ebe5; }
    .recent-list li:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    .recent-list li a { font-size: 13px; color: #555; line-height: 1.6; }
    .recent-list li a:hover { color: #8b6f5e; }
    .recent-date { font-size: 11px; color: #aaa; display: block; margin-top: 2px; }

    /* ページネーション */
    .pagination { display: flex; justify-content: center; align-items: center; gap: 8px; margin-top: 30px; padding: 20px 0; }
    .pagination a, .pagination span { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 8px; font-size: 14px; font-weight: 700; transition: all 0.2s; }
    .pagination a { background: #fff; color: #53352b; border: 1px solid #e8d5c4; }
    .pagination a:hover { background: #f5ebe0; }
    .pagination .current { background: #53352b; color: #fff; border: 1px solid #53352b; }
    .pagination .dots { background: none; border: none; color: #999; }
    .pagination .prev-next { width: auto; padding: 0 15px; font-size: 13px; }

    /* フッター */
    footer { text-align: center; padding: 20px 0; color: #888; font-size: 12px; border-top: 1px solid #e8d5c4; margin-top: 40px; }
    .site-copyright { text-align: center; padding: 1.5rem 0; background: #53352b; color: rgba(255,255,255,0.7); font-size: 0.8rem; border-top: 3px solid #8b6f5e; }

    /* レスポンシブ */
    @media (max-width: 768px) {
      .hub-layout { grid-template-columns: 1fr; }
      .article-card { grid-template-columns: 1fr; }
      .card-thumbnail { height: 180px; }
      #sticky-nav a { font-size: 10px; padding: 6px 4px; }
    }
  `;
}

// ─── 記事カードHTML生成 ──────────────────────────────────────────────────────

function buildArticleCardHtml(card: HubArticleCard): string {
  return `
      <a href="${escAttr(card.articleUrl)}" class="article-card">
        <img class="card-thumbnail" src="${escAttr(card.thumbnailUrl)}" alt="${escAttr(card.title)}" loading="lazy" />
        <div class="card-body">
          <div>
            <div class="card-meta">
              <span class="card-category">${esc(card.categoryLabel)}</span>
              <span class="card-date">${esc(card.date)}</span>
            </div>
            <h2 class="card-title">${esc(card.title)}</h2>
            <p class="card-excerpt">${esc(card.excerpt)}</p>
          </div>
          <span class="card-link">続きを読む &rarr;</span>
        </div>
      </a>`;
}

// ─── ページネーションHTML生成 ────────────────────────────────────────────────

function buildPaginationHtml(currentPage: number, totalPages: number): string {
  if (totalPages <= 1) return '';

  const items: string[] = [];

  // 「前へ」リンク
  if (currentPage > 1) {
    const prevUrl = currentPage === 2 ? './' : `../page/${currentPage - 1}/`;
    items.push(`<a href="${escAttr(prevUrl)}" class="prev-next">&laquo; 前へ</a>`);
  }

  // ページ番号
  for (let i = 1; i <= totalPages; i++) {
    if (i === currentPage) {
      items.push(`<span class="current">${i}</span>`);
    } else if (
      i === 1 ||
      i === totalPages ||
      Math.abs(i - currentPage) <= 2
    ) {
      const url = i === 1 ? './' : `../page/${i}/`;
      // page/2/ から page 1 への相対パスは ../../
      const resolvedUrl = currentPage === 1
        ? (i === 1 ? './' : `page/${i}/`)
        : (i === 1 ? '../../' : `../${i}/`);
      items.push(`<a href="${escAttr(resolvedUrl)}">${i}</a>`);
    } else if (
      items[items.length - 1] &&
      !items[items.length - 1].includes('dots')
    ) {
      items.push(`<span class="dots">...</span>`);
    }
  }

  // 「次へ」リンク
  if (currentPage < totalPages) {
    const nextUrl = currentPage === 1
      ? `page/${currentPage + 1}/`
      : `../${currentPage + 1}/`;
    items.push(`<a href="${escAttr(nextUrl)}" class="prev-next">次へ &raquo;</a>`);
  }

  return `
    <div class="pagination">
      ${items.join('\n      ')}
    </div>`;
}

// ─── サイドバーHTML生成 ──────────────────────────────────────────────────────

function buildSidebarHtml(data: HubPageData): string {
  // カテゴリ一覧
  const categoryItems = data.categories
    .map(
      (cat) =>
        `        <li><a href="#"><span>${esc(cat.name)}</span><span class="category-count">${cat.count}</span></a></li>`,
    )
    .join('\n');

  // 最新記事
  const recentItems = data.recentArticles
    .slice(0, 5)
    .map(
      (a) =>
        `        <li><a href="${escAttr(a.articleUrl)}">${esc(a.title)}<span class="recent-date">${esc(a.date)}</span></a></li>`,
    )
    .join('\n');

  return `
    <aside class="sidebar">
      <div class="sidebar-section">
        <h3>カテゴリ</h3>
        <ul class="category-list">
${categoryItems}
        </ul>
      </div>
      <div class="sidebar-section">
        <h3>最新記事</h3>
        <ul class="recent-list">
${recentItems}
        </ul>
      </div>
      <div class="sidebar-section">
        <h3>セッションのご案内</h3>
        <p style="font-size:13px; color:#666; margin-bottom:12px;">スピリチュアルカウンセリングで、あなたの魂の声に耳を傾けてみませんか？</p>
        <a href="${escAttr(BOOKING_URL)}" style="display:block; text-align:center; background:#8b6f5e; color:#fff; padding:12px; border-radius:25px; font-weight:bold; font-size:14px;">セッションを予約する</a>
      </div>
    </aside>`;
}

// ─── メイン生成関数 ──────────────────────────────────────────────────────────

/**
 * ハブページHTMLを生成する。
 */
export function generateHubPage(data: HubPageData): string {
  const year = new Date().getFullYear();

  // 記事カード
  const articleCardsHtml = data.articles
    .map((card) => buildArticleCardHtml(card))
    .join('\n');

  // ページネーション
  const paginationHtml = buildPaginationHtml(data.currentPage, data.totalPages);

  // サイドバー
  const sidebarHtml = buildSidebarHtml(data);

  const pageTitle =
    data.currentPage === 1
      ? `コラム一覧 | ${SITE_NAME}`
      : `コラム一覧 (${data.currentPage}ページ目) | ${SITE_NAME}`;

  const canonicalPath =
    data.currentPage === 1
      ? `${COLUMNS_BASE}/`
      : `${COLUMNS_BASE}/page/${data.currentPage}/`;

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${esc(pageTitle)}</title>
  <meta name="description" content="スピリチュアルカウンセラー小林由起子によるコラム一覧。ツインレイ・前世療法・チャクラヒーリングなど、魂の成長をサポートする情報をお届けします。"/>
  <link rel="canonical" href="${escAttr(canonicalPath)}"/>

  <!-- Google Analytics 4 -->
  ${buildGA4Tag()}

  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet"/>
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet"/>

  <meta property="og:title" content="${escAttr(pageTitle)}"/>
  <meta property="og:type" content="website"/>
  <meta property="og:url" content="${escAttr(canonicalPath)}"/>
  <meta property="og:site_name" content="${escAttr(SITE_NAME)}"/>
  <meta property="og:description" content="スピリチュアルカウンセラー小林由起子によるコラム一覧"/>

  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: pageTitle,
    url: canonicalPath,
    description: 'スピリチュアルカウンセラー小林由起子によるコラム一覧',
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL },
  })}</script>

  <style>${getHubCSS()}
  </style>
</head>
<body>
  <div id="sticky-nav">
    <div class="nav-inner">
      <a href="${escAttr(SITE_URL)}"><i class="fa-solid fa-home"></i> ホーム</a>
      <a href="${escAttr(COLUMNS_BASE)}/"><i class="fa-solid fa-book-open"></i> コラム一覧</a>
      <a href="${escAttr(BOOKING_URL)}"><i class="fa-solid fa-calendar-check"></i> セッション予約</a>
      <a href="${escAttr(BOOKING_URL)}"><i class="fa-solid fa-envelope"></i> 無料相談</a>
    </div>
  </div>

  <div class="hub-header">
    <h1>スピリチュアルコラム</h1>
    <p>魂の成長をサポートする ${data.articles.length > 0 ? `${data.currentPage}/${data.totalPages} ページ` : ''}</p>
  </div>

  <div class="hub-layout">
    <main>
      <div class="article-grid">
${articleCardsHtml}
      </div>
${paginationHtml}
    </main>

${sidebarHtml}
  </div>

  <footer>&copy; ${year} ${esc(SITE_NAME)}. All rights reserved.</footer>

  <div class="site-copyright">Copyright &copy; スピリチュアルハーモニー All Rights Reserved.</div>
</body>
</html>`;

  return html;
}

// ─── 全ページ一括生成 ────────────────────────────────────────────────────────

/**
 * 全ハブページを一括生成する。
 * page 1 → index.html
 * page 2+ → page/2/index.html, page/3/index.html ...
 */
export function generateAllHubPages(
  articles: HubArticleCard[],
  categories: { slug: string; name: string; count: number }[],
): { path: string; html: string }[] {
  const totalPages = Math.max(1, Math.ceil(articles.length / ARTICLES_PER_PAGE));
  const recentArticles = articles.slice(0, 5);
  const results: { path: string; html: string }[] = [];

  for (let page = 1; page <= totalPages; page++) {
    const start = (page - 1) * ARTICLES_PER_PAGE;
    const pageArticles = articles.slice(start, start + ARTICLES_PER_PAGE);

    const data: HubPageData = {
      articles: pageArticles,
      currentPage: page,
      totalPages,
      categories,
      recentArticles,
    };

    const html = generateHubPage(data);
    const path = page === 1 ? 'index.html' : `page/${page}/index.html`;
    results.push({ path, html });
  }

  return results;
}

// ─── Supabaseからデータ取得 ──────────────────────────────────────────────────

/**
 * Supabaseからpublished記事を取得し、HubArticleCard配列に変換する。
 */
export async function buildArticleCards(): Promise<HubArticleCard[]> {
  const supabase = await createServiceRoleClient();

  // P5-43 Step 2 (設計 §4.2): reviewed_at ベースから visibility_state ベースへ移行
  // ハブページに掲載するのは公開可視状態 (live / live_hub_stale) の記事のみ
  const baseQuery = supabase
    .from('articles')
    .select('id, title, slug, seo_filename, meta_description, stage2_body_html, stage3_final_html, theme, published_at, image_files')
    .eq('status', 'published');
  const { data, error } = await applyPubliclyVisibleFilter(baseQuery)
    .order('published_at', { ascending: false });

  if (error) {
    throw new Error(`buildArticleCards failed: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return [];
  }

  return data.map((row) => {
    const bodyHtml = (row.stage3_final_html || row.stage2_body_html || '') as string;
    const theme = (row.theme || 'introduction') as string;
    const slug = (row.slug || row.seo_filename || row.id) as string;
    const htmlFilename = (row.seo_filename || `${slug}.html`) as string;

    // サムネイルURL: image_filesの最初のファイル or デフォルト
    let thumbnailFilename = 'default-thumbnail.webp';
    const imageFiles = row.image_files as { filename: string }[] | null;
    if (imageFiles && Array.isArray(imageFiles) && imageFiles.length > 0) {
      thumbnailFilename = imageFiles[0].filename;
    }

    // 公開日をフォーマット
    const publishedAt = row.published_at as string | null;
    let dateStr = '';
    if (publishedAt) {
      const d = new Date(publishedAt);
      dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    }

    return {
      id: row.id as string,
      title: (row.title || '無題') as string,
      slug,
      excerpt: makeExcerpt(bodyHtml),
      date: dateStr,
      theme,
      categoryLabel: getThemeLabel(theme),
      thumbnailUrl: `/spiritual/column/${slug}/images/hero.jpg`,
      articleUrl: `/spiritual/column/${slug}/index.html`,
    };
  });
}

/**
 * 記事カードからカテゴリ集計を生成する。
 */
export function buildCategories(
  articles: HubArticleCard[],
): { slug: string; name: string; count: number }[] {
  const map = new Map<string, { slug: string; name: string; count: number }>();

  for (const article of articles) {
    const existing = map.get(article.theme);
    if (existing) {
      existing.count++;
    } else {
      map.set(article.theme, {
        slug: article.theme,
        name: article.categoryLabel,
        count: 1,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}
