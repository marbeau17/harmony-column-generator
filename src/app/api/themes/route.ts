// ============================================================================
// src/app/api/themes/route.ts
// GET /api/themes — themes 一覧取得（ゼロ生成フォーム用 theme_id バインド）
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

type ThemeRow = {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  description: string | null;
  is_active: boolean;
  visual_mood: Record<string, unknown> | null;
};

// ─── GET /api/themes ────────────────────────────────────────────────────────

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

    // クエリパラメータ取得（is_active: default true）
    const { searchParams } = request.nextUrl;
    const isActiveParam = searchParams.get('is_active');
    const isActive = isActiveParam === null ? true : isActiveParam !== 'false';

    // service role 経由で themes テーブルから SELECT
    const serviceClient = await createServiceRoleClient();
    const { data, error } = await serviceClient
      .from('themes')
      .select('id, name, slug, category, description, is_active, visual_mood')
      .eq('is_active', isActive)
      .order('name', { ascending: true });

    if (error) {
      logger.error('api', 'listThemes', undefined, error);
      return NextResponse.json(
        { error: 'テーマ一覧の取得に失敗しました' },
        { status: 500 },
      );
    }

    const themes: ThemeRow[] = (data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      category: (row.category as string | null) ?? null,
      description: (row.description as string | null) ?? null,
      is_active: row.is_active as boolean,
      visual_mood:
        (row.visual_mood as Record<string, unknown> | null) ?? null,
    }));

    logger.info('api', 'listThemes', { count: themes.length, isActive });

    return NextResponse.json({ themes });
  } catch (error) {
    logger.error('api', 'listThemes', undefined, error);
    return NextResponse.json(
      { error: 'テーマ一覧の取得に失敗しました' },
      { status: 500 },
    );
  }
}
