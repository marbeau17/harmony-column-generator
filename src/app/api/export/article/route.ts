// POST /api/export/article
// Body: { articleId?: string } - if omitted, export all published articles
// Exports article HTML + images to local out/ directory

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { exportArticleToOut, exportHubPageToOut, exportAllToOut } from '@/lib/export/static-exporter';
import { logger } from '@/lib/logger';

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  if (process.env.VERCEL) {
    return NextResponse.json(
      { error: 'エクスポートはローカル環境でのみ実行可能です', success: false },
      { status: 400 },
    );
  }

  try {
    // Auth check
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { articleId } = body;

    if (articleId) {
      // Export single article + rebuild hub
      const articleResult = await exportArticleToOut(articleId);
      const hubResult = await exportHubPageToOut();

      logger.info('export', 'article-exported', { slug: articleResult.slug, files: articleResult.files.length });

      return NextResponse.json({
        success: true,
        article: articleResult,
        hub: hubResult,
      });
    } else {
      // Export all
      const result = await exportAllToOut();

      logger.info('export', 'all-exported', { articles: result.articles, files: result.files.length });

      return NextResponse.json({
        success: true,
        exported: result.articles,
        fileCount: result.files.length,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('export', 'export-error', { error: message });
    return NextResponse.json({ error: `エクスポートに失敗しました: ${message}` }, { status: 500 });
  }
}
