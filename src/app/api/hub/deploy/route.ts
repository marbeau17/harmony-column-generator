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

export async function POST() {
  const startedAt = Date.now();
  try {
    // 認証チェック
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return fail('auth', '認証が必要です', undefined, startedAt);
    }

    logger.info('deploy', 'ハブページデプロイ開始');

    // ── 1. HTML生成 ──────────────────────────────────────────────────────

    const articles = await buildArticleCards();
    logger.info('deploy', 'published記事取得完了', { count: articles.length });

    // 0件でもハブを再生成する（spec §6.3.2）— 古いハブが残るのを防ぐ。
    const categories = buildCategories(articles);
    const pages = generateAllHubPages(articles, categories);
    logger.info('deploy', 'ハブページHTML生成完了', { pages: pages.length });

    // ── 2. アップロードファイル準備 ──────────────────────────────────────

    const files: UploadFile[] = [];

    // ハブページHTML
    for (const page of pages) {
      files.push({
        remotePath: page.path,
        content: page.html,
      });
    }

    // ── 3. FTPアップロード ───────────────────────────────────────────────

    let ftpConfig;
    try {
      ftpConfig = await getFtpConfig();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('deploy', 'FTP設定エラー', { error: message });
      return fail('ftp', 'FTP設定エラー', message, startedAt);
    }

    logger.info('deploy', 'FTPアップロード開始', {
      host: ftpConfig.host,
      fileCount: files.length,
    });

    const result = await uploadToFtp(ftpConfig, files);

    if (!result.success) {
      logger.error('deploy', 'FTPアップロード一部エラー', {
        errors: result.errors,
      });
      return fail(
        'ftp',
        'FTPアップロードエラー',
        result.errors.join('; '),
        startedAt,
      );
    }

    const durationMs = Date.now() - startedAt;
    logger.info('deploy', 'FTPアップロード完了', {
      uploaded: result.uploaded,
      total: files.length,
      durationMs,
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
    logger.error('deploy', 'ハブページデプロイエラー', { error: message });
    return fail('unknown', 'デプロイに失敗しました', message, startedAt);
  }
}
