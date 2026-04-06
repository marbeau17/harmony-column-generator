// ============================================================================
// src/lib/export/static-exporter.ts
// 公開記事を out/ ディレクトリに静的HTMLとしてエクスポートする
//
// - 個別記事: out/column/{slug}/index.html + images/
// - ハブページ: out/column/index.html
// ============================================================================

import fs from 'fs';
import path from 'path';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { generateArticleHtml } from '@/lib/generators/article-html-generator';
import {
  buildArticleCards,
  buildCategories,
  generateAllHubPages,
} from '@/lib/generators/hub-generator';
import { getStickyCtaBarCss, getStickyCtaBarHtml } from '@/lib/generators/sticky-cta-bar';
import type { Article } from '@/types/article';

// ─── 定数 ────────────────────────────────────────────────────────────────────

const OUT_DIR = path.join(process.cwd(), 'out');

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

// ─── 画像ダウンロード ────────────────────────────────────────────────────────

/**
 * 画像をSupabase StorageからローカルのOUTディレクトリにダウンロード
 */
async function downloadImage(url: string, destPath: string): Promise<boolean> {
  try {
    console.log(`  [download] ${url} -> ${destPath}`);
    const response = await fetch(url);
    if (!response.ok) {
      console.log(`  [download] Failed: HTTP ${response.status} for ${url}`);
      return false;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(destPath, buffer);
    console.log(`  [download] OK (${buffer.length} bytes)`);
    return true;
  } catch (error) {
    console.log(`  [download] Error: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

// ─── 単一記事エクスポート ────────────────────────────────────────────────────

/**
 * 単一記事を out/column/{slug}/ にエクスポート
 * - index.html を生成 (article-html-generator使用)
 * - images/ に hero/body/summary をダウンロード
 */
export async function exportArticleToOut(
  articleId: string,
): Promise<{ slug: string; files: string[] }> {
  console.log(`[exportArticle] Starting export for article: ${articleId}`);

  // 1. Fetch article from Supabase
  const supabase = await createServiceRoleClient();
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .eq('id', articleId)
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to fetch article ${articleId}: ${error?.message ?? 'not found'}`,
    );
  }

  const article = data as unknown as Article;
  const slug = article.slug ?? article.id;
  const articleDir = path.join(OUT_DIR, 'column', slug);
  const imagesDir = path.join(articleDir, 'images');
  const files: string[] = [];

  // 2. Create directories
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }
  console.log(`[exportArticle] Directories created: ${articleDir}`);

  // 3. Download images from image_files (JSONB array)
  if (article.image_files) {
    let imageFiles: { url: string; filename: string; alt?: string; position?: string }[];
    try {
      imageFiles =
        typeof article.image_files === 'string'
          ? JSON.parse(article.image_files)
          : (article.image_files as typeof imageFiles);
    } catch {
      imageFiles = [];
      console.log(`[exportArticle] Failed to parse image_files for ${slug}`);
    }

    if (Array.isArray(imageFiles)) {
      for (const img of imageFiles) {
        if (!img.url) continue;

        // Determine local filename: use position (hero/body/summary) or original filename
        const localFilename =
          img.position
            ? `${img.position}.jpg`
            : img.filename ?? 'image.jpg';
        const destPath = path.join(imagesDir, localFilename);

        const ok = await downloadImage(img.url, destPath);
        if (ok) {
          files.push(path.relative(OUT_DIR, destPath));
        }
      }
    }
  }

  // 4. Generate article HTML
  const heroImagePath = 'images/hero.jpg';
  let html = generateArticleHtml(article, {
    heroImage: heroImagePath,
    heroImageAlt: article.title ?? slug,
    ogImage: `https://harmony-mc.com/column/${slug}/images/hero.jpg`,
    hubUrl: '../index.html',
  });

  // 5. Post-process HTML: rewrite paths for static export
  // Rewrite Supabase image URLs to local relative paths
  html = html.replace(
    /https:\/\/khsorerqojgwbmtiqrac\.supabase\.co\/storage\/v1\/object\/public\/article-images\/articles\/[^"]+\/(hero|body|summary)\.jpg/g,
    './images/$1.jpg'
  );
  // Fix CSS path
  html = html.replace('href="./css/hub.css"', 'href="../../css/style.css"');
  // Fix JS path
  html = html.replace('src="./js/hub.js"', 'src="../../js/hub.js"');
  // Fix related article links: /column/slug/ → ../slug/index.html
  html = html.replace(/href="\/column\/([^"]+)\/"/g, 'href="../$1/index.html"');
  // Fix related article thumbnails: /column/slug/images/ → ../slug/images/
  html = html.replace(/src="\/column\/([^"]+)\/images\//g, 'src="../$1/images/');
  // Remove duplicate hero image from body HTML (template already shows it)
  html = html.replace(/<img[^>]*src="\.\/images\/hero\.(jpg|svg)"[^>]*style="max-width:100%[^"]*"[^>]*>/g, '');
  // Also remove IMAGE comments
  html = html.replace(/<!--IMAGE:hero:[^>]*-->/g, '');

  // 6. Write HTML to out/column/{slug}/index.html
  const htmlPath = path.join(articleDir, 'index.html');
  fs.writeFileSync(htmlPath, html, 'utf-8');
  files.push(path.relative(OUT_DIR, htmlPath));

  console.log(`[exportArticle] Done: ${slug} (${files.length} files)`);
  return { slug, files };
}

