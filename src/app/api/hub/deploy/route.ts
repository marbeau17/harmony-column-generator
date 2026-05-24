// ============================================================================
// src/app/api/hub/deploy/route.ts
// POST: ハブページFTPデプロイAPI
//
// ハブページHTMLを生成し、FTPサーバーにアップロードする。
// CSS/JSファイルも含めて一括デプロイ。
//
// Response contract: see docs/specs/hub-rebuild-guarantee.md §4.3
// Failures ride in the body with HTTP 200 so the client has a uniform path.
// ============================================================================

import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import {
  buildArticleCards,
  buildCategories,
  generateAllHubPages,
} from '@/lib/generators/hub-generator';
import {
  uploadToFtp,
  getFtpConfig,
  type UploadFile,
} from '@/lib/deploy/ftp-uploader';
import { logger } from '@/lib/logger';
import type {
  HubDeployFailure,
  HubDeploySuccess,
} from '@/types/hub-deploy';

// Vercel Serverless 最大実行時間を120秒に設定
export const maxDuration = 120;

function fail(
  stage: HubDeployFailure['stage'],
  error: string,
  detail: string | undefined,
  startedAt: number,
): NextResponse {
  return NextResponse.json<HubDeployFailure>(
    { success: false, error, stage, detail, durationMs: Date.now() - startedAt },
    { status: 200 },
  );
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  // G4: request_id を発行し button → API → service の経路を ID で追跡可能にする。
  // Journey-marker: 上流 (Journey A の visibility / Journey B の bulk-deploy) が
  // X-Trace-Id ヘッダで trace_id を渡してきた場合はそれを request_id として採用し、
  // grep ('request_id":"<trace_id>"') で全 server log を 1 列に並べられるようにする。
  const traceIdHeader = request.headers.get('x-trace-id');
  const requestId = traceIdHeader ?? `ftp_${startedAt}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    // G4: API 受信ログ (silent failure 排除のための入口計測)
    logger.info('ftp', '[hub] deploy.api.received', {
      request_id: requestId,
      trace_id_source: traceIdHeader ? 'upstream' : 'self_generated',
      method: 'POST',
      url: request.url,
      content_type: request.headers.get('content-type') ?? null,
    });

    // 認証チェック
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      // G4: auth 失敗を ftp 名前空間で明示
      logger.warn('ftp', 'deploy.api.auth_required', { request_id: requestId });
      return fail('auth', '認証が必要です', undefined, startedAt);
    }

    logger.info('ftp', 'deploy.api.authenticated', {
      request_id: requestId,
      user_id: user.id,
    });

    // ── 1. HTML生成 ──────────────────────────────────────────────────────

    logger.info('ftp', 'deploy.generate.articles.start', {
      request_id: requestId,
    });
    const articlesStart = Date.now();
    const articles = await buildArticleCards();
    logger.info('ftp', 'deploy.generate.articles_loaded', {
      request_id: requestId,
      article_count: articles.length,
      elapsed_ms: Date.now() - articlesStart,
    });

    // 0件でもハブを再生成する（spec §6.3.2）— 古いハブが残るのを防ぐ。
    logger.info('ftp', 'deploy.generate.pages.start', {
      request_id: requestId,
      article_count: articles.length,
    });
    const genStart = Date.now();
    const categories = buildCategories(articles);
    const pages = generateAllHubPages(articles, categories);
    const totalHtmlChars = pages.reduce((sum, p) => sum + (p.html?.length ?? 0), 0);
    logger.info('ftp', 'deploy.generate.pages_built', {
      request_id: requestId,
      page_count: pages.length,
      category_count: categories.length,
      total_html_chars: totalHtmlChars,
      elapsed_ms: Date.now() - genStart,
    });

    // ── 2. アップロードファイル準備 ──────────────────────────────────────

    logger.info('ftp', 'deploy.prepare_files.start', {
      request_id: requestId,
      page_count: pages.length,
    });
    const prepStart = Date.now();
    const files: UploadFile[] = [];

    // ハブページHTML
    for (const page of pages) {
      files.push({
        remotePath: page.path,
        content: page.html,
      });
    }

    // 静的アセット (hub.css / hub.js) を毎回 idempotent に push する。
    // 記事 HTML が <link href="../../css/hub.css"> / <script src="../../js/hub.js">
    // を参照するため、remoteBasePath=/spiritual/column/ から見て ../css /../js に置く
    // (実 URL: /spiritual/css/hub.css, /spiritual/js/hub.js)。
    // 2026-05-24: /spiritual/js/hub.js が一度も deploy されておらず 404 になっていた
    //             バグへの恒久対処。next.config.js の outputFileTracingIncludes で
    //             templates/hub/** を lambda bundle に含めている前提。
    const STATIC_ASSETS = [
      { src: 'templates/hub/css/hub.css', remotePath: '../css/hub.css' },
      { src: 'templates/hub/js/hub.js', remotePath: '../js/hub.js' },
    ] as const;
    let staticAssetCount = 0;
    for (const a of STATIC_ASSETS) {
      const abs = path.join(process.cwd(), a.src);
      try {
        if (fs.existsSync(abs)) {
          const content = fs.readFileSync(abs, 'utf-8');
          files.push({ remotePath: a.remotePath, content });
          staticAssetCount++;
          logger.info('ftp', 'deploy.static_asset.queued', {
            request_id: requestId,
            src: a.src,
            remote_path: a.remotePath,
            bytes: Buffer.byteLength(content, 'utf-8'),
          });
        } else {
          logger.warn('ftp', 'deploy.static_asset.missing', {
            request_id: requestId,
            src: a.src,
            abs_path: abs,
          });
        }
      } catch (e) {
        logger.warn('ftp', 'deploy.static_asset.read_failed', {
          request_id: requestId,
          src: a.src,
          error_message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    logger.info('ftp', 'deploy.prepare_files.end', {
      request_id: requestId,
      file_count: files.length,
      static_asset_count: staticAssetCount,
      elapsed_ms: Date.now() - prepStart,
    });

    // ── 3. FTPアップロード ───────────────────────────────────────────────

    logger.info('ftp', 'deploy.config.start', { request_id: requestId });
    const cfgStart = Date.now();
    let ftpConfig;
    try {
      // P5-72: Agents 1/2 と命名規約を揃えた attempt/ok ペアを追加 (cross-route の grep 容易性)
      logger.info('ftp', 'hub_deploy.ftp.get_config.attempt', {
        request_id: requestId,
      });
      const tGetConfig = Date.now();
      ftpConfig = await getFtpConfig();
      logger.info('ftp', 'hub_deploy.ftp.get_config.ok', {
        request_id: requestId,
        elapsed_ms: Date.now() - tGetConfig,
      });
      logger.info('ftp', 'deploy.config.loaded', {
        request_id: requestId,
        host: ftpConfig.host,
        port: ftpConfig.port,
        remote_base_path: ftpConfig.remoteBasePath,
        elapsed_ms: Date.now() - cfgStart,
        // 認証情報は出力しない (host/port/path のみ)
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack?.slice(0, 500) : undefined;
      // G4: 設定不足が「最も多い silent failure 原因」のため詳細を残す
      logger.error(
        'ftp',
        'deploy.config.failed',
        {
          request_id: requestId,
          error_message: message,
          stack,
          elapsed_ms: Date.now() - cfgStart,
        },
        err,
      );
      return fail('ftp', 'FTP設定エラー', message, startedAt);
    }

    logger.info('ftp', 'deploy.upload.start', {
      request_id: requestId,
      host: ftpConfig.host,
      port: ftpConfig.port,
      remote_base_path: ftpConfig.remoteBasePath,
      file_count: files.length,
      dry_run: process.env.FTP_DRY_RUN === 'true',
    });

    const uploadStart = Date.now();
    // P5-72: bulk-deploy / per-article deploy と揃えた attempt/ok ペア
    // (uploadToFtp 内部の client.access/ensureDir/uploadFrom/close は ftp-uploader 側で計測する)
    logger.info('ftp', 'hub_deploy.ftp.upload_to_ftp.attempt', {
      request_id: requestId,
      host: ftpConfig.host,
      port: ftpConfig.port,
      remote_base_path: ftpConfig.remoteBasePath,
      file_count: files.length,
    });
    const result = await uploadToFtp(ftpConfig, files);
    logger.info('ftp', 'hub_deploy.ftp.upload_to_ftp.ok', {
      request_id: requestId,
      uploaded: result.uploaded,
      success: result.success,
      error_count: result.errors.length,
      elapsed_ms: Date.now() - uploadStart,
    });
    const uploadElapsed = Date.now() - uploadStart;

    if (!result.success) {
      logger.error(
        'ftp',
        'deploy.upload.partial_failed',
        {
          request_id: requestId,
          uploaded: result.uploaded,
          total: files.length,
          error_count: result.errors.length,
          // 個別エラーは最初の 10 件のみ (ログ肥大化防止)
          errors_head: result.errors.slice(0, 10),
          elapsed_ms: uploadElapsed,
        },
      );
      logger.info('api', 'hub_deploy.end', {
        request_id: requestId,
        success: false,
        stage: 'ftp',
        uploaded: result.uploaded,
        total: files.length,
        elapsed_ms: Date.now() - startedAt,
      });
      return fail(
        'ftp',
        'FTPアップロードエラー',
        result.errors.join('; '),
        startedAt,
      );
    }

    const durationMs = Date.now() - startedAt;
    logger.info('ftp', 'deploy.upload.end', {
      request_id: requestId,
      uploaded: result.uploaded,
      total: files.length,
      duration_ms: durationMs,
      elapsed_ms: uploadElapsed,
    });

    logger.info('api', '[hub] hub_deploy.end', {
      request_id: requestId,
      success: true,
      pages: pages.length,
      articles: articles.length,
      uploaded: result.uploaded,
      total: files.length,
      elapsed_ms: durationMs,
    });

    // P5-110: ハブ再生成自体を publish_events に記録 (記事個別ではなく hub 全体イベント)。
    // article_id は NULL、reason に集計値を入れて後追い可能にする。
    try {
      const serviceClient = await createServiceRoleClient();
      await serviceClient.from('publish_events').insert({
        article_id: null,
        action: 'hub_deploy',
        actor_email: user.email ?? 'unknown',
        request_id: requestId,
        reason: `pages=${pages.length} articles=${articles.length} uploaded=${result.uploaded}`,
        hub_deploy_status: 'ok',
      });
    } catch (e) {
      logger.warn('api', 'hub_deploy.publish_event_insert_threw', {
        request_id: requestId,
        error_message: e instanceof Error ? e.message : String(e),
      });
    }

    return NextResponse.json<HubDeploySuccess>({
      success: true,
      pages: pages.length,
      articles: articles.length,
      uploaded: result.uploaded,
      durationMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack?.slice(0, 500) : undefined;
    logger.error(
      'ftp',
      'deploy.api.unexpected_failed',
      {
        request_id: requestId,
        error_message: message,
        stack,
        elapsed_ms: Date.now() - startedAt,
      },
      err,
    );
    return fail('unknown', 'デプロイに失敗しました', message, startedAt);
  }
}
