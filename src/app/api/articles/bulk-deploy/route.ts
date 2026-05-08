// ============================================================================
// src/app/api/articles/bulk-deploy/route.ts
// 全記事一括 FTP デプロイ — 設定ページの「全記事を FTP にアップロード」ボタンから呼ばれる。
//
// Phase 2 (P5-80 系) refactor:
//   旧実装は 1 connection を 35 件で再利用 (P5-75) → per-article reconnect (P5-79) と
//   試行したが、いずれも 0/35 失敗。Vercel Functions Logs の 256 line/invocation cap で
//   後段ログがすべて drop され、真因を特定できなかった (10-agent audit 結果)。
//
//   本実装は hub-deploy / per-article deploy が安定動作している pattern に合わせ、
//   記事ごとに fresh `new Client()` を開いて 1 件分 (HTML + 画像 3 枚) をアップロードし、
//   close() してから次の記事に進む。1.5 秒の sleep を挟んで lolipop の暗黙スロットリング
//   (短時間大量 PUT 制限) を回避する。
//
// 主要変更:
//  - P5-81: client.ftp.verbose=false の自爆コードを削除 (wire log 復活)
//  - P5-82: attachFtpWireLogger に errorsOnly: true を渡し、4xx/5xx 応答だけ通す
//           (256 line cap を回避)
//  - P5-83: await fetch(hubRebuildUrl) + await client.close() で unhandledRejection を排除
//  - P5-84: image_files の型ガード (Array | JSON string 両対応)
// ============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { Client } from 'basic-ftp';
import { Readable } from 'stream';
import { buildDeployHtml } from '@/lib/deploy/article-html-builder';
import { getFtpConfig } from '@/lib/deploy/ftp-uploader';
import { attachFtpWireLogger } from '@/lib/deploy/ftp-wire-logger';
import { logger } from '@/lib/logger';
import type { Article } from '@/types/article';

export const maxDuration = 300;

// lolipop 暗黙スロットリング (短時間大量 PUT) 回避のため記事間で sleep を挟む。
// 35 記事 × (FTP セッション ~4s + sleep 1.5s) ≒ 192s → maxDuration 300s 内に収まる。
const SLEEP_BETWEEN_ARTICLES_MS = 1500;

interface ImageFile {
  url: string;
  position: string;
  alt?: string;
}

interface BulkDeployError {
  article_id: string;
  slug: string;
  message: string;
}

// P5-84: image_files カラムは jsonb (Supabase JS client は通常 array で返すが、
// 古い行で string が混入する可能性に備える二重ガード)。
function parseImageFiles(raw: unknown): ImageFile[] {
  if (Array.isArray(raw)) {
    return raw.filter(
      (x): x is ImageFile =>
        x != null && typeof x === 'object' && typeof (x as ImageFile).url === 'string',
    );
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (x): x is ImageFile =>
            x != null && typeof x === 'object' && typeof (x as ImageFile).url === 'string',
        );
      }
    } catch {
      // fall through
    }
  }
  return [];
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 1 記事分の FTP アップロード (fresh connection per article)。
 * 失敗時は throw せず string[] にエラーを蓄積して返す。
 */