// ─── ハブページエクスポート ──────────────────────────────────────────────────

/**
 * ハブページ(out/column/index.html)を再生成
 * - サムネイル画像付きカード
 */
export async function exportHubPageToOut(): Promise<{ files: string[] }> {
  console.log('[exportHub] Starting hub page generation...');

  // 1. Fetch all published articles
  const supabase = await createServiceRoleClient();
  const { data, error } = await supabase
    .from('articles')
    .select(
      'id, title, slug, meta_description, stage2_body_html, stage3_final_html, theme, published_at, image_files',
    )
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch published articles: ${error.message}`);
  }

  const articles = data ?? [];
  console.log(`[exportHub] Found ${articles.length} published articles`);

  if (articles.length === 0) {
    // Write an empty hub page
    const emptyHtml = buildEmptyHubHtml();
    const outPath = path.join(OUT_DIR, 'column', 'index.html');
    if (!fs.existsSync(path.dirname(outPath))) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
    }
    fs.writeFileSync(outPath, emptyHtml, 'utf-8');
    console.log('[exportHub] No articles found. Wrote empty hub page.');
    return { files: ['column/index.html'] };
  }

  // 2. Build article cards with local thumbnail paths
  const cards = articles.map((row) => {
    const slug = (row.slug || row.id) as string;
    const theme = (row.theme || 'spiritual_intro') as string;
    const bodyHtml = ((row.stage3_final_html || row.stage2_body_html || '') as string);

    // Hero image alt from image_files
    let heroAlt = (row.title || 'コラム記事') as string;
    const imageFiles = row.image_files as { alt?: string; position?: string }[] | null;
    if (imageFiles && Array.isArray(imageFiles)) {
      const heroFile = imageFiles.find((f) => f.position === 'hero') ?? imageFiles[0];
      if (heroFile?.alt) heroAlt = heroFile.alt;
    }

    // Published date
    const publishedAt = row.published_at as string | null;
    let dateStr = '';
    if (publishedAt) {
      const d = new Date(publishedAt);
      dateStr = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    }

    // Excerpt from body HTML
    const plainText = bodyHtml.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    const excerpt =
      plainText.length > 120 ? plainText.slice(0, 117) + '...' : plainText;

    return {
      slug,
      title: (row.title || '無題') as string,
      theme,
      categoryLabel: THEME_LABELS[theme] ?? theme,
      date: dateStr,
      excerpt,
      heroAlt,
      metaDescription: (row.meta_description || excerpt) as string,
    };
  });

  // 3. Generate hub HTML with local image paths
  const hubHtml = buildHubHtml(cards);

  // 4. Write to out/column/index.html
  const outPath = path.join(OUT_DIR, 'column', 'index.html');
  if (!fs.existsSync(path.dirname(outPath))) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
  }
  fs.writeFileSync(outPath, hubHtml, 'utf-8');

  const files = ['column/index.html'];
  console.log(`[exportHub] Done: ${files.length} file(s) written`);
  return { files };
}

// ─── 全記事エクスポート ─────────────────────────────────────────────────────

/**
 * 全公開記事をエクスポート + ハブページ再生成
 */
export async function exportAllToOut(): Promise<{
  articles: number;
  files: string[];
}> {
  console.log('[exportAll] Starting full export...');

  // 1. Fetch all published article IDs
  const supabase = await createServiceRoleClient();
  const { data, error } = await supabase
    .from('articles')
    .select('id')
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch published articles: ${error.message}`);
  }

  const articleIds = (data ?? []).map((row) => row.id as string);
  console.log(`[exportAll] Found ${articleIds.length} published articles`);

  const allFiles: string[] = [];

  // 2. Export each article
  for (const articleId of articleIds) {
    try {
      const result = await exportArticleToOut(articleId);
      allFiles.push(...result.files);
    } catch (err) {
      console.log(
        `[exportAll] Error exporting article ${articleId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // 3. Regenerate hub page
  try {
    const hubResult = await exportHubPageToOut();
    allFiles.push(...hubResult.files);
  } catch (err) {
    console.log(
      `[exportAll] Error generating hub page: ${err instanceof Error ? err.message : err}`,
    );
  }

  console.log(
    `[exportAll] Complete: ${articleIds.length} articles, ${allFiles.length} total files`,
  );
  return { articles: articleIds.length, files: allFiles };
}

// ─── ハブページHTML生成（ローカルパス版） ────────────────────────────────────

interface HubCard {
  slug: string;
  title: string;
  theme: string;
  categoryLabel: string;
  date: string;
  excerpt: string;
  heroAlt: string;
  metaDescription: string;
}

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

function buildHubHtml(cards: HubCard[]): string {
  const year = new Date().getFullYear();

  const cardListHtml = cards
    .map(
      (card) => `
    <a href="./${escAttr(card.slug)}/index.html" class="article-card">
      <div class="card-thumb">
        <img src="./${escAttr(card.slug)}/images/hero.jpg" alt="${escAttr(card.heroAlt)}" loading="lazy">
      </div>
      <div class="card-body">
        <h2>${escHtml(card.title)}</h2>
        <div class="card-meta">
          <span class="badge">${escHtml(card.categoryLabel)}</span>
          <span class="card-date">${escHtml(card.date)}</span>
        </div>
        <p class="card-excerpt">${escHtml(card.excerpt)}</p>
      </div>
    </a>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>魂の気づきコラム｜今を生きるヒント | Harmony スピリチュアルコラム</title>
  <meta name="description" content="スピリチュアルカウンセラー小林由起子によるコラム一覧。魂の成長、ヒーリング、人間関係など、スピリチュアルな視点からの気づきをお届けします。">
  <link rel="stylesheet" href="../css/style.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&display=swap" rel="stylesheet">
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-TH2XJ24V3T"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-TH2XJ24V3T');
  </script>
  <style>
    :root {
      --color-primary: #b39578;
      --color-dark: #53352b;
      --color-gold: #d4a574;
      --color-bg: #faf3ed;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background-color: var(--color-bg);
      font-family: 'Noto Sans JP', sans-serif;
      color: #333;
      line-height: 1.8;
      padding-bottom: 72px;
    }
    a { text-decoration: none; color: inherit; }

    /* Header */
    .page-header {
      text-align: center;
      padding: 64px 16px 48px;
    }
    .page-header h1 {
      font-size: 2rem;
      font-weight: 700;
      color: var(--color-dark);
      letter-spacing: 0.08em;
      margin-bottom: 12px;
    }
    .page-header p {
      font-size: 0.95rem;
      color: #7a6a5e;
      max-width: 560px;
      margin: 0 auto;
    }

    /* Grid */
    .article-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;
      max-width: 1152px;
      margin: 0 auto;
      padding: 0 16px 64px;
    }
    @media (min-width: 640px) {
      .article-grid { grid-template-columns: repeat(2, 1fr); }
    }
    @media (min-width: 1024px) {
      .article-grid { grid-template-columns: repeat(3, 1fr); }
    }

    /* Card */
    .article-card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
      overflow: hidden;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      display: flex;
      flex-direction: column;
    }
    .article-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 24px rgba(83,53,43,0.10);
    }
    .card-body {
      padding: 20px 20px 24px;
      flex: 1;
      display: flex;
      flex-direction: column;
    }
    .card-body h2 {
      font-size: 1.05rem;
      font-weight: 500;
      color: var(--color-dark);
      line-height: 1.6;
      margin-bottom: 10px;
    }
    .card-meta {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }
    .badge {
      display: inline-block;
      font-size: 0.72rem;
      font-weight: 500;
      padding: 2px 10px;
      border-radius: 99px;
      background: var(--color-bg);
      color: var(--color-primary);
      border: 1px solid var(--color-primary);
    }
    .card-date {
      font-size: 0.78rem;
      color: #a09080;
    }
    .card-excerpt {
      font-size: 0.88rem;
      color: #6b5e54;
      line-height: 1.7;
      margin-top: auto;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    /* Card Thumbnail */
    .card-thumb {
      aspect-ratio: 16 / 9;
      overflow: hidden;
    }
    .card-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 0.3s ease;
    }
    .article-card:hover .card-thumb img {
      transform: scale(1.05);
    }

    /* Footer */
    .site-footer {
      text-align: center;
      padding: 32px 16px;
      border-top: 1px solid #e8ddd4;
      font-size: 0.8rem;
      color: #a09080;
    }
    ${getStickyCtaBarCss()}
  </style>
