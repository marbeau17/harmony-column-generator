// ============================================================================
// src/lib/generators/html-generator.ts
// 静的HTML生成 — スピリチュアルコラム向けHTMLテンプレート
//
// 記事データ（本文HTML, メタ情報, 画像）を完全準拠のHTML文字列に変換。
// カラースキーム: #b39578(ウォームブラウン), #53352b(ダークブラウン)
// ============================================================================

// ─── 入力型 ─────────────────────────────────────────────────────────────────

export interface HtmlGeneratorInput {
  article: {
    title: string;
    metaDescription: string;
    bodyHtml: string;            // stage3_final_html or stage2_body_html
    headings: { id: string; text: string }[];
    thumbnailFilename: string;   // e.g. spiritual-healing-hero.webp
    htmlFilename: string;        // e.g. twinray-stage-guide.html
    keywords?: string;           // e.g. "ツインレイ,スピリチュアル,浄化"
    imageFiles?: { filename: string }[]; // 実際にアップロードされた画像ファイル一覧
    relatedArticles: { href: string; title: string }[];
    ctaHeadline: string;
    ctaBody: string;
    /** 公開日 ISO形式 (例: "2026-04-01") */
    publishedAt?: string;
    /** FAQ構造化データ用 */
    faq?: { question: string; answer: string }[];
  };
}

// ─── ヘルパー ───────────────────────────────────────────────────────────────

/** HTML特殊文字エスケープ */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** HTML属性値エスケープ */
function escAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── サイト定数 ─────────────────────────────────────────────────────────────

const SITE_NAME = 'Harmonyスピリチュアルコラム';
const SITE_URL = 'https://harmony-spiritual.com';
const BOOKING_URL = 'https://harmony-booking.web.app/';

const COUNSELOR = {
  name: '小林由起子',
  title: 'スピリチュアルカウンセラー',
  description:
    '20年以上のスピリチュアルカウンセリング経験を持つ。ツインレイ・前世療法・チャクラヒーリングを専門とし、多くの方の魂の成長をサポート。グリーフケアにも力を入れ、悲しみを抱える方々に寄り添うセッションを提供している。',
  url: BOOKING_URL,
};

// ─── 目次生成 ───────────────────────────────────────────────────────────────

function buildToc(headings: { id: string; text: string }[]): string {
  if (!headings.length) return '';
  const items = headings
    .map(
      (h, i) =>
        `        <li><a href="#section-${i + 1}">${esc(h.text)}</a></li>`,
    )
    .join('\n');
  return `
    <div class="toc-box">
      <div class="toc-title" id="toc-toggle">目次</div>
      <ul class="toc-list" id="toc-content">
${items}
      </ul>
    </div>`;
}

// ─── 関連記事セクション ─────────────────────────────────────────────────────

function buildRelatedArticles(
  articles: { href: string; title: string }[],
): string {
  if (!articles.length) return '';
  const items = articles
    .map(
      (a) =>
        `        <li><a href="${escAttr(a.href)}">${esc(a.title)}</a></li>`,
    )
    .join('\n');
  return `
    <div class="related-articles">
      <h3>あわせて読みたい関連コラム</h3>
      <ul class="related-list">
${items}
      </ul>
    </div>`;
}

// ─── CTAセクション（harmony-cta） ──────────────────────────────────────────

function buildCtaSection(article: HtmlGeneratorInput['article']): string {
  return `
    <div class="harmony-cta">
      <h3>${esc(article.ctaHeadline)}</h3>
      <p>${esc(article.ctaBody)}</p>
      <div class="cta-buttons">
        <a class="cta-btn reserve" href="${escAttr(BOOKING_URL)}">セッションを予約する</a>
        <a class="cta-btn" href="${escAttr(BOOKING_URL)}">無料相談はこちら</a>
      </div>
    </div>`;
}

// ─── カウンセラープロフィールカード ──────────────────────────────────────────

