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
  theme: z.string().max(100).optional(),
  include_preview: z.boolean().optional(),
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
      keyword: searchParams.get('keyword') ?? undefined,
      theme: searchParams.get('theme') ?? undefined,
      include_preview: searchParams.get('include_preview') === 'true' ? true : undefined,
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

    // include_preview=true の場合、content の先頭200文字を preview として返す
    const responseData = result.data.include_preview
      ? data.map((row) => ({
          ...row,
          preview: row.content ? row.content.slice(0, 200) : null,
        }))
      : data;

    logger.info('api', 'listSourceArticles', {
      keyword: result.data.keyword,
      theme: result.data.theme,
      count,
    });

    return NextResponse.json({ data: responseData, count });
  } catch (error) {
    logger.error('api', 'listSourceArticles', undefined, error);
    return NextResponse.json(
      { error: '元記事一覧の取得に失敗しました' },
      { status: 500 },
    );
  }
}
