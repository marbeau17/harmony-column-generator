// POST /api/articles/[id]/deploy
// Uploads article HTML + images to FTP, then updates hub page index.html

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { generateArticleHtml } from '@/lib/generators/article-html-generator';
import { getStickyCtaBarCss, getStickyCtaBarHtml } from '@/lib/generators/sticky-cta-bar';
import { getFtpConfig, uploadToFtp } from '@/lib/deploy/ftp-uploader';
import { logger } from '@/lib/logger';
import type { Article } from '@/types/article';

export const maxDuration = 120;

type RouteParams = { params: { id: string } };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: articleId } = params;

  try {
    // Auth
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const serviceClient = await createServiceRoleClient();

    // 1. Fetch article
    const { data: articleData, error: articleError } = await serviceClient
      .from('articles')
      .select('*')
      .eq('id', articleId)
      .single();
    if (articleError || !articleData) {
      return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 });
    }
    const article = articleData as unknown as Article;
    const slug = article.slug ?? article.id;

    // 2. Generate article HTML
    let html = generateArticleHtml(article, {
      heroImage: `images/hero.jpg`,
      heroImageAlt: article.title ?? slug,
      ogImage: `https://harmony-mc.com/column/${slug}/images/hero.jpg`,
      hubUrl: '../index.html',
    });

    // Post-process: fix paths for static hosting
    html = html.replace(/https:\/\/khsorerqojgwbmtiqrac\.supabase\.co\/storage\/v1\/object\/public\/article-images\/articles\/[^"]+\/(hero|body|summary)\.jpg/g, './images/$1.jpg');
    html = html.replace('href="./css/hub.css"', 'href="../../css/style.css"');
    html = html.replace('src="./js/hub.js"', 'src="../../js/hub.js"');
    html = html.replace(/href="\/column\/([^"]+)\/"/g, 'href="../$1/index.html"');
    html = html.replace(/src="\/column\/([^"]+)\/images\//g, 'src="../$1/images/');
    html = html.replace(/<img[^>]*src="\.\/images\/hero\.(jpg|svg)"[^>]*style="max-width:100%[^"]*"[^>]*>/g, '');
    html = html.replace(/<!--IMAGE:hero:[^>]*-->/g, '');

    // 3. Prepare files for upload
    const files: { remotePath: string; content: string }[] = [];
    files.push({ remotePath: `${slug}/index.html`, content: html });

    // 4. Download images from Supabase and prepare for upload
    const imageFiles = Array.isArray(article.image_files) ? article.image_files as { url: string; position: string; alt?: string }[] : [];
    for (const img of imageFiles) {
      if (!img.url) continue;
      try {
        const imgRes = await fetch(img.url);
        if (imgRes.ok) {
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          const filename = img.position ? `${img.position}.jpg` : 'image.jpg';
          // For binary files, we need to upload differently
          // The uploadToFtp takes string content, so we base64 encode
          // Actually, let's use the FTP client directly for binary
          files.push({
            remotePath: `${slug}/images/${filename}`,
            content: buffer.toString('base64'),
          });
        }
      } catch {
        // Skip failed downloads
      }
    }

    // 5. Generate hub page (index.html) with all published articles
    const { data: allArticles } = await serviceClient
      .from('articles')
      .select('id, title, slug, meta_description, theme, published_at, image_files, stage2_body_html, stage3_final_html')
      .eq('status', 'published')
      .order('published_at', { ascending: false });

    // Build hub HTML (same as export)
    const hubHtml = buildHubHtml((allArticles || []) as any[]);
    files.push({ remotePath: 'index.html', content: hubHtml });

    // 6. Upload via FTP
    const ftpConfig = await getFtpConfig();

    // Use basic-ftp directly for binary support
    const { Client } = await import('basic-ftp');
    const client = new Client();
    client.ftp.verbose = false;

    const uploaded: string[] = [];
    const errors: string[] = [];

    try {
      await client.access({
        host: ftpConfig.host,
        user: ftpConfig.user,
        password: ftpConfig.password,
        port: ftpConfig.port || 21,
        secure: ftpConfig.secure || false,
      });

      const basePath = ftpConfig.remoteBasePath;

      // Upload article HTML
      const htmlStream = new (await import('stream')).Readable();
      htmlStream.push(html);
      htmlStream.push(null);
      await client.ensureDir(`${basePath}${slug}`);
      await client.cd('/');
      await client.uploadFrom(htmlStream, `${basePath}${slug}/index.html`);
      uploaded.push(`${slug}/index.html`);

      // Upload images
      for (const img of imageFiles) {
        if (!img.url) continue;
        try {
          const imgRes = await fetch(img.url);
          if (!imgRes.ok) continue;
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          const filename = img.position ? `${img.position}.jpg` : 'image.jpg';

          const imgStream = new (await import('stream')).Readable();
          imgStream.push(buffer);
          imgStream.push(null);

          await client.ensureDir(`${basePath}${slug}/images`);
          await client.cd('/');
          await client.uploadFrom(imgStream, `${basePath}${slug}/images/${filename}`);
          uploaded.push(`${slug}/images/${filename}`);
        } catch (imgErr) {
          errors.push(`Image ${img.position}: ${String(imgErr)}`);
        }
      }

      // Upload hub page
      const hubStream = new (await import('stream')).Readable();
      hubStream.push(hubHtml);
      hubStream.push(null);
      await client.cd('/');
      await client.uploadFrom(hubStream, `${basePath}index.html`);
      uploaded.push('index.html');

    } finally {
      client.close();
    }

    logger.info('deploy', 'article-deployed', { articleId, slug, uploaded: uploaded.length, errors: errors.length });

    return NextResponse.json({
      success: true,
      slug,
      uploaded,
      errors,
      message: `${slug} をFTPにアップロードしました（${uploaded.length}ファイル）`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('deploy', 'article-deploy-failed', { articleId, error: message });
    return NextResponse.json({ error: `FTPアップロードに失敗: ${message}` }, { status: 500 });
  }
}

