// ============================================================================
// src/app/api/articles/bulk-deploy/route.ts
// 全記事一括 FTP デプロイ — 設定ページの「全記事を FTP にアップロード」ボタンから呼ばれる。
//
// 背景: visibility_state IN ('live', 'live_hub_stale') の記事が DB 上 36 件
// あるのに対し、harmony-mc.com/spiritual/column/ で実際に表示できているのは 2 件のみ。
// scripts/redeploy-all-articles.ts と同じロジックを UI から実行できるようにする。
//
// 設計方針:
//  - per-article ルート (src/app/api/articles/[id]/deploy/route.ts) と HTML 生成
//    ロジックを完全に揃えるため、buildDeployHtml() を共有ヘルパーから import。
//  - FTP 接続は全記事で 1 本に集約 (per-article ルートのように毎回接続しない)。
//  - 各記事のフェーズで silent failure を生まないよう logger.info 多重打ち。
//  - hub 再生成は全記事アップロード完了後にバックグラウンドで 1 度だけ trigger。
// ============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { buildDeployHtml } from '@/lib/deploy/article-html-builder';
import { getFtpConfig } from '@/lib/deploy/ftp-uploader';
import { attachFtpWireLogger } from '@/lib/deploy/ftp-wire-logger';
import { logger } from '@/lib/logger';
import type { Article } from '@/types/article';

export const maxDuration = 300;

// P5-79: lolipop.jp は長時間連続セッションを silent にドロップする挙動が確認された
//   (hub-deploy=毎回 fresh connection は成功 / bulk-deploy=1 connection 維持で全 35 件失敗)。
//   1 記事ごとに FTP を張り直すことで挙動を hub-deploy と揃え、信頼性を担保する。
//   旧値: 5 (P5-75)
const RECONNECT_EVERY_N_ARTICLES = 1;

// P5-75: モジュールスコープでのフェイルセーフ — unhandledRejection を必ずログに残す。
// 二重登録を防ぐため _bulkDeployHandlerRegistered フラグでガード。
declare global {
  // eslint-disable-next-line no-var
  var _bulkDeployHandlerRegistered: boolean | undefined;
}
if (!globalThis._bulkDeployHandlerRegistered) {
  globalThis._bulkDeployHandlerRegistered = true;
  process.on('unhandledRejection', (reason) => {
    logger.error('ftp', 'bulk_deploy.unhandled_rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack?.slice(0, 500) : undefined,
    });
  });
}

// P5-75: FTP 再接続ヘルパ。loop の chunk 境界で client を張り直す際に共通利用。
async function connectFtp(
  ftpConfig: { host: string; user: string; password: string; port?: number; secure?: boolean },
  articleId?: string,
) {
  const { Client } = await import('basic-ftp');
  const { attachFtpWireLogger } = await import('@/lib/deploy/ftp-wire-logger');
  // P5-75: idle/control timeouts — long for serverless, but bounded.
  // basic-ftp の Client コンストラクタ第1引数で 60s を渡す (ftp.timeout は readonly)。
  const c = new Client(60000); // ← 60s per command (basic-ftp default は 30s)
  // P5-77: FTP wire-level (PROTOCOL) transaction を logger 経由で出力。
  // verbose=true + log override で USER/PASS/PASV/STOR/サーバ応答コード等が見える。
  attachFtpWireLogger(c, { where: 'bulk_deploy', article_id: articleId });
  logger.info('ftp', 'bulk_deploy.ftp.reconnect.attempt', {
    host: ftpConfig.host,
    port: ftpConfig.port || 21,
    article_id: articleId,
  });
  const tConn = Date.now();
  await c.access({
    host: ftpConfig.host,
    user: ftpConfig.user,
    password: ftpConfig.password,
    port: ftpConfig.port || 21,
    secure: ftpConfig.secure || false,
  });
  logger.info('ftp', 'bulk_deploy.ftp.reconnect.ok', {
    elapsed_ms: Date.now() - tConn,
    article_id: articleId,
  });
  return c;
}

interface BulkDeployError {
  article_id: string;
  slug: string;
  message: string;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();

  // 関数入口 — silent failure 防止のため必ず entered ログ
  logger.info('api', 'bulk_deploy.start', {
    elapsed_ms: 0,
  });

  try {
    // ─── Auth ────────────────────────────────────────────────────────────
    const tAuth = Date.now();
    logger.info('api', 'bulk_deploy.auth.start', {
      elapsed_ms: Date.now() - startedAt,
    });
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      logger.warn('api', 'bulk_deploy.auth.failed', {
        reason: 'no_user',
        elapsed_ms: Date.now() - startedAt,
      });
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }
    logger.info('api', 'bulk_deploy.auth.end', {
      user_id: user.id,
      elapsed_ms: Date.now() - tAuth,
    });

