// ============================================================================
// src/app/api/hub/rebuild/route.ts
// POST: ハブページ再生成API
//
// Supabaseからpublished記事を取得し、ハブページHTMLを全ページ生成する。
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  buildArticleCards,
  buildCategories,
  generateAllHubPages,
} from '@/lib/generators/hub-generator';
import { logger } from '@/lib/logger';

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

    logger.info('generator', 'ハブページ再生成開始');

    // published記事を取得
    const articles = await buildArticleCards();
    logger.info('generator', 'published記事取得完了', { count: articles.length });

    if (articles.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'published記事がありません',
        pages: 0,
        articles: 0,
      });
    }

    // カテゴリ集計
    const categories = buildCategories(articles);

    // 全ページHTML生成
    const pages = generateAllHubPages(articles, categories);
    logger.info('generator', 'ハブページHTML生成完了', { pages: pages.length });

    return NextResponse.json({
      success: true,
      message: `${pages.length}ページのハブページを生成しました`,
      pages: pages.length,
      articles: articles.length,
      generatedFiles: pages.map((p) => p.path),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('generator', 'ハブページ生成エラー', { error: message });
    return NextResponse.json(
      { error: `ハブページ生成に失敗しました: ${message}` },
      { status: 500 },
    );
  }
}
