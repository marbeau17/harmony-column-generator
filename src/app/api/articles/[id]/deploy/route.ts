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
import { isDeployable } from '@/lib/publish-control/visibility-predicate';
// P5-44: 公開 URL は env 駆動の単一ソースから取得 (ハードコード排除)
import { getOgImageUrl, getHubPath } from '@/lib/config/public-urls';
import type { Article } from '@/types/article';

// P5-44: 正規表現のメタ文字をエスケープ (hubPath を regex に埋め込む用)
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const maxDuration = 120;

type RouteParams = { params: { id: string } };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: articleId } = params;
  const startedAt = Date.now();

  // 関数入口 — silent failure を防ぐため必ず entered ログを残す
  logger.info('api', 'article_deploy.start', {
    article_id: articleId,
    elapsed_ms: 0,
  });

  try {
    // Auth
    const tAuth = Date.now();
    logger.info('api', 'article_deploy.auth.start', {
      article_id: articleId,
      elapsed_ms: Date.now() - startedAt,
    });
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      logger.warn('api', 'article_deploy.auth.failed', {
        article_id: articleId,
        reason: 'no_user',
        elapsed_ms: Date.now() - startedAt,
      });
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    logger.info('api', 'article_deploy.auth.end', {
      article_id: articleId,
      user_id: user.id,
      elapsed_ms: Date.now() - tAuth,
    });

    const serviceClient = await createServiceRoleClient();

    // 1. Fetch article
    const tFetch = Date.now();
    logger.info('api', 'article_deploy.fetch_article.start', {
      article_id: articleId,
      elapsed_ms: Date.now() - startedAt,
    });
    const { data: articleData, error: articleError } = await serviceClient
      .from('articles')
      .select('*')
      .eq('id', articleId)
      .single();
    if (articleError || !articleData) {
      logger.error(
        'api',
        'article_deploy.fetch_article.failed',
        {
          article_id: articleId,
          error_message: articleError?.message ?? 'no_data',
          elapsed_ms: Date.now() - tFetch,
        },
        articleError ?? undefined,
      );
      return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 });
    }
    const article = articleData as unknown as Article;
    const slug = article.slug ?? article.id;
    logger.info('api', 'article_deploy.fetch_article.end', {
      article_id: articleId,
      slug,
      status: article.status,
      visibility_state: article.visibility_state,
      generation_mode: article.generation_mode,
      reviewed_at: article.reviewed_at,
      elapsed_ms: Date.now() - tFetch,
    });

    // P5-43 Step 2: 由起子さん確認ゲート + visibility_state ベース判定 (§6.1)
    // visibility_state ∈ {idle, failed, live_hub_stale, unpublished} のみ deploy 可能
    // {draft, pending_review, deploying, live} は deploy 不可
    const deployable = isDeployable(article);
    logger.info('api', 'article_deploy.is_deployable.check', {
      article_id: articleId,
      slug,
      deployable,
      visibility_state: article.visibility_state,
      elapsed_ms: Date.now() - startedAt,
    });
    if (!deployable) {
      const isPendingReview = article.visibility_state === 'pending_review';
      logger.warn('api', 'article_deploy.not_deployable', {
        article_id: articleId,
        slug,
        visibility_state: article.visibility_state,
        is_pending_review: isPendingReview,
        // audit-only: P5-43 Step 4 — ログ補助情報として残す。デプロイ可否判定は isDeployable (visibility_state) のみ。
        reviewed_at: article.reviewed_at,
        elapsed_ms: Date.now() - startedAt,
      });
      return NextResponse.json({
        error: isPendingReview
          ? `由起子さんの確認が完了していません（${slug}）。記事詳細ページで「由起子さん確認」を実行してからデプロイしてください。`
          : `この記事はデプロイできない状態です（visibility_state=${article.visibility_state ?? 'null'}）`,
        code: isPendingReview ? 'PENDING_REVIEW' : 'NOT_DEPLOYABLE',
      }, { status: 422 });
    }

    // 2. Generate article HTML
    const tHtml = Date.now();
    logger.info('api', 'article_deploy.html_generate.start', {
      article_id: articleId,
      slug,
      elapsed_ms: Date.now() - startedAt,
    });
    let html = generateArticleHtml(article, {
      heroImage: `images/hero.jpg`,
      heroImageAlt: article.title ?? slug,
      // P5-44: env 駆動の og:image URL ヘルパーを使用
      ogImage: getOgImageUrl(slug, 'hero'),
      hubUrl: '../index.html',
    });
    const charsBeforeReplace = html.length;
    logger.info('api', 'article_deploy.html_generate.end', {
      article_id: articleId,
      slug,
      chars: charsBeforeReplace,
      elapsed_ms: Date.now() - tHtml,
    });

    // Post-process: fix paths for static hosting
    logger.info('api', 'article_deploy.html_postprocess.start', {
      article_id: articleId,
      slug,
      chars_before: charsBeforeReplace,
      elapsed_ms: Date.now() - startedAt,
    });
    html = html.replace(/https:\/\/khsorerqojgwbmtiqrac\.supabase\.co\/storage\/v1\/object\/public\/article-images\/articles\/[^"]+\/(hero|body|summary)\.jpg/g, './images/$1.jpg');
    html = html.replace('href="./css/hub.css"', 'href="../../css/hub.css"');
    html = html.replace('src="./js/hub.js"', 'src="../../js/hub.js"');
    // P5-44: 関連記事リンク/サムネイルの post-process を hubPath ベースに変更
    const hubPathPattern = escapeRegex(getHubPath());
    html = html.replace(
      new RegExp(`href="${hubPathPattern}/([^"]+)/"`, 'g'),
      'href="../$1/index.html"',
    );
    html = html.replace(
      new RegExp(`src="${hubPathPattern}/([^"]+)/images/`, 'g'),
      'src="../$1/images/',
    );
    html = html.replace(/<img[^>]*src="\.\/images\/hero\.(jpg|svg)"[^>]*style="max-width:100%[^"]*"[^>]*>/g, '');
    html = html.replace(/<!--IMAGE:hero:[^>]*-->/g, '');
    logger.info('api', 'article_deploy.html_postprocess.end', {
      article_id: articleId,
      slug,
      chars_before: charsBeforeReplace,
      chars_after: html.length,
      diff: html.length - charsBeforeReplace,
      elapsed_ms: Date.now() - startedAt,
    });

    // 2.5 Pre-deploy quality gate
    const tChecklist = Date.now();
    logger.info('api', 'article_deploy.checklist.start', {
      article_id: articleId,
      slug,
      elapsed_ms: Date.now() - startedAt,
    });
    const deployCheck = runDeployChecklist(html, slug);
    logger.info('api', 'article_deploy.checklist.end', {
      article_id: articleId,
      slug,
      passed: deployCheck.passed,
      items_count: deployCheck.items.length,
      elapsed_ms: Date.now() - tChecklist,
    });
    if (!deployCheck.passed) {
      const failedItems = deployCheck.items.filter(i => i.status === 'fail');
      logger.warn('api', 'article_deploy.checklist.failed', {
        article_id: articleId,
        slug,
        failed_count: failedItems.length,
        failed_ids: failedItems.map(i => i.id),
        failed_items: failedItems.map(i => ({ id: i.id, label: i.label, detail: i.detail })),
        elapsed_ms: Date.now() - startedAt,
      });
      return NextResponse.json({
        error: 'デプロイ前品質チェックに失敗しました',
        failedChecks: failedItems.map(i => ({ id: i.id, label: i.label, detail: i.detail })),
      }, { status: 422 });
    }

    // 2.6 Template format validation (final stage)
    const tTemplate = Date.now();
    logger.info('api', 'article_deploy.template_check.start', {
      article_id: articleId,
      slug,
      elapsed_ms: Date.now() - startedAt,
    });
    const templateCheck = runTemplateCheck(html);
    logger.info('api', 'article_deploy.template_check.end', {
      article_id: articleId,
      slug,
      passed: templateCheck.passed,
      failures_count: templateCheck.failures?.length ?? 0,
      elapsed_ms: Date.now() - tTemplate,
    });
    if (!templateCheck.passed) {
      logger.warn('api', 'article_deploy.template_check.failed', {
        article_id: articleId,
        slug,
        failures: templateCheck.failures,
        elapsed_ms: Date.now() - startedAt,
      });
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
    logger.info('api', 'article_deploy.image_prepare.start', {
      article_id: articleId,
      slug,
      image_files_count: imageFiles.length,
      elapsed_ms: Date.now() - startedAt,
    });
    for (const img of imageFiles) {
      if (!img.url) {
        logger.warn('api', 'article_deploy.image_prepare.skip_no_url', {
          article_id: articleId,
          slug,
          position: img.position,
          elapsed_ms: Date.now() - startedAt,
        });
        continue;
      }
      const tImgFetch = Date.now();
      logger.info('api', 'article_deploy.image_prepare.fetch.start', {
        article_id: articleId,
        slug,
        position: img.position,
        url: img.url,
        elapsed_ms: Date.now() - startedAt,
      });
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
          logger.info('api', 'article_deploy.image_prepare.fetch.end', {
            article_id: articleId,
            slug,
            position: img.position,
            status: imgRes.status,
            bytes: buffer.byteLength,
            filename,
            elapsed_ms: Date.now() - tImgFetch,
          });
        } else {
          logger.warn('api', 'article_deploy.image_prepare.fetch.failed', {
            article_id: articleId,
            slug,
            position: img.position,
            status: imgRes.status,
            url: img.url,
            elapsed_ms: Date.now() - tImgFetch,
          });
        }
      } catch (imgFetchErr) {
        // Skip failed downloads
        logger.error(
          'api',
          'article_deploy.image_download_failed',
          {
            article_id: articleId,
            slug,
            position: img.position,
            url: img.url,
            error_message: (imgFetchErr as Error)?.message ?? String(imgFetchErr),
            stack: (imgFetchErr as Error)?.stack?.slice(0, 500),
            elapsed_ms: Date.now() - tImgFetch,
          },
          imgFetchErr instanceof Error ? imgFetchErr : undefined,
        );
      }
    }
    logger.info('api', 'article_deploy.image_prepare.end', {
      article_id: articleId,
      slug,
      prepared_count: files.length - 1, // index.html を除く
      elapsed_ms: Date.now() - startedAt,
    });

    // 5. Trigger hub page rebuild via /api/hub/deploy (uses full generator with categories/sidebar/pagination)
    // This is done AFTER the article FTP upload completes, as a background task
    const hubRebuildUrl = `${req.nextUrl.origin}/api/hub/deploy`;
    const tHubRebuild = Date.now();
    logger.info('api', 'article_deploy.hub_rebuild.start', {
      article_id: articleId,
      slug,
      url: hubRebuildUrl,
      elapsed_ms: Date.now() - startedAt,
    });
    fetch(hubRebuildUrl, {
      method: 'POST',
      headers: { cookie: req.headers.get('cookie') || '' },
    })
      .then((r) =>
        logger.info('api', 'article_deploy.hub_rebuild.end', {
          article_id: articleId,
          slug,
          ok: r.ok,
          status: r.status,
          elapsed_ms: Date.now() - tHubRebuild,
        }),
      )
      .catch((err) =>
        logger.warn('api', 'article_deploy.hub_rebuild.failed', {
          article_id: articleId,
          slug,
          error_message: err instanceof Error ? err.message : String(err),
          elapsed_ms: Date.now() - tHubRebuild,
        }),
      );

    // 6. Upload via FTP
    const tFtpConfig = Date.now();
    logger.info('api', 'article_deploy.ftp_config.start', {
      article_id: articleId,
      slug,
      elapsed_ms: Date.now() - startedAt,
    });
    const ftpConfig = await getFtpConfig();
    logger.info('api', 'article_deploy.ftp_config.end', {
      article_id: articleId,
      slug,
      host: ftpConfig.host,
      port: ftpConfig.port,
      secure: ftpConfig.secure,
      remote_base_path: ftpConfig.remoteBasePath,
      elapsed_ms: Date.now() - tFtpConfig,
    });

    // Use basic-ftp directly for binary support
    const { Client } = await import('basic-ftp');
    const client = new Client();
    client.ftp.verbose = false;

    const uploaded: string[] = [];
    const errors: string[] = [];

    try {
      const tFtpConnect = Date.now();
      logger.info('api', 'article_deploy.ftp_connect.start', {
        article_id: articleId,
        slug,
        host: ftpConfig.host,
        port: ftpConfig.port || 21,
        secure: ftpConfig.secure || false,
        elapsed_ms: Date.now() - startedAt,
      });
      logger.info('ftp', 'article_deploy.ftp.access.attempt', {
        article_id: articleId,
        slug,
        host: ftpConfig.host,
        port: ftpConfig.port || 21,
        secure: ftpConfig.secure || false,
      });
      await client.access({
        host: ftpConfig.host,
        user: ftpConfig.user,
        password: ftpConfig.password,
        port: ftpConfig.port || 21,
        secure: ftpConfig.secure || false,
      });
      logger.info('ftp', 'article_deploy.ftp.access.ok', {
        article_id: articleId,
        slug,
        elapsed_ms: Date.now() - tFtpConnect,
      });
      logger.info('api', 'article_deploy.ftp_connect.end', {
        article_id: articleId,
        slug,
        elapsed_ms: Date.now() - tFtpConnect,
      });

      const basePath = ftpConfig.remoteBasePath;

      // Upload article HTML
      const htmlRemotePath = `${basePath}${slug}/index.html`;
      const tHtmlUpload = Date.now();
      logger.info('api', 'article_deploy.ftp_upload_per_file.start', {
        article_id: articleId,
        slug,
        remote_path: htmlRemotePath,
        kind: 'html',
        bytes: Buffer.byteLength(html, 'utf-8'),
        elapsed_ms: Date.now() - startedAt,
      });
      const htmlStream = new (await import('stream')).Readable();
      htmlStream.push(html);
      htmlStream.push(null);
      logger.info('api', 'article_deploy.ftp_ensure_dir.start', {
        article_id: articleId,
        slug,
        dir: `${basePath}${slug}`,
        elapsed_ms: Date.now() - startedAt,
      });
      logger.info('ftp', 'article_deploy.ftp.ensure_dir.attempt', {
        article_id: articleId,
        slug,
        remote_dir: `${basePath}${slug}`,
      });
      await client.ensureDir(`${basePath}${slug}`);
      logger.info('ftp', 'article_deploy.ftp.ensure_dir.ok', {
        article_id: articleId,
        slug,
        remote_dir: `${basePath}${slug}`,
      });
      logger.info('api', 'article_deploy.ftp_ensure_dir.end', {
        article_id: articleId,
        slug,
        dir: `${basePath}${slug}`,
        elapsed_ms: Date.now() - startedAt,
      });
      logger.info('ftp', 'article_deploy.ftp.cd.attempt', {
        article_id: articleId,
        slug,
        target: '/',
      });
      await client.cd('/');
      logger.info('ftp', 'article_deploy.ftp.cd.ok', {
        article_id: articleId,
        slug,
        target: '/',
      });
      const tHtmlUp = Date.now();
      logger.info('ftp', 'article_deploy.ftp.upload_from.attempt', {
        article_id: articleId,
        slug,
        remote_path: htmlRemotePath,
        kind: 'html',
        bytes: Buffer.byteLength(html, 'utf-8'),
      });
      await client.uploadFrom(htmlStream, htmlRemotePath);
      logger.info('ftp', 'article_deploy.ftp.upload_from.ok', {
        article_id: articleId,
        slug,
        remote_path: htmlRemotePath,
        kind: 'html',
        bytes: Buffer.byteLength(html, 'utf-8'),
        elapsed_ms: Date.now() - tHtmlUp,
      });
      uploaded.push(`${slug}/index.html`);
      logger.info('api', 'article_deploy.ftp_upload_per_file.end', {
        article_id: articleId,
        slug,
        remote_path: htmlRemotePath,
        kind: 'html',
        ok: true,
        elapsed_ms: Date.now() - tHtmlUpload,
      });

      // Upload images
      for (const img of imageFiles) {
        if (!img.url) {
          logger.warn('api', 'article_deploy.ftp_upload_per_file.skip_no_url', {
            article_id: articleId,
            slug,
            position: img.position,
            elapsed_ms: Date.now() - startedAt,
          });
          continue;
        }
        const filename = img.position ? `${img.position}.jpg` : 'image.jpg';
        const imgRemotePath = `${basePath}${slug}/images/${filename}`;
        const tImgUpload = Date.now();
        logger.info('api', 'article_deploy.ftp_upload_per_file.start', {
          article_id: articleId,
          slug,
          remote_path: imgRemotePath,
          kind: 'image',
          position: img.position,
          source_url: img.url,
          elapsed_ms: Date.now() - startedAt,
        });
        try {
          logger.info('ftp', 'article_deploy.image.fetch.attempt', {
            article_id: articleId,
            slug,
            position: img.position,
            url: img.url,
          });
          const imgRes = await fetch(img.url);
          logger.info('ftp', 'article_deploy.image.fetch.end', {
            article_id: articleId,
            slug,
            position: img.position,
            ok: imgRes.ok,
            status: imgRes.status,
          });
          if (!imgRes.ok) {
            logger.warn('api', 'article_deploy.ftp_upload_per_file.fetch_failed', {
              article_id: articleId,
              slug,
              position: img.position,
              status: imgRes.status,
              url: img.url,
              elapsed_ms: Date.now() - tImgUpload,
            });
            continue;
          }
          const buffer = Buffer.from(await imgRes.arrayBuffer());

          const imgStream = new (await import('stream')).Readable();
          imgStream.push(buffer);
          imgStream.push(null);

          logger.info('ftp', 'article_deploy.ftp.ensure_dir.attempt', {
            article_id: articleId,
            slug,
            remote_dir: `${basePath}${slug}/images`,
          });
          await client.ensureDir(`${basePath}${slug}/images`);
          logger.info('ftp', 'article_deploy.ftp.ensure_dir.ok', {
            article_id: articleId,
            slug,
            remote_dir: `${basePath}${slug}/images`,
          });
          logger.info('ftp', 'article_deploy.ftp.cd.attempt', {
            article_id: articleId,
            slug,
            target: '/',
          });
          await client.cd('/');
          logger.info('ftp', 'article_deploy.ftp.cd.ok', {
            article_id: articleId,
            slug,
            target: '/',
          });
          const tImgUp = Date.now();
          logger.info('ftp', 'article_deploy.ftp.upload_from.attempt', {
            article_id: articleId,
            slug,
            remote_path: imgRemotePath,
            kind: 'image',
            bytes: buffer.byteLength,
          });
          await client.uploadFrom(imgStream, imgRemotePath);
          logger.info('ftp', 'article_deploy.ftp.upload_from.ok', {
            article_id: articleId,
            slug,
            remote_path: imgRemotePath,
            kind: 'image',
            bytes: buffer.byteLength,
            elapsed_ms: Date.now() - tImgUp,
          });
          uploaded.push(`${slug}/images/${filename}`);
          logger.info('api', 'article_deploy.ftp_upload_per_file.end', {
            article_id: articleId,
            slug,
            remote_path: imgRemotePath,
            kind: 'image',
            position: img.position,
            bytes: buffer.byteLength,
            ok: true,
            elapsed_ms: Date.now() - tImgUpload,
          });
        } catch (imgErr) {
          const msg = `Image ${img.position}: ${String(imgErr)}`;
          errors.push(msg);
          logger.error(
            'api',
            'article_deploy.ftp_upload_per_file.failed',
            {
              article_id: articleId,
              slug,
              remote_path: imgRemotePath,
              position: img.position,
              error_message: (imgErr as Error)?.message ?? String(imgErr),
              stack: (imgErr as Error)?.stack?.slice(0, 500),
              elapsed_ms: Date.now() - tImgUpload,
            },
            imgErr instanceof Error ? imgErr : undefined,
          );
        }
      }

      // Hub page is rebuilt via /api/hub/deploy (triggered above)

    } finally {
      logger.info('api', 'article_deploy.ftp_close', {
        article_id: articleId,
        slug,
        elapsed_ms: Date.now() - startedAt,
      });
      logger.info('ftp', 'article_deploy.ftp.close.attempt', {
        article_id: articleId,
        slug,
      });
      client.close();
      logger.info('ftp', 'article_deploy.ftp.close.ok', {
        article_id: articleId,
        slug,
      });
    }

    logger.info('deploy', 'article-deployed', { articleId, slug, uploaded: uploaded.length, errors: errors.length });
    logger.info('api', 'article_deploy.end', {
      article_id: articleId,
      slug,
      uploaded_count: uploaded.length,
      errors_count: errors.length,
      uploaded,
      errors,
      elapsed_ms: Date.now() - startedAt,
    });

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
    logger.error(
      'api',
      'article_deploy.failed',
      {
        article_id: articleId,
        error_message: message,
        stack: error instanceof Error ? error.stack?.slice(0, 500) : undefined,
        elapsed_ms: Date.now() - startedAt,
      },
      error instanceof Error ? error : undefined,
    );
    return NextResponse.json({ error: `FTPアップロードに失敗: ${message}` }, { status: 500 });
  }
}

// NOTE: buildHubHtml was removed. Hub page is now rebuilt via /api/hub/deploy
// which uses the full generator (categories, sidebar, pagination).
