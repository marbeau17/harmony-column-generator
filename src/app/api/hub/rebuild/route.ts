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

// Vercel Serverless 最大実行時間を60秒に設定
export const maxDuration = 60;

export async function POST(request: Request) {
  const startedAt = Date.now();
  // request_id を発行し sidebar → API → generator の経路を ID で追跡可能にする。
  const requestId = `hubrb_${startedAt}_${Math.random().toString(36).slice(2, 8)}`;

  logger.info('api', 'hub_rebuild.start', {
    request_id: requestId,
    method: 'POST',
    url: request.url,
    content_type: request.headers.get('content-type') ?? null,
  });

  try {
    // ── 認証チェック ────────────────────────────────────────────────────
    logger.info('api', 'hub_rebuild.auth.start', { request_id: requestId });
    const authStart = Date.now();
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      logger.warn('api', 'hub_rebuild.auth.unauthenticated', {
        request_id: requestId,
        elapsed_ms: Date.now() - authStart,
      });
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    logger.info('api', 'hub_rebuild.auth.end', {
      request_id: requestId,
      user_id: user.id,
      user_present: true,
      elapsed_ms: Date.now() - authStart,
    });

    // ── published記事の取得 ───────────────────────────────────────────────
    logger.info('generator', 'hub_rebuild.fetch_articles.start', {
      request_id: requestId,
    });
    const fetchStart = Date.now();
    const articles = await buildArticleCards();
    logger.info('generator', 'hub_rebuild.fetch_articles.end', {
      request_id: requestId,
      article_count: articles.length,
      elapsed_ms: Date.now() - fetchStart,
    });

    if (articles.length === 0) {
      logger.warn('generator', 'hub_rebuild.fetch_articles.empty', {
        request_id: requestId,
        elapsed_ms: Date.now() - startedAt,
      });
      logger.info('api', 'hub_rebuild.end', {
        request_id: requestId,
        articles: 0,
        pages: 0,
        empty: true,
        elapsed_ms: Date.now() - startedAt,
      });
      return NextResponse.json({
        success: true,
        message: 'published記事がありません',
        pages: 0,
        articles: 0,
      });
    }

    // ── カテゴリ集計 ────────────────────────────────────────────────────
    logger.info('generator', 'hub_rebuild.build_categories.start', {
      request_id: requestId,
      article_count: articles.length,
    });
    const catStart = Date.now();
    const categories = buildCategories(articles);
    logger.info('generator', 'hub_rebuild.build_categories.end', {
      request_id: requestId,
      category_count: categories.length,
      elapsed_ms: Date.now() - catStart,
    });

    // ── 全ページHTML生成 ─────────────────────────────────────────────────
    logger.info('generator', 'hub_rebuild.generate_pages.start', {
      request_id: requestId,
      article_count: articles.length,
      category_count: categories.length,
    });
    const genStart = Date.now();
    const pages = generateAllHubPages(articles, categories);
    const totalChars = pages.reduce((sum, p) => sum + (p.html?.length ?? 0), 0);
    logger.info('generator', 'hub_rebuild.generate_pages.end', {
      request_id: requestId,
      page_count: pages.length,
      total_html_chars: totalChars,
      elapsed_ms: Date.now() - genStart,
    });

    const elapsedMs = Date.now() - startedAt;
    logger.info('api', 'hub_rebuild.end', {
      request_id: requestId,
      articles: articles.length,
      pages: pages.length,
      categories: categories.length,
      total_html_chars: totalChars,
      elapsed_ms: elapsedMs,
      success: true,
    });

    return NextResponse.json({
      success: true,
      message: `${pages.length}ページのハブページを生成しました`,
      pages: pages.length,
      articles: articles.length,
      generatedFiles: pages.map((p) => p.path),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack?.slice(0, 500) : undefined;
    logger.error(
      'api',
      'hub_rebuild.failed',
      {
        request_id: requestId,
        error_message: message,
        stack,
        elapsed_ms: Date.now() - startedAt,
      },
      err,
    );
    return NextResponse.json(
      {
        error: 'ハブページ生成に失敗しました',
        ...(process.env.NODE_ENV === 'development' ? { detail: message } : {}),
      },
      { status: 500 },
    );
  }
}