function buildCounselorCard(): string {
  return `
  <div class="container" style="margin-top:40px; display: flex; flex-direction: column; align-items: center;">
    <div class="counselor-card">
      <h3>${esc(COUNSELOR.name)}</h3>
      <p class="counselor-title">${esc(COUNSELOR.title)}</p>
      <div class="counselor-details">
        <div class="counselor-text">
          <p class="counselor-description">${esc(COUNSELOR.description)}</p>
          <div class="counselor-links">
            <a class="counselor-link-item" href="${escAttr(BOOKING_URL)}" target="_blank">セッション予約</a>
            <a class="counselor-link-item" href="${escAttr(BOOKING_URL)}" target="_blank">無料相談</a>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

// ─── 免責事項 ───────────────────────────────────────────────────────────────

function buildDisclaimer(): string {
  return `
  <div class="disclaimer-box">
    <strong>免責事項：</strong><br/>
    本コラムの内容はスピリチュアルカウンセラーの経験と知見に基づく情報提供を目的としており、医学的・科学的根拠に基づくものではありません。心身の不調がある場合は、必ず医療専門家にご相談ください。スピリチュアルカウンセリングは医療行為ではなく、効果には個人差があります。本コラムの情報を参考にした判断や行動について、当方は一切の責任を負いかねます。また、掲載画像はイメージであり、実際のセッション内容とは異なる場合があります。
  </div>`;
}

// ─── 構造化データ (JSON-LD) ────────────────────────────────────────────────

function buildStructuredData(article: HtmlGeneratorInput['article']): string {
  const publishedAt = article.publishedAt || new Date().toISOString().split('T')[0];
  const baseUrl = `${SITE_URL}/columns`;

  // Article
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.metaDescription,
    image: `${baseUrl}/placeholders/${article.thumbnailFilename}`,
    author: {
      '@type': 'Person',
      name: COUNSELOR.name,
      jobTitle: COUNSELOR.title,
      url: COUNSELOR.url,
    },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: SITE_URL,
    },
    datePublished: publishedAt,
    dateModified: publishedAt,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${baseUrl}/${article.htmlFilename}`,
    },
  };

  // Person
  const personSchema = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: COUNSELOR.name,
    jobTitle: COUNSELOR.title,
    description: COUNSELOR.description,
    url: COUNSELOR.url,
  };

  // BreadcrumbList
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'ホーム',
        item: SITE_URL,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'コラム一覧',
        item: `${baseUrl}/`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: article.title,
        item: `${baseUrl}/${article.htmlFilename}`,
      },
    ],
  };

  let scripts = `
  <script type="application/ld+json">${JSON.stringify(articleSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(personSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(breadcrumbSchema)}</script>`;

  // FAQPage (optional)
  if (article.faq && article.faq.length > 0) {
    const faqSchema = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: article.faq.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      })),
    };
    scripts += `\n  <script type="application/ld+json">${JSON.stringify(faqSchema)}</script>`;
  }

  return scripts;
}

// ─── OGPメタタグ ────────────────────────────────────────────────────────────

function buildOgpMeta(article: HtmlGeneratorInput['article']): string {
  const baseUrl = `${SITE_URL}/columns`;
  return `
  <meta property="og:title" content="${escAttr(article.title)}"/>
  <meta property="og:type" content="article"/>
  <meta property="og:url" content="${baseUrl}/${escAttr(article.htmlFilename)}"/>
  <meta property="og:image" content="${baseUrl}/placeholders/${escAttr(article.thumbnailFilename)}"/>
  <meta property="og:description" content="${escAttr(article.metaDescription)}"/>
  <meta property="og:site_name" content="${escAttr(SITE_NAME)}"/>
  <meta property="article:author" content="${escAttr(COUNSELOR.name)}"/>
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="${escAttr(article.title)}"/>
  <meta name="twitter:description" content="${escAttr(article.metaDescription)}"/>
  <meta name="twitter:image" content="${baseUrl}/placeholders/${escAttr(article.thumbnailFilename)}"/>`;
}

