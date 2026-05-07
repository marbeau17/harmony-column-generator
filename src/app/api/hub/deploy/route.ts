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
import { createServerSupabaseClient } from '@/lib/supabase/server';
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
  const requestId = `ftp_${startedAt}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    // G4: API 受信ログ (silent failure 排除のための入口計測)
    logger.info('ftp', 'deploy.api.received', {
      request_id: requestId,
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
    logger.info('ftp', 'deploy.prepare_files.end', {
      request_id: requestId,
      file_count: files.length,
      elapsed_ms: Date.now() - prepStart,
    });

    // ── 3. FTPアップロード ───────────────────────────────────────────────

    logger.info('ftp', 'deploy.config.start', { request_id: requestId });
    const cfgStart = Date.now();
    let ftpConfig;
    try {
      ftpConfig = await getFtpConfig();
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
    const result = await uploadToFtp(ftpConfig, files);
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

    logger.info('api', 'hub_deploy.end', {
      request_id: requestId,
      success: true,
      pages: pages.length,
      articles: articles.length,
      uploaded: result.uploaded,
      total: files.length,
      elapsed_ms: durationMs,
    });

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