// Hub page HTML builder (simplified)
function buildHubHtml(articles: any[]): string {
  const esc = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const THEME: Record<string, string> = {
    soul_mission: '魂の使命', relationships: '人間関係', grief_care: 'グリーフケア',
    self_growth: '自己成長', healing: 'ヒーリング', daily_awareness: '日常の気づき',
    spiritual_intro: 'スピリチュアル入門',
  };

  const cards = articles.map(a => {
    const s = a.slug || a.id;
    const c = THEME[a.theme || ''] || a.theme || '';
    const pd = a.published_at ? new Date(a.published_at) : new Date();
    const ds = `${pd.getFullYear()}.${String(pd.getMonth() + 1).padStart(2, '0')}.${String(pd.getDate()).padStart(2, '0')}`;
    const bdy = (a.stage3_final_html || a.stage2_body_html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    const ex = bdy.length > 120 ? bdy.slice(0, 117) + '...' : bdy;
    return `<a href="./${s}/index.html" class="article-card"><div class="card-thumb"><img src="./${s}/images/hero.jpg" alt="${esc(a.title || '')}" loading="lazy"></div><div class="card-body"><h2>${esc(a.title || '')}</h2><div class="card-meta"><span class="badge">${esc(c)}</span><span class="card-date">${ds}</span></div><p class="card-excerpt">${esc(ex)}</p></div></a>`;
  }).join('\n');

  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>魂の気づきコラム｜今を生きるヒント | Harmony</title><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&display=swap" rel="stylesheet"><style>:root{--color-primary:#b39578;--color-dark:#53352b;--color-gold:#d4a574;--color-bg:#faf3ed}*{margin:0;padding:0;box-sizing:border-box}body{background-color:var(--color-bg);font-family:"Noto Sans JP",sans-serif;color:#333;line-height:1.8;padding-bottom:72px}a{text-decoration:none;color:inherit}.page-header{text-align:center;padding:64px 16px 48px}.page-header h1{font-size:2rem;font-weight:700;color:var(--color-dark)}.page-header p{font-size:.95rem;color:#7a6a5e;max-width:560px;margin:12px auto 0}.article-grid{display:grid;grid-template-columns:1fr;gap:24px;max-width:1152px;margin:0 auto;padding:0 16px 64px}@media(min-width:640px){.article-grid{grid-template-columns:repeat(2,1fr)}}@media(min-width:1024px){.article-grid{grid-template-columns:repeat(3,1fr)}}.article-card{background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.06);overflow:hidden;transition:transform .2s;display:flex;flex-direction:column}.article-card:hover{transform:translateY(-4px)}.card-body{padding:20px 20px 24px;flex:1;display:flex;flex-direction:column}.card-body h2{font-size:1.05rem;font-weight:500;color:var(--color-dark);line-height:1.6;margin-bottom:10px}.card-meta{display:flex;align-items:center;gap:10px;margin-bottom:12px}.badge{display:inline-block;font-size:.72rem;font-weight:500;padding:2px 10px;border-radius:99px;background:var(--color-bg);color:var(--color-primary);border:1px solid var(--color-primary)}.card-date{font-size:.78rem;color:#a09080}.card-excerpt{font-size:.88rem;color:#6b5e54;line-height:1.7;margin-top:auto;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.card-thumb{aspect-ratio:16/9;overflow:hidden}.card-thumb img{width:100%;height:100%;object-fit:cover;transition:transform .3s}.article-card:hover .card-thumb img{transform:scale(1.05)}.site-footer{text-align:center;padding:32px 16px;border-top:1px solid #e8ddd4;font-size:.8rem;color:#a09080}${getStickyCtaBarCss()}</style></head><body><header class="page-header"><p style="margin-bottom:12px"><a href="https://harmony-mc.com/" style="color:#b39578;font-size:.85rem;text-decoration:none">← ホームへ戻る</a></p><h1>魂の気づきコラム</h1><p class="page-subtitle">「今を生きるヒント」</p><p>スピリチュアルカウンセラー小林由起子が、魂の成長やヒーリング、人間関係など日々の気づきを綴るコラムです。</p></header><main class="article-grid">${cards}</main><footer class="site-footer"><p>Copyright &copy; ${new Date().getFullYear()} スピリチュアルハーモニー All Rights Reserved.</p></footer>${getStickyCtaBarHtml()}</body></html>`;
}