</head>
<body>

  <header class="page-header">
    <p style="margin-bottom:12px"><a href="https://harmony-mc.com/" style="color:#b39578;font-size:.85rem;text-decoration:none">← ホームへ戻る</a></p>
    <h1>魂の気づきコラム</h1>
    <p class="page-subtitle">「今を生きるヒント」</p>
    <p>スピリチュアルカウンセラー小林由起子が、魂の成長やヒーリング、人間関係など日々の気づきを綴るコラムです。あなたの心に寄り添うメッセージをお届けします。</p>
  </header>

  <main class="article-grid">
${cardListHtml}
  </main>

  <footer class="site-footer">
    <p>Copyright &copy; ${year} スピリチュアルハーモニー All Rights Reserved.</p>
  </footer>

  ${getStickyCtaBarHtml()}
</body>
</html>`;
}

function buildEmptyHubHtml(): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>魂の気づきコラム｜今を生きるヒント | Harmony スピリチュアルコラム</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&display=swap" rel="stylesheet">
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-TH2XJ24V3T"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-TH2XJ24V3T');
  </script>
  <style>
    body { background: #faf3ed; font-family: 'Noto Sans JP', sans-serif; color: #333; text-align: center; padding: 80px 16px 72px; }
    h1 { font-size: 2rem; color: #53352b; margin-bottom: 16px; }
    p { color: #7a6a5e; }
    ${getStickyCtaBarCss()}
  </style>
</head>
<body>
  <h1>魂の気づきコラム</h1>
  <p>「今を生きるヒント」</p>
  <p>公開済みの記事はまだありません。</p>
  <footer style="margin-top:64px; font-size:0.8rem; color:#a09080;">
    <p>Copyright &copy; ${year} スピリチュアルハーモニー All Rights Reserved.</p>
  </footer>
  ${getStickyCtaBarHtml()}
</body>
</html>`;
}