// ─── CSS（スピリチュアルコラム用） ─────────────────────────────────────────

export function getTemplateCSS(): string {
  return `
    * { box-sizing: border-box !important; }
    body { font-family: 'Noto Sans JP', sans-serif; line-height: 1.8; color: #333; background-color: #faf8f5; letter-spacing: 0.05em; margin: 0; padding: 0; padding-top: 70px; overflow-x: hidden; }
    .container { max-width: 1000px; margin: 40px auto !important; margin-left: auto !important; margin-right: auto !important; padding: 40px 20px; background: #fff; box-sizing: border-box; border-radius: 12px; box-shadow: 0 2px 12px rgba(83,53,43,0.06); }
    h1, h2 { background-color: #f5ebe0; border-bottom: none; padding: 15px 20px; font-size: 24px; font-weight: bold; margin-bottom: 30px; color: #53352b; margin-left: -20px; margin-right: -20px; border-left: 4px solid #b39578; }
    h1 { font-size: 28px; }
    h3 { font-size: 1.1em; padding: 10px 0; margin-top: 25px; border-bottom: 2px solid #e8d5c4; color: #53352b; }
    p { margin-bottom: 1em; }
    img { max-width: 100%; height: auto; }
    a img { transition: opacity 0.3s; cursor: pointer; }
    a img:hover { opacity: 0.8; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; border: 1px solid #ddd; }
    th, td { padding: 10px 12px; border: 1px solid #ddd; text-align: left; }
    th { background-color: #f5ebe0; font-weight: 700; color: #53352b; }
    .es-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .es-table th { background-color: #b39578; color: #fff; padding: 12px; font-weight: 700; border: 1px solid #ddd; }
    .es-table td { padding: 10px 12px; border: 1px solid #ddd; }
    #sticky-nav { position: fixed; top: 0; left: 0; width: 100%; height: 50px; background: linear-gradient(135deg, #53352b, #b39578); box-shadow: 0 2px 5px rgba(83,53,43,0.15); z-index: 9999; display: flex; justify-content: center; align-items: center; }
    .nav-inner { width: 100%; max-width: 1000px; display: flex; justify-content: space-around; align-items: center; padding: 0 10px; }
    #sticky-nav a { text-decoration: none; font-weight: bold; color: #fff; font-size: 13px; padding: 6px 15px; border-radius: 20px; transition: all 0.3s; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
    #sticky-nav a:hover { background: #fff; color: #53352b; }
    .toc-box { background: #faf3ed; border: 1px solid #e8d5c4; border-radius: 8px; padding: 15px 20px; margin: 25px 0; }
    .toc-title { font-weight: 700; cursor: pointer; user-select: none; margin-bottom: 10px; color: #53352b; }
    .toc-title::after { content: ' [開く]'; font-size: 0.8em; margin-left: 5px; color: #b39578; }
    .toc-title.active::after { content: ' [閉じる]'; }
    .toc-list { list-style: none; counter-reset: toc-counter; padding-left: 0; margin-top: 10px; }
    .toc-list.hidden { display: none; }
    .toc-list li { position: relative; padding-left: 2.5em; margin-bottom: 0.8em; }
    .toc-list li::before { content: counter(toc-counter); counter-increment: toc-counter; position: absolute; left: 0; top: 0; width: 24px; height: 24px; background: #b39578; color: #fff; border-radius: 50%; text-align: center; line-height: 24px; font-size: 14px; font-weight: bold; }
    .toc-list li a { color: #53352b; text-decoration: none; border-bottom: 1px dashed #b39578; }
    .placeholder-container { text-align: center; margin: 20px 0; }
    .placeholder-container img { max-width: 100%; height: auto; border-radius: 8px; }
    .marker-yellow, .marker-pink { background: linear-gradient(transparent 60%, #f5ebe0 60%); font-weight: bold; padding: 0 2px; }
    .text-red-bold { color: #b39578; font-weight: bold; }
    .highlight { background-color: #faf3ed; color: #53352b; font-weight: bold; padding: 2px 4px; border-radius: 3px; }
    .note { background: #faf3ed; border-left: 4px solid #b39578; padding: 12px 16px; margin: 15px 0; font-size: 0.9em; }
    .mid-cta-wrapper { text-align: center; margin: 30px 0; padding: 20px; background: linear-gradient(135deg, #f5ebe0, #faf3ed); border-radius: 12px; }
    .mid-cta-catch { font-size: 1.1em; font-weight: bold; color: #53352b; margin-bottom: 12px; }
    .mid-cta-btn { display: inline-block; padding: 14px 30px; background: #b39578; color: #fff; font-weight: bold; text-decoration: none; border-radius: 25px; transition: opacity 0.3s; }
    .mid-cta-btn:hover { opacity: 0.8; }
    .qa-box { background: #faf3ed; border: 1px solid #e8d5c4; border-radius: 8px; padding: 20px; margin: 15px 0; }
    .qa-q { font-weight: bold; color: #53352b; margin-bottom: 8px; font-size: 1.05em; }
    .qa-a { color: #333; line-height: 1.8; }
    .related-articles { background: #faf3ed; border-radius: 8px; padding: 20px; margin: 30px 0; }
    .related-articles h3 { border-bottom: none; margin-top: 0; background: none; border-left: none; }
    .related-list { list-style: none; padding: 0; }
    .related-list li { padding: 6px 0; }
    .related-list li a { color: #b39578; text-decoration: none; }
    .related-list li a:hover { text-decoration: underline; color: #53352b; }
    .harmony-cta { background: linear-gradient(135deg, #f5ebe0, #faf3ed); padding: 30px; text-align: center; margin-top: 40px; border-radius: 12px; border: 2px solid #b39578; box-shadow: 0 2px 10px rgba(83,53,43,0.08); }
    .harmony-cta h3 { color: #53352b; border-bottom: none; font-size: 22px; margin-bottom: 15px; background: none; border-left: none; }
    .cta-buttons { display: flex; flex-wrap: wrap; justify-content: center; gap: 15px; margin-top: 20px; }
    .cta-btn { display: inline-block; padding: 14px 30px; border-radius: 25px; text-decoration: none; font-weight: bold; color: #fff; background: #b39578; transition: all 0.3s; box-shadow: 0 2px 8px rgba(179,149,120,0.3); }
    .cta-btn:hover { opacity: 0.85; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(179,149,120,0.4); }
    .cta-btn.reserve { background: #53352b; }
    .counselor-card { width: 100%; max-width: 100%; background-color: #fff; border: 1px solid #e8d5c4; padding: 0; margin-top: 60px; border-radius: 12px; box-shadow: 0 4px 15px rgba(83,53,43,0.08); overflow: hidden; box-sizing: border-box; }
    .counselor-card h3 { background: linear-gradient(135deg, #53352b, #b39578); border-bottom: none; font-size: 20px; color: #fff; text-align: center; padding: 15px; margin: 0; border-left: none; }
    .counselor-title { text-align: center; color: #b39578; font-weight: bold; margin: 15px 0 5px; }
    .counselor-details { width: 100%; padding: 30px; box-sizing: border-box; }
    .counselor-text { min-width: 300px; }
    .counselor-text p { margin-bottom: 8px; }
    .counselor-description { background: #faf3ed; padding: 15px; border-radius: 6px; font-size: 0.95em; color: #555; margin: 15px 0; line-height: 1.8; }
    .counselor-links { display: flex; gap: 10px; margin-top: 15px; flex-wrap: wrap; justify-content: center; }
    .counselor-link-item { background: #b39578; color: #fff; padding: 10px 20px; border-radius: 25px; text-decoration: none; font-size: 0.9em; font-weight: bold; transition: all 0.3s; white-space: nowrap; }
    .counselor-link-item:hover { opacity: 0.85; transform: translateY(-1px); }
    .disclaimer-box { max-width: 1000px; width: calc(100% - 40px); margin: 40px auto; background-color: #faf3ed; border: 1px solid #e8d5c4; padding: 20px; font-size: 0.85em; color: #666; border-radius: 8px; line-height: 1.6; box-sizing: border-box; }
    footer { text-align: center; padding: 20px 0; color: #888; font-size: 12px; border-top: 1px solid #e8d5c4; margin-top: 40px; }
    #back-to-top { position: fixed; bottom: 30px; right: 20px; width: 50px; height: 50px; border-radius: 50%; background: #b39578; color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: 0; visibility: hidden; transition: 0.3s; z-index: 9999; box-shadow: 0 4px 10px rgba(83,53,43,0.2); border: none; }
    #back-to-top.show { opacity: 1; visibility: visible; }
    #floating-top-btn { position: fixed; bottom: 25px; left: 20px; width: 60px; height: 60px; background-color: #53352b; color: #fff; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-decoration: none; font-size: 10px; font-weight: bold; box-shadow: 0 4px 10px rgba(83,53,43,0.3); z-index: 10000; opacity: 0; visibility: hidden; transition: all 0.4s ease; cursor: pointer; border: none; }
    #floating-top-btn.show { opacity: 1; visibility: visible; }
    #floating-top-btn:hover { background-color: #b39578; transform: scale(1.1); }
    #floating-top-btn i { font-size: 18px; margin-bottom: 2px; }
    @media (max-width: 600px) {
      body { padding-top: 50px; }
      #sticky-nav a { font-size: 10px; padding: 6px 4px; }
      .nav-inner { padding: 0 2px; }
      h1, h2 { margin-left: -15px; margin-right: -15px; padding-left: 15px; padding-right: 15px; }
      .container { padding: 15px; width: auto !important; }
      .cta-buttons { flex-direction: column; align-items: stretch; }
    }`;
}