async function uploadArticleViaFtp(
  ftpConfig: Awaited<ReturnType<typeof getFtpConfig>>,
  article: Article,
  html: string,
  imageFiles: ImageFile[],
  index: number,
  total: number,
): Promise<{ uploadedFiles: number; errors: string[] }> {
  const slug = article.slug ?? article.id;
  const articleId = article.id;
  const basePath = ftpConfig.remoteBasePath;
  const errors: string[] = [];
  let uploadedFiles = 0;

  // P5-79 後継: 60s timeout は basic-ftp constructor で渡す (ftp.timeout は readonly)
  const client = new Client(60000);
  // P5-82: errorsOnly=true で wire log を 4xx/5xx 応答に限定 (256 line cap 回避)
  attachFtpWireLogger(client, { where: 'bulk_deploy', article_id: articleId, slug }, { errorsOnly: true });

  const tArticle = Date.now();
  logger.info('api', 'bulk_deploy.article.start', {
    article_id: articleId,
    slug,
    index,
    total,
  });

  try {
    // 接続
    const tConnect = Date.now();
    await client.access({
      host: ftpConfig.host,
      user: ftpConfig.user,
      password: ftpConfig.password,
      port: ftpConfig.port || 21,
      secure: ftpConfig.secure || false,
    });
    logger.info('ftp', 'bulk_deploy.article.access.ok', {
      article_id: articleId,
      slug,
      elapsed_ms: Date.now() - tConnect,
    });

    // index.html
    const htmlRemote = `${basePath}${slug}/index.html`;
    try {
      await client.ensureDir(`${basePath}${slug}/`);
      await client.cd('/');
      const htmlStream = Readable.from(Buffer.from(html, 'utf-8'));
      await client.uploadFrom(htmlStream, htmlRemote);
      uploadedFiles++;
      logger.info('ftp', 'bulk_deploy.article.html.ok', {
        article_id: articleId,
        slug,
        bytes: html.length,
        elapsed_ms: Date.now() - tArticle,
      });
    } catch (htmlErr) {
      const msg = `index.html: ${htmlErr instanceof Error ? htmlErr.message : String(htmlErr)}`;
      errors.push(msg);
      logger.error(
        'api',
        'bulk_deploy.article.html_upload_failed',
        {
          article_id: articleId,
          slug,
          remote_path: htmlRemote,
          error_message: msg,
          stack: htmlErr instanceof Error ? htmlErr.stack?.slice(0, 500) : undefined,
        },
        htmlErr instanceof Error ? htmlErr : undefined,
      );
    }

    // 画像 (hero/body/summary)
    for (const img of imageFiles) {
      if (!img.url) continue;
      const filename = img.position ? `${img.position}.jpg` : 'image.jpg';
      const imgRemote = `${basePath}${slug}/images/${filename}`;
      try {
        const res = await fetch(img.url);
        if (!res.ok) {
          const msg = `${img.position}: HTTP ${res.status}`;
          errors.push(msg);
          logger.warn('api', 'bulk_deploy.article.image_fetch_failed', {
            article_id: articleId,
            slug,
            position: img.position,
            status: res.status,
          });
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        await client.ensureDir(`${basePath}${slug}/images/`);
        await client.cd('/');
        await client.uploadFrom(Readable.from(buf), imgRemote);
        uploadedFiles++;
        logger.info('ftp', 'bulk_deploy.article.image.ok', {
          article_id: articleId,
          slug,
          position: img.position,
          bytes: buf.length,
        });
      } catch (imgErr) {
        const msg = `${img.position}: ${imgErr instanceof Error ? imgErr.message : String(imgErr)}`;
        errors.push(msg);
        logger.error(
          'api',
          'bulk_deploy.article.image_upload_failed',
          {
            article_id: articleId,
            slug,
            remote_path: imgRemote,
            position: img.position,
            error_message: msg,
            stack: imgErr instanceof Error ? imgErr.stack?.slice(0, 500) : undefined,
          },
          imgErr instanceof Error ? imgErr : undefined,
        );
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`access/connect: ${msg}`);
    logger.error(
      'api',
      'bulk_deploy.article.access_failed',
      {
        article_id: articleId,
        slug,
        error_message: msg,
        stack: err instanceof Error ? err.stack?.slice(0, 500) : undefined,
      },
      err instanceof Error ? err : undefined,
    );
  } finally {
    // P5-83: client.close() は同期だが念のため try で囲む。close() 失敗を握り潰さない。
    try {
      client.close();
    } catch (closeErr) {
      logger.warn('ftp', 'bulk_deploy.article.close_failed', {
        article_id: articleId,
        slug,
        error_message: closeErr instanceof Error ? closeErr.message : String(closeErr),
      });
    }
  }

  if (errors.length === 0) {
    logger.info('api', 'bulk_deploy.article.uploaded', {
      article_id: articleId,
      slug,
      index,
      total,
      uploaded: uploadedFiles,
      elapsed_ms: Date.now() - tArticle,
    });
  } else {
    logger.warn('api', 'bulk_deploy.article.partial_failed', {
      article_id: articleId,
      slug,
      index,
      total,
      uploaded: uploadedFiles,
      error_count: errors.length,
      errors,
      elapsed_ms: Date.now() - tArticle,
    });
  }

  return { uploadedFiles, errors };
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  logger.info('api', 'bulk_deploy.start', { elapsed_ms: 0 });

  try {
    // ─── Auth ────────────────────────────────────────────────────────────
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    // ─── 対象記事 SELECT ──────────────────────────────────────────────────
    const serviceClient = await createServiceRoleClient();
    const tFetch = Date.now();
    // P5-85: bulk-deploy は zero-mode (= 新規生成記事) のみを対象とする。
    // 旧アメブロ書換 (source / null) はライブサイトに掲載しない方針 (P5-55 で
    // hub-generator も同フィルタ済み)。両側のフィルタを揃えることで「ハブには
    // 出ないが FTP 上に放置」という不整合を恒久的に防ぐ。
    const { data: articlesRaw, error: selectErr } = await serviceClient
      .from('articles')
      .select('*')
      .in('visibility_state', ['live', 'live_hub_stale'])
      .eq('generation_mode', 'zero')
      .order('created_at', { ascending: true });
    if (selectErr) {
      logger.error(
        'api',
        'bulk_deploy.fetch_articles.failed',
        { error_message: selectErr.message, elapsed_ms: Date.now() - tFetch },
        selectErr instanceof Error ? selectErr : undefined,
      );
      return NextResponse.json(
        { error: `対象記事の取得に失敗しました: ${selectErr.message}` },
        { status: 500 },
      );
    }
    const articles = (articlesRaw ?? []) as unknown as Article[];
    const total = articles.length;
    logger.info('api', 'bulk_deploy.fetch_articles.end', {
      article_count: total,
      elapsed_ms: Date.now() - tFetch,
    });

    if (total === 0) {
      logger.info('api', 'bulk_deploy.end', {
        total: 0,
        success: 0,
        failed: 0,
        uploaded_files: 0,
        reason: 'no_articles',
        elapsed_ms: Date.now() - startedAt,
      });
      return NextResponse.json({
        total: 0,
        success: 0,
        failed: 0,
        uploaded_files: 0,
        errors: [],
        message: '対象記事は 0 件でした',
      });
    }

    // ─── FTP 設定取得 ─────────────────────────────────────────────────────
    const ftpConfig = await getFtpConfig();
    logger.info('api', 'bulk_deploy.ftp_config.end', {
      host: ftpConfig.host,
      port: ftpConfig.port,
      secure: ftpConfig.secure,
      remote_base_path: ftpConfig.remoteBasePath,
    });

    // ─── 記事ループ (per-article fresh connection) ────────────────────────
    let uploadedFiles = 0;
    let successCount = 0;
    let failedCount = 0;
    const errors: BulkDeployError[] = [];

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      const slug = article.slug ?? article.id;
      const articleId = article.id;
      const idx = i + 1;

      // P5-84: image_files の型ガード
      const imageFiles = parseImageFiles(article.image_files);

      // HTML 生成 (per-article deploy と共通ヘルパー)
      let html: string;
      try {
        html = buildDeployHtml(article).html;
      } catch (genErr) {
        const msg = genErr instanceof Error ? genErr.message : String(genErr);
        failedCount++;
        errors.push({ article_id: articleId, slug, message: `html_generate: ${msg}` });
        logger.error(
          'api',
          'bulk_deploy.article.html_generate_failed',
          { article_id: articleId, slug, error_message: msg },
          genErr instanceof Error ? genErr : undefined,
        );
        continue;
      }

      const result = await uploadArticleViaFtp(ftpConfig, article, html, imageFiles, idx, total);
      uploadedFiles += result.uploadedFiles;
      if (result.errors.length === 0) {
        successCount++;
      } else {
        failedCount++;
        errors.push({
          article_id: articleId,
          slug,
          message: result.errors.join(' | '),
        });
      }

      // 最終記事以外で sleep を挟む (lolipop スロットリング回避)
      if (i < articles.length - 1) {
        await sleep(SLEEP_BETWEEN_ARTICLES_MS);
      }
    }

    // ─── ハブページ再生成 (P5-83: await + try/catch で unhandledRejection 排除) ─
    const hubRebuildUrl = `${req.nextUrl.origin}/api/hub/deploy`;
    const tHubRebuild = Date.now();
    logger.info('api', 'bulk_deploy.hub_rebuild.start', {
      url: hubRebuildUrl,
      elapsed_ms: Date.now() - startedAt,
    });
    try {
      const hubRes = await fetch(hubRebuildUrl, {
        method: 'POST',
        headers: { cookie: req.headers.get('cookie') || '' },
      });
      logger.info('api', 'bulk_deploy.hub_rebuild.end', {
        ok: hubRes.ok,
        status: hubRes.status,
        elapsed_ms: Date.now() - tHubRebuild,
      });
    } catch (hubErr) {
      logger.warn('api', 'bulk_deploy.hub_rebuild.failed', {
        error_message: hubErr instanceof Error ? hubErr.message : String(hubErr),
        elapsed_ms: Date.now() - tHubRebuild,
      });
    }

    // ─── サマリログ + エラー dump (P5-78 継続) ────────────────────────────
    logger.info('api', 'bulk_deploy.end', {
      total,
      success: successCount,
      failed: failedCount,
      uploaded_files: uploadedFiles,
      error_count: errors.length,
      elapsed_ms: Date.now() - startedAt,
    });

    if (errors.length > 0) {
      console.error(
        `[BULK-DEPLOY-ERRORS] total=${total} failed=${failedCount} uploaded=${uploadedFiles}`,
      );
      for (const e of errors) {
        console.error(`[BULK-DEPLOY-ERROR] id=${e.article_id} slug=${e.slug} msg=${e.message}`);
      }
      logger.error('api', 'bulk_deploy.errors_dump', {
        total,
        failed: failedCount,
        success: successCount,
        uploaded_files: uploadedFiles,
        errors,
      });
    }

    return NextResponse.json({
      total,
      success: successCount,
      failed: failedCount,
      uploaded_files: uploadedFiles,
      errors,
      message: `${successCount}件成功 / ${failedCount}件失敗 (${uploadedFiles} ファイルアップロード)`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      'api',
      'bulk_deploy.failed',
      {
        error_message: message,
        stack: error instanceof Error ? error.stack?.slice(0, 500) : undefined,
        elapsed_ms: Date.now() - startedAt,
      },
      error instanceof Error ? error : undefined,
    );
    return NextResponse.json(
      { error: `一括 FTP デプロイに失敗しました: ${message}` },
      { status: 500 },
    );
  }
}
