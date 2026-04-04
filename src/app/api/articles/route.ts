// ============================================================================
// src/app/api/articles/route.ts
// 記事一覧取得 / 記事作成 API
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { listArticles, createArticle } from '@/lib/db/articles';
import {
  listArticlesQuerySchema,
  createArticleSchema,
  validate,
} from '@/lib/validators/article';
import { logger } from '@/lib/logger';

// ─── GET /api/articles ──────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    // 認証チェック
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    // クエリパラメータ取得
    const { searchParams } = request.nextUrl;
    const rawQuery = {
      status: searchParams.get('status') ?? undefined,
      keyword: searchParams.get('keyword') ?? undefined,
      limit: searchParams.get('limit')
        ? Number(searchParams.get('limit'))
        : undefined,
      offset: searchParams.get('offset')
        ? Number(searchParams.get('offset'))
        : undefined,
    };

    // バリデーション
    const result = validate(listArticlesQuerySchema, rawQuery);
    if (!result.success) {
      return NextResponse.json(
        { error: 'バリデーションエラー', details: result.error.flatten() },
        { status: 400 },
      );
    }

    // データ取得
    const { data, count } = await listArticles(result.data);

    logger.info('api', 'listArticles', {
      status: result.data.status,
      keyword: result.data.keyword,
      count,
    });

    return NextResponse.json({
      data,
      meta: {
        total: count,
        limit: result.data.limit ?? 20,
        offset: result.data.offset ?? 0,
      },
    });
  } catch (error) {
    logger.error('api', 'listArticles', undefined, error);
    return NextResponse.json(
      { error: '記事一覧の取得に失敗しました' },
      { status: 500 },
    );
  }
}

// ─── POST /api/articles ─────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // 認証チェック
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    // リクエストボディ取得 & バリデーション
    const body = await request.json();
    const result = validate(createArticleSchema, body);
    if (!result.success) {
      return NextResponse.json(
        { error: 'バリデーションエラー', details: result.error.flatten() },
        { status: 400 },
      );
    }

    // 記事作成（status='draft' は createArticle 内で設定される）
    const article = await createArticle({
      title: result.data.keyword, // キーワードを仮タイトルとして使用
      source_article_id: result.data.source_article_id,
      ...result.data,
    });

    logger.info('api', 'createArticle', { articleId: article.id });

    return NextResponse.json({ data: article }, { status: 201 });
  } catch (error) {
    logger.error('api', 'createArticle', undefined, error);
    return NextResponse.json(
      { error: '記事の作成に失敗しました' },
      { status: 500 },
    );
  }
}
