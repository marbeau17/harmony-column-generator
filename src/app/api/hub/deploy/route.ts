// ============================================================================
// src/app/api/hub/deploy/route.ts
// POST: ハブページFTPデプロイAPI
//
// ハブページHTMLを生成し、FTPサーバーにアップロードする。
// CSS/JSファイルも含めて一括デプロイ。
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

// Vercel Serverless 最大実行時間を120秒に設定
export const maxDuration = 120;

export async function POST() {
  try {
    // 認証チェック
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    logger.info('deploy', 'ハブページデプロイ開始');

    // ── 1. HTML生成 ──────────────────────────────────────────────────────

    const articles = await buildArticleCards();
    logger.info('deploy', 'published記事取得完了', { count: articles.length });

    if (articles.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'published記事がないためデプロイをスキップしました',
        pages: 0,
        articles: 0,
        uploaded: 0,
      });
    }

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
      return NextResponse.json(
        {
          error: 'FTP設定エラー',
          ...(process.env.NODE_ENV === 'development' ? { detail: message } : {}),
        },
        { status: 500 },
      );
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
    }

    logger.info('deploy', 'FTPアップロード完了', {
      uploaded: result.uploaded,
      total: files.length,
    });

    return NextResponse.json({
      success: result.success,
      message: result.success
        ? `${result.uploaded}ファイルをデプロイしました`
        : `デプロイに一部エラーがあります`,
      pages: pages.length,
      articles: articles.length,
      uploaded: result.uploaded,
      totalFiles: files.length,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('deploy', 'ハブページデプロイエラー', { error: message });
    return NextResponse.json(
      {
        error: 'デプロイに失敗しました',
        ...(process.env.NODE_ENV === 'development' ? { detail: message } : {}),
      },
      { status: 500 },
    );
  }
}
