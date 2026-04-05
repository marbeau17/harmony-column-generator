// POST /api/export/article
// Body: { articleId?: string } - if omitted, export all published articles
// Returns a ZIP file as a downloadable response (works on Vercel and locally)

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { generateArticleHtml } from '@/lib/generators/article-html-generator';
import { logger } from '@/lib/logger';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import fs from 'fs';
import path from 'path';
import type { Article } from '@/types/article';

export const maxDuration = 120;

// ─── Theme labels (same as static-exporter) ─────────────────────────────────

const THEME_LABELS: Record<string, string> = {
  soul_mission: '魂の使命',
  relationships: '人間関係',
  grief_care: 'グリーフケア',
  self_growth: '自己成長',
  healing: 'ヒーリング',
  daily_awareness: '日常の気づき',
  spiritual_intro: 'スピリチュアル入門',
};

// ─── HTML escape helpers ─────────────────────────────────────────────────────

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

// ─── POST handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { articleId } = body;
    const serviceClient = await createServiceRoleClient();

    // Fetch articles
    let articles: Article[];
    if (articleId) {
      const { data, error } = await serviceClient
        .from('articles')
        .select('*')
        .eq('id', articleId)
        .single();
      if (error || !data) {
        return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 });
      }
      articles = [data as unknown as Article];
    } else {
      const { data, error } = await serviceClient
        .from('articles')
        .select('*')
        .eq('status', 'published')
        .order('published_at', { ascending: false });
      if (error) {
        return NextResponse.json({ error: '記事の取得に失敗しました' }, { status: 500 });
      }
      articles = (data || []) as unknown as Article[];
    }

    if (articles.length === 0) {
      return NextResponse.json({ error: '公開済みの記事がありません' }, { status: 404 });
    }

    // Build ZIP in memory using archiver
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 5 } });
    const passthrough = new PassThrough();

    passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.pipe(passthrough);

    // Add each article
    for (const article of articles) {
      const slug = article.slug ?? article.id;

      // Generate article HTML using the real generator
      const heroImagePath = 'images/hero.jpg';
      let html = generateArticleHtml(article, {
        heroImage: heroImagePath,
        heroImageAlt: article.title ?? slug,
        ogImage: `https://harmony-mc.com/column/${slug}/images/hero.jpg`,
        hubUrl: '../index.html',
      });

      // Post-process HTML: rewrite Supabase Storage URLs to local relative paths
      html = html.replace(
        /https:\/\/khsorerqojgwbmtiqrac\.supabase\.co\/storage\/v1\/object\/public\/article-images\/articles\/[^"]+\/(hero|body|summary)\.jpg/g,
        './images/$1.jpg',
      );
      // Fix CSS path
      html = html.replace('href="./css/hub.css"', 'href="../../css/style.css"');
      // Fix JS path
      html = html.replace('src="./js/hub.js"', 'src="../../js/hub.js"');
      // Fix related article links
      html = html.replace(/href="\/column\/([^"]+)\/"/g, 'href="../$1/index.html"');
      // Fix related article thumbnails
      html = html.replace(/src="\/column\/([^"]+)\/images\//g, 'src="../$1/images/');
      // Remove duplicate hero image from body HTML
      html = html.replace(/<img[^>]*src="\.\/images\/hero\.(jpg|svg)"[^>]*style="max-width:100%[^"]*"[^>]*>/g, '');
      html = html.replace(/<!--IMAGE:hero:[^>]*-->/g, '');

      archive.append(html, { name: `column/${slug}/index.html` });

      // Download and add images
      const imageFiles = parseImageFiles(article.image_files);
      for (const img of imageFiles) {
        if (!img.url) continue;
        try {
          const imgRes = await fetch(img.url);
          if (imgRes.ok) {
            const buffer = Buffer.from(await imgRes.arrayBuffer());
            const filename = img.position ? `${img.position}.jpg` : (img.filename ?? 'image.jpg');
            archive.append(buffer, { name: `column/${slug}/images/${filename}` });
          }
        } catch {
          // Skip failed image downloads
        }
      }
    }

    // Add hub page (column/index.html)
    const hubHtml = buildHubPageHtml(articles);
    archive.append(hubHtml, { name: 'column/index.html' });

    // Finalize archive
    await archive.finalize();

    // Wait for all data to be collected
    await new Promise<void>((resolve, reject) => {
      passthrough.on('end', resolve);
      passthrough.on('error', reject);
    });

    const zipBuffer = Buffer.concat(chunks);

    // Also write to local out/ directory (non-Vercel only)
    if (!process.env.VERCEL) {
      try {
        const outDir = path.join(process.cwd(), 'out');

        // Write each article to out/column/{slug}/
        for (const article of articles) {
          const slug = article.slug ?? article.id;
          const articleDir = path.join(outDir, 'column', slug);
          const imagesDir = path.join(articleDir, 'images');
          if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

          // Generate HTML (same as ZIP)
          let html = generateArticleHtml(article, {
            heroImage: 'images/hero.jpg',
            heroImageAlt: article.title ?? slug,
            ogImage: `https://harmony-mc.com/column/${slug}/images/hero.jpg`,
            hubUrl: '../index.html',
          });
          html = html.replace(/https:\/\/khsorerqojgwbmtiqrac\.supabase\.co\/storage\/v1\/object\/public\/article-images\/articles\/[^"]+\/(hero|body|summary)\.jpg/g, './images/$1.jpg');
          html = html.replace('href="./css/hub.css"', 'href="../../css/style.css"');
          html = html.replace('src="./js/hub.js"', 'src="../../js/hub.js"');
          html = html.replace(/href="\/column\/([^"]+)\/"/g, 'href="../$1/index.html"');
          html = html.replace(/src="\/column\/([^"]+)\/images\//g, 'src="../$1/images/');
          html = html.replace(/<img[^>]*src="\.\/images\/hero\.(jpg|svg)"[^>]*style="max-width:100%[^"]*"[^>]*>/g, '');
          html = html.replace(/<!--IMAGE:hero:[^>]*-->/g, '');
          fs.writeFileSync(path.join(articleDir, 'index.html'), html, 'utf-8');

          // Download images
          const imageFiles = parseImageFiles(article.image_files);
          for (const img of imageFiles) {
            if (!img.url) continue;
            try {
              const imgRes = await fetch(img.url);
              if (imgRes.ok) {
                const buffer = Buffer.from(await imgRes.arrayBuffer());
                const fname = img.position ? `${img.position}.jpg` : (img.filename ?? 'image.jpg');
                fs.writeFileSync(path.join(imagesDir, fname), buffer);
              }
            } catch { /* skip */ }
          }
        }

        // Write hub page
        const hubHtmlLocal = buildHubPageHtml(articles);
        const columnDir = path.join(outDir, 'column');
        if (!fs.existsSync(columnDir)) fs.mkdirSync(columnDir, { recursive: true });
        fs.writeFileSync(path.join(columnDir, 'index.html'), hubHtmlLocal, 'utf-8');

        logger.info('export', 'out-directory-written', { dir: outDir, articles: articles.length });
      } catch (outErr) {
        logger.warn('export', 'out-directory-failed', { error: String(outErr) });
      }
    }

    const filename = articleId
      ? `article-${articles[0].slug || 'export'}.zip`
      : 'all-articles.zip';

    logger.info('export', 'zip-exported', {
      articles: articles.length,
      zipSize: zipBuffer.length,
      filename,
    });

    return new NextResponse(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(zipBuffer.length),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('export', 'export-error', { error: message });
    return NextResponse.json({ error: `エクスポートに失敗しました: ${message}` }, { status: 500 });
  }
}