// ─── 本文内 <!--IMAGE:...--> プレースホルダー解決 ────────────────────────────

function resolveBodyImagePlaceholders(
  bodyHtml: string,
  imageFiles?: { filename: string }[],
  excludeFilenames?: string[],
): string {
  const images = imageFiles || [];
  const exactMap = new Map<string, string>();
  const entries: { words: string[]; filename: string }[] = [];
  const usedFiles = new Set<string>(excludeFilenames || []);

  for (const img of images) {
    exactMap.set(img.filename, img.filename);
    const base = img.filename.replace(/\.webp$/i, '');
    exactMap.set(base, img.filename);
    entries.push({
      words: base.split(/[-_]/).filter((w) => w.length > 2),
      filename: img.filename,
    });
  }

  return bodyHtml.replace(
    /(?:<div\s+class="placeholder-container"[^>]*>\s*)?<!--IMAGE:([^>]+)-->(?:\s*<\/div>)?/g,
    (_, id: string) => {
      const parts = id.split(':');
      const name = parts[parts.length - 1] || id;

      // 1. 完全一致
      let resolved = exactMap.get(name) || exactMap.get(name + '.webp');
      if (resolved && usedFiles.has(resolved)) {
        resolved = undefined;
      }

      // 2. ファジーマッチ
      if (!resolved && entries.length > 0) {
        const qWords = name.split(/[-_]/).filter((w) => w.length > 2);
        let best = 0;
        for (const e of entries) {
          if (usedFiles.has(e.filename)) continue;
          const score = qWords.filter((qw) =>
            e.words.some((ew) => ew.includes(qw) || qw.includes(ew)),
          ).length;
          if (score > best) {
            best = score;
            resolved = e.filename;
          }
        }
        if (best === 0) resolved = undefined;
      }

      // 3. 未使用画像をフォールバック
      if (!resolved) {
        const unused = entries.find((e) => !usedFiles.has(e.filename));
        if (unused) resolved = unused.filename;
      }

      if (resolved) {
        usedFiles.add(resolved);
        return `<div class="placeholder-container"><img alt="${escAttr(name)}" src="placeholders/${escAttr(resolved)}"/></div>`;
      }

      return `<div class="placeholder-container" style="min-height:200px;background:#f5ebe0;border-radius:8px;"></div>`;
    },
  );
}

