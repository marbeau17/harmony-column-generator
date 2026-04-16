// POST /api/articles/[id]/deploy
// Uploads article HTML + images to FTP, then updates hub page index.html

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { generateArticleHtml } from '@/lib/generators/article-html-generator';
// hub page is now rebuilt via /api/hub/deploy (full generator with categories)
import { getFtpConfig, uploadToFtp } from '@/lib/deploy/ftp-uploader';
import { logger } from '@/lib/logger';
import { runDeployChecklist } from '@/lib/content/quality-checklist';
import { runTemplateCheck } from '@/lib/content/html-template-validator';
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

    // 由起子さん確認ゲート
    if (!article.reviewed_at) {
      logger.warn('api', 'deploy.reviewGate', { articleId, slug, reviewed_at: article.reviewed_at });
      return NextResponse.json({
        error: `由起子さんの確認が完了していません（${slug}）。記事詳細ページで「由起子さん確認」を実行してからデプロイしてください。`,
      }, { status: 422 });
    }

    // 2. Generate article HTML
    let html = generateArticleHtml(article, {
      heroImage: `images/hero.jpg`,
      heroImageAlt: article.title ?? slug,
      ogImage: `https://harmony-mc.com/column/${slug}/images/hero.jpg`,
      hubUrl: '../index.html',
    });

    // Post-process: fix paths for static hosting
    html = html.replace(/https:\/\/khsorerqojgwbmtiqrac\.supabase\.co\/storage\/v1\/object\/public\/article-images\/articles\/[^"]+\/(hero|body|summary)\.jpg/g, './images/$1.jpg');
    html = html.replace('href="./css/hub.css"', 'href="../../css/hub.css"');
    html = html.replace('src="./js/hub.js"', 'src="../../js/hub.js"');
    html = html.replace(/href="\/column\/([^"]+)\/"/g, 'href="../$1/index.html"');
    html = html.replace(/src="\/column\/([^"]+)\/images\//g, 'src="../$1/images/');
    html = html.replace(/<img[^>]*src="\.\/images\/hero\.(jpg|svg)"[^>]*style="max-width:100%[^"]*"[^>]*>/g, '');
    html = html.replace(/<!--IMAGE:hero:[^>]*-->/g, '');

    // 2.5 Pre-deploy quality gate
    const deployCheck = runDeployChecklist(html, slug);
    if (!deployCheck.passed) {
      const failedItems = deployCheck.items.filter(i => i.status === 'fail');
      return NextResponse.json({
        error: 'デプロイ前品質チェックに失敗しました',
        failedChecks: failedItems.map(i => ({ id: i.id, label: i.label, detail: i.detail })),
      }, { status: 422 });
    }

    // 2.6 Template format validation (final stage)
    const templateCheck = runTemplateCheck(html);
    if (!templateCheck.passed) {
      logger.warn('api', 'deploy.templateCheck', { articleId, slug, failures: templateCheck.failures });
      return NextResponse.json({
        error: 'テンプレート整合性チェックに失敗しました',
        failures: templateCheck.failures,
      }, { status: 422 });
    }

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

    // 5. Trigger hub page rebuild via /api/hub/deploy (uses full generator with categories/sidebar/pagination)
    // This is done AFTER the article FTP upload completes, as a background task
    const hubRebuildUrl = `${req.nextUrl.origin}/api/hub/deploy`;
    fetch(hubRebuildUrl, {
      method: 'POST',
      headers: { cookie: req.headers.get('cookie') || '' },
    }).catch((err) => logger.warn('api', 'deploy.hubRebuild', { error: String(err) }));

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

      // Hub page is rebuilt via /api/hub/deploy (triggered above)

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

// NOTE: buildHubHtml was removed. Hub page is now rebuilt via /api/hub/deploy
// which uses the full generator (categories, sidebar, pagination).
