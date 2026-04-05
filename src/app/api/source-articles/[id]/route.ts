// ============================================================================
// src/app/api/source-articles/[id]/route.ts
// 元記事個別取得 API
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSourceArticleById } from '@/lib/db/source-articles';

// ─── GET /api/source-articles/[id] ─────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    // 認証チェック
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const { id } = params;

    if (!id) {
      return NextResponse.json({ error: 'IDが必要です' }, { status: 400 });
    }

    const article = await getSourceArticleById(id);

    if (!article) {
      return NextResponse.json({ error: '元記事が見つかりません' }, { status: 404 });
    }

    return NextResponse.json(article);
  } catch (error: any) {
    console.error('[source-articles/[id]] GET error:', error);
    return NextResponse.json(
      { error: error.message ?? '取得に失敗しました' },
      { status: 500 },
    );
  }
}
