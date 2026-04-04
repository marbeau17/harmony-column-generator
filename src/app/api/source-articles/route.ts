// ============================================================================
// src/app/api/source-articles/route.ts
// 元記事一覧取得 API
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { listSourceArticles } from '@/lib/db/source-articles';
import { logger } from '@/lib/logger';
import { z } from 'zod';

// ─── クエリバリデーション ───────────────────────────────────────────────────

const listSourceArticlesQuerySchema = z.object({
  keyword: z.string().max(255).optional(),
  limit: z
    .number()
    .int()
    .min(1, 'limitは1以上で指定してください')
    .max(100, 'limitは100以下で指定してください')
    .default(20),
  offset: z
    .number()
    .int()
    .min(0, 'offsetは0以上で指定してください')
    .default(0),
});

// ─── GET /api/source-articles ───────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    // 認証チェック
    const supabase = createServerSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    // クエリパラメータ取得
    const { searchParams } = request.nextUrl;
    const rawQuery = {
      keyword: searchParams.get('keyword') ?? undefined,
      limit: searchParams.get('limit')
        ? Number(searchParams.get('limit'))
        : undefined,
      offset: searchParams.get('offset')
        ? Number(searchParams.get('offset'))
        : undefined,
    };

    // バリデーション
    const result = listSourceArticlesQuerySchema.safeParse(rawQuery);
    if (!result.success) {
      return NextResponse.json(
        { error: 'バリデーションエラー', details: result.error.flatten() },
        { status: 400 },
      );
    }

    // データ取得
    const { data, count } = await listSourceArticles(result.data);

    logger.info('api', 'listSourceArticles', {
      keyword: result.data.keyword,
      count,
    });

    return NextResponse.json({ data, count });
  } catch (error) {
    logger.error('api', 'listSourceArticles', undefined, error);
    return NextResponse.json(
      { error: '元記事一覧の取得に失敗しました' },
      { status: 500 },
    );
  }
}