// ─── メイン生成関数 ─────────────────────────────────────────────────────────

export function generateArticleHtml(input: HtmlGeneratorInput): string {
  const { article } = input;
  const year = new Date().getFullYear();
  const baseUrl = `${SITE_URL}/columns`;

  // 画像URL（3枚: hero 1200x630, body 800x450, summary 800x450）
  // hero = thumbnailFilename, body & summary は imageFiles から解決

  const resolvedBody = resolveBodyImagePlaceholders(
    article.bodyHtml,
    article.imageFiles,
    [article.thumbnailFilename],
  );

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8"/>
  <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
  <title>${esc(article.title)} | ${esc(SITE_NAME)}</title>
  <meta content="${escAttr(article.metaDescription)}" name="description"/>
  ${article.keywords ? `<meta content="${escAttr(article.keywords)}" name="keywords"/>` : ''}
  <link href="${baseUrl}/${escAttr(article.htmlFilename)}" rel="canonical"/>

  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet"/>
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet"/>

${buildOgpMeta(article)}

${buildStructuredData(article)}

  <style>${getTemplateCSS()}
  </style>
</head>
<body>
  <div id="sticky-nav">
    <div class="nav-inner">
      <a href="${escAttr(SITE_URL)}"><i class="fa-solid fa-home"></i> ホーム</a>
      <a href="${baseUrl}/"><i class="fa-solid fa-book-open"></i> コラム一覧</a>
      <a href="${escAttr(BOOKING_URL)}"><i class="fa-solid fa-calendar-check"></i> セッション予約</a>
      <a href="${escAttr(BOOKING_URL)}"><i class="fa-solid fa-envelope"></i> 無料相談</a>
    </div>
  </div>

  <div class="container">
    <h1>${esc(article.title)}</h1>

    <div class="placeholder-container">
      <img alt="${escAttr(article.title)}" src="placeholders/${escAttr(article.thumbnailFilename)}" width="1200" height="630"/>
    </div>

${buildToc(article.headings)}

    ${resolvedBody}

${buildRelatedArticles(article.relatedArticles)}

${buildCtaSection(article)}
  </div>

${buildCounselorCard()}

${buildDisclaimer()}

  <footer>&copy; ${year} ${esc(SITE_NAME)}. All rights reserved.</footer>

  <div id="back-to-top"><i class="fas fa-chevron-up"></i></div>
  <button id="floating-top-btn" onclick="scrollToTop()"><i class="fas fa-chevron-up"></i><span>TOP</span></button>

  <script>
    // TOC Toggle
    const t = document.getElementById('toc-toggle');
    const c = document.getElementById('toc-content');
    if (t && c) {
      t.addEventListener('click', function() {
        t.classList.toggle('active');
        c.classList.toggle('hidden');
      });
    }
    // Back to Top
    const backBtn = document.getElementById('back-to-top');
    if (backBtn) {
      window.addEventListener('scroll', function() {
        if (window.scrollY > 300) { backBtn.classList.add('show'); } else { backBtn.classList.remove('show'); }
      });
      backBtn.addEventListener('click', function() { window.scrollTo({ top: 0, behavior: 'smooth' }); });
    }
    // Floating TOP button
    window.addEventListener('scroll', function() {
      const fbtn = document.getElementById('floating-top-btn');
      if (fbtn) {
        if (window.scrollY > 300) { fbtn.classList.add('show'); } else { fbtn.classList.remove('show'); }
      }
    });
    function scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }
  </script>
</body>
</html>`;

  return html;
}