    // ─── 対象記事 SELECT ──────────────────────────────────────────────────
    const serviceClient = await createServiceRoleClient();
    const tFetch = Date.now();
    logger.info('api', 'bulk_deploy.fetch_articles.start', {
      elapsed_ms: Date.now() - startedAt,
    });
    const { data: articlesRaw, error: selectErr } = await serviceClient
      .from('articles')
      .select('*')
      .in('visibility_state', ['live', 'live_hub_stale'])
      .order('created_at', { ascending: true });
    if (selectErr) {
      logger.error(
        'api',
        'bulk_deploy.fetch_articles.failed',
        {
          error_message: selectErr.message,
          elapsed_ms: Date.now() - tFetch,
        },
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
    const tFtpConfig = Date.now();
    logger.info('api', 'bulk_deploy.ftp_config.start', {
      elapsed_ms: Date.now() - startedAt,
    });
    const ftpConfig = await getFtpConfig();
    logger.info('api', 'bulk_deploy.ftp_config.end', {
      host: ftpConfig.host,
      port: ftpConfig.port,
      secure: ftpConfig.secure,
      remote_base_path: ftpConfig.remoteBasePath,
      elapsed_ms: Date.now() - tFtpConfig,
    });

    // ─── FTP 接続 (チャンク境界で張り直す。初回はここで作成) ───────────────
    // P5-75: const → let. RECONNECT_EVERY_N_ARTICLES ごとに client を close → 再接続するため。
    const { Client } = await import('basic-ftp');
    const { Readable } = await import('stream');
    // P5-75: Client(60000) = 60s timeout (basic-ftp default は 30s)。ftp.timeout は readonly のためコンストラクタ経由。
    let client = new Client(60000);
    // P5-77: 初回 client にも wire logger 装着 (connectFtp ヘルパーは reconnect 時のみ呼ばれるため)
    attachFtpWireLogger(client, { where: 'bulk_deploy.initial' });
    client.ftp.verbose = false;

    const tFtpConnect = Date.now();
    logger.info('api', 'bulk_deploy.ftp_connect.start', {
      host: ftpConfig.host,
      port: ftpConfig.port || 21,
      secure: ftpConfig.secure || false,
      elapsed_ms: Date.now() - startedAt,
    });
    await client.access({
      host: ftpConfig.host,
      user: ftpConfig.user,
      password: ftpConfig.password,
      port: ftpConfig.port || 21,
      secure: ftpConfig.secure || false,
    });
    logger.info('api', 'bulk_deploy.ftp_connect.end', {
      elapsed_ms: Date.now() - tFtpConnect,
    });

    const basePath = ftpConfig.remoteBasePath;
    let uploadedFiles = 0;
    let successCount = 0;
    let failedCount = 0;
    let processedArticles = 0; // finally ブロックで参照するため for ループ外に保持
    const errors: BulkDeployError[] = [];

    try {
      // ─── 記事ループ ─────────────────────────────────────────────────────
      for (let i = 0; i < articles.length; i++) {
        processedArticles = i;
        const article = articles[i];
        const slug = article.slug ?? article.id;
        const articleId = article.id;
        const idx = i + 1;
        const tArticle = Date.now();

        // P5-75: 一定件数ごとに FTP セッションを張り直す (control socket idle timeout 回避)。
        if (i > 0 && i % RECONNECT_EVERY_N_ARTICLES === 0) {
          logger.info('ftp', 'bulk_deploy.chunk_boundary', {
            processed: i,
            total,
            reconnecting: true,
            article_id: articleId,
            slug,
          });
          try {
            client.close();
          } catch (closeErr) {
            logger.warn('ftp', 'bulk_deploy.chunk_close.failed', {
              error_message: closeErr instanceof Error ? closeErr.message : String(closeErr),
              processed: i,
            });
          }
          try {
            client = await connectFtp(ftpConfig, articleId);
          } catch (reconnErr) {
            logger.error(
              'ftp',
              'bulk_deploy.chunk_reconnect.failed',
              {
                error_message: reconnErr instanceof Error ? reconnErr.message : String(reconnErr),
                stack: reconnErr instanceof Error ? reconnErr.stack?.slice(0, 500) : undefined,
                processed: i,
                total,
              },
              reconnErr instanceof Error ? reconnErr : undefined,
            );
            throw reconnErr; // ループ try/catch ではなく外側 try で全体停止させる
          }
        }

        logger.info('api', 'bulk_deploy.article.start', {
          article_id: articleId,
          slug,
          index: idx,
          total,
          visibility_state: article.visibility_state,
          elapsed_ms: Date.now() - startedAt,
        });

        const articleErrors: string[] = [];
        let articleUploaded = 0;

        try {
          // 1. HTML 生成 (共有ヘルパー)
          const { html } = buildDeployHtml(article);
          logger.info('api', 'bulk_deploy.article.html_generated', {
            article_id: articleId,
            slug,
            chars: html.length,
            elapsed_ms: Date.now() - tArticle,
          });

          // 2. index.html upload
          const htmlRemote = `${basePath}${slug}/index.html`;
          try {
            logger.info('ftp', 'bulk_deploy.ftp.ensure_dir.attempt', {
              article_id: articleId,
              slug,
              remote_dir: `${basePath}${slug}/`,
              index: idx,
              total,
            });
            await client.ensureDir(`${basePath}${slug}/`);
            logger.info('ftp', 'bulk_deploy.ftp.ensure_dir.ok', {
              article_id: articleId,
              slug,
              elapsed_ms: Date.now() - tArticle,
            });

            logger.info('ftp', 'bulk_deploy.ftp.cd.attempt', {
              article_id: articleId,
              slug,
              target: '/',
            });
            await client.cd('/');
            logger.info('ftp', 'bulk_deploy.ftp.cd.ok', {
              article_id: articleId,
              slug,
            });

            const htmlStream = Readable.from(Buffer.from(html, 'utf-8'));
            logger.info('ftp', 'bulk_deploy.ftp.upload_from.attempt', {
              article_id: articleId,
              slug,
              remote_path: htmlRemote,
              kind: 'html',
              bytes: html.length,
            });
            const tUpload = Date.now();
            await client.uploadFrom(htmlStream, htmlRemote);
            logger.info('ftp', 'bulk_deploy.ftp.upload_from.ok', {
              article_id: articleId,
              slug,
              remote_path: htmlRemote,
              kind: 'html',
              bytes: html.length,
              elapsed_ms: Date.now() - tUpload,
            });
            articleUploaded++;
            uploadedFiles++;
          } catch (htmlErr) {
            const msg = `index.html: ${htmlErr instanceof Error ? htmlErr.message : String(htmlErr)}`;
            articleErrors.push(msg);
            logger.error(
              'api',
              'bulk_deploy.article.html_upload_failed',
              {
                article_id: articleId,
                slug,
                remote_path: htmlRemote,
                error_message: msg,
                stack: htmlErr instanceof Error ? htmlErr.stack?.slice(0, 500) : undefined,
                elapsed_ms: Date.now() - tArticle,
              },
              htmlErr instanceof Error ? htmlErr : undefined,
            );
          }

          // 3. 画像 (hero/body/summary) upload
          const imageFiles = Array.isArray(article.image_files)
            ? (article.image_files as { url: string; position: string; alt?: string }[])
            : [];
          for (const img of imageFiles) {
            if (!img.url) continue;
            const filename = img.position ? `${img.position}.jpg` : 'image.jpg';
            const imgRemote = `${basePath}${slug}/images/${filename}`;
            try {
              logger.info('ftp', 'bulk_deploy.image.fetch.attempt', {
                article_id: articleId,
                slug,
                position: img.position,
                url: img.url,
              });
              const res = await fetch(img.url);
              logger.info('ftp', 'bulk_deploy.image.fetch.end', {
                article_id: articleId,
                slug,
                position: img.position,
                ok: res.ok,
                status: res.status,
              });
              if (!res.ok) {
                const msg = `${img.position}: HTTP ${res.status}`;
                articleErrors.push(msg);
                logger.warn('api', 'bulk_deploy.article.image_fetch_failed', {
                  article_id: articleId,
                  slug,
                  position: img.position,
                  status: res.status,
                  url: img.url,
                });
                continue;
              }
              const buf = Buffer.from(await res.arrayBuffer());
              logger.info('ftp', 'bulk_deploy.ftp.image.ensure_dir.attempt', {
                article_id: articleId,
                slug,
                remote_dir: `${basePath}${slug}/images/`,
              });
              await client.ensureDir(`${basePath}${slug}/images/`);
              logger.info('ftp', 'bulk_deploy.ftp.image.ensure_dir.ok', {
                article_id: articleId,
                slug,
              });
              await client.cd('/');
              const stream = Readable.from(buf);
              logger.info('ftp', 'bulk_deploy.ftp.image.upload_from.attempt', {
                article_id: articleId,
                slug,
                position: img.position,
                remote_path: imgRemote,
                bytes: buf.length,
              });
              const tImgUpload = Date.now();
              await client.uploadFrom(stream, imgRemote);
              logger.info('ftp', 'bulk_deploy.ftp.image.upload_from.ok', {
                article_id: articleId,
                slug,
                position: img.position,
                remote_path: imgRemote,
                bytes: buf.length,
                elapsed_ms: Date.now() - tImgUpload,
              });
              articleUploaded++;
              uploadedFiles++;
            } catch (imgErr) {
              const msg = `${img.position}: ${imgErr instanceof Error ? imgErr.message : String(imgErr)}`;
              articleErrors.push(msg);
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

          if (articleErrors.length === 0) {
            successCount++;
            logger.info('api', 'bulk_deploy.article.uploaded', {
              article_id: articleId,
              slug,
              index: idx,
              total,
              uploaded: articleUploaded,
              errors: 0,
              elapsed_ms: Date.now() - tArticle,
            });
          } else {
            failedCount++;
            errors.push({
              article_id: articleId,
              slug,
              message: articleErrors.join(' | '),
            });
            logger.warn('api', 'bulk_deploy.article.partial_failed', {
              article_id: articleId,
              slug,
              index: idx,
              total,
              uploaded: articleUploaded,
              error_count: articleErrors.length,
              errors: articleErrors,
              elapsed_ms: Date.now() - tArticle,
            });
          }
        } catch (articleErr) {
          failedCount++;
          const msg = articleErr instanceof Error ? articleErr.message : String(articleErr);
          errors.push({ article_id: articleId, slug, message: msg });
          logger.error(
            'api',
            'bulk_deploy.article.failed',
            {
              article_id: articleId,
              slug,
              index: idx,
              total,
              error_message: msg,
              stack: articleErr instanceof Error ? articleErr.stack?.slice(0, 500) : undefined,
              elapsed_ms: Date.now() - tArticle,
            },
            articleErr instanceof Error ? articleErr : undefined,
          );
          // 1 件の失敗で全体停止しない
        }
      }
    } finally {
      logger.info('ftp', 'bulk_deploy.ftp_close.attempt', {
        processed_articles: processedArticles + 1,
        total,
        elapsed_ms: Date.now() - startedAt,
      });
      client.close();
      logger.info('ftp', 'bulk_deploy.ftp_close.ok', {
        elapsed_ms: Date.now() - startedAt,
      });
    }

    // ─── ハブページ再生成を background trigger ────────────────────────────
    const hubRebuildUrl = `${req.nextUrl.origin}/api/hub/deploy`;
    const tHubRebuild = Date.now();
    logger.info('api', 'bulk_deploy.hub_rebuild.start', {
      url: hubRebuildUrl,
      elapsed_ms: Date.now() - startedAt,
    });
    fetch(hubRebuildUrl, {
      method: 'POST',
      headers: { cookie: req.headers.get('cookie') || '' },
    })
      .then((r) =>
        logger.info('api', 'bulk_deploy.hub_rebuild.end', {
          ok: r.ok,
          status: r.status,
          elapsed_ms: Date.now() - tHubRebuild,
        }),
      )
      .catch((err) =>
        logger.warn('api', 'bulk_deploy.hub_rebuild.failed', {
          error_message: err instanceof Error ? err.message : String(err),
          elapsed_ms: Date.now() - tHubRebuild,
        }),
      );

    logger.info('api', 'bulk_deploy.end', {
      total,
      success: successCount,
      failed: failedCount,
      uploaded_files: uploadedFiles,
      error_count: errors.length,
      elapsed_ms: Date.now() - startedAt,
    });

    // P5-75: return 直前のスタンプ。関数が確実に return まで到達したことを Vercel log で確認するため。
    logger.info('api', 'bulk_deploy.summary_before_return', {
      total,
      success: successCount,
      failed: failedCount,
      uploaded_files: uploadedFiles,
      error_count: errors.length,
      elapsed_ms: Date.now() - startedAt,
    });

    // ─── P5-78: 全エラーを 1 ログ + 生 stdout で必ず可読化 ─────────────────
    // Vercel ログ検索が JSON 内部キーを取りこぼすため、平文 message を
    // 改行区切りで ALL DUMP して console.error stdout 直書き。
    if (errors.length > 0) {
      const headline = `[BULK-DEPLOY-ERRORS] total=${total} failed=${failedCount} uploaded=${uploadedFiles}`;
      console.error(headline);
      for (const e of errors) {
        // 1 行 = 1 記事のエラー (id, slug, full message)
        console.error(`[BULK-DEPLOY-ERROR] id=${e.article_id} slug=${e.slug} msg=${e.message}`);
      }
      // 構造化ログ側にも 1 ペイロードでまとめて格納 (errors 配列を完全保持)
      logger.error('api', 'bulk_deploy.errors_dump', {
        total,
        failed: failedCount,
        success: successCount,
        uploaded_files: uploadedFiles,
        // 35 件全部の {article_id, slug, message} を含む
        errors,
      });
      // Vercel runtime log で「最初の失敗の生メッセージ」を即特定するための
      // 単独 error log。複数行ある中で最も読みやすい。
      logger.error('api', 'bulk_deploy.first_error_for_diagnosis', {
        article_id: errors[0].article_id,
        slug: errors[0].slug,
        message: errors[0].message,
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