// ─── Helper: parse image_files JSONB ─────────────────────────────────────────

interface ImageFileEntry {
  url: string;
  filename?: string;
  alt?: string;
  position?: string;
}

function parseImageFiles(imageFiles: unknown): ImageFileEntry[] {
  if (!imageFiles) return [];
  try {
    const parsed = typeof imageFiles === 'string' ? JSON.parse(imageFiles) : imageFiles;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── Helper: build hub page HTML ─────────────────────────────────────────────

function buildHubPageHtml(articles: Article[]): string {
  const year = new Date().getFullYear();

  if (articles.length === 0) {
    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>コラム一覧 | Harmony スピリチュアルコラム</title>
  <style>body { background: #faf3ed; font-family: 'Noto Sans JP', sans-serif; color: #333; text-align: center; padding: 80px 16px; }</style>
</head>
<body>
  <h1>コラム</h1>
  <p>公開済みの記事はまだありません。</p>
</body>
</html>`;
  }

  const cardListHtml = articles
    .map((article) => {
      const slug = (article.slug || article.id) as string;
      const theme = (article.theme || 'spiritual_intro') as string;
      const bodyHtml = (article.stage3_final_html || article.stage2_body_html || '') as string;

      // Hero image alt
      let heroAlt = (article.title || 'コラム記事') as string;
      const imgFiles = parseImageFiles(article.image_files);
      if (imgFiles.length > 0) {
        const heroFile = imgFiles.find((f) => f.position === 'hero') ?? imgFiles[0];
        if (heroFile?.alt) heroAlt = heroFile.alt;
      }

      // Published date
      const publishedAt = article.published_at as string | null;
      let dateStr = '';
      if (publishedAt) {
        const d = new Date(publishedAt);
        dateStr = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
      }

      // Excerpt
      const plainText = bodyHtml.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      const excerpt = plainText.length > 120 ? plainText.slice(0, 117) + '...' : plainText;

      const categoryLabel = THEME_LABELS[theme] ?? theme;

      return `
    <a href="./${escAttr(slug)}/index.html" class="article-card">
      <div class="card-thumb">
        <img src="./${escAttr(slug)}/images/hero.jpg" alt="${escAttr(heroAlt)}" loading="lazy">
      </div>
      <div class="card-body">
        <h2>${escHtml(article.title || '無題')}</h2>
        <div class="card-meta">
          <span class="badge">${escHtml(categoryLabel)}</span>
          <span class="card-date">${escHtml(dateStr)}</span>
        </div>
        <p class="card-excerpt">${escHtml(excerpt)}</p>
      </div>
    </a>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>コラム一覧 | Harmony スピリチュアルコラム</title>
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
    }
    a { text-decoration: none; color: inherit; }
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
    .site-footer {
      text-align: center;
      padding: 32px 16px;
      border-top: 1px solid #e8ddd4;
      font-size: 0.8rem;
      color: #a09080;
    }
  </style>
</head>
<body>

  <header class="page-header">
    <h1>コラム</h1>
    <p>スピリチュアルカウンセラー小林由起子が、魂の成長やヒーリング、人間関係など日々の気づきを綴るコラムです。あなたの心に寄り添うメッセージをお届けします。</p>
  </header>

  <main class="article-grid">
${cardListHtml}
  </main>

  <footer class="site-footer">
    <p>Copyright &copy; ${year} スピリチュアルハーモニー All Rights Reserved.</p>
  </footer>

</body>
</html>`;
}
