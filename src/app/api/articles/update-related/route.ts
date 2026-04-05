// POST /api/articles/update-related
// Recalculates related articles for all published articles

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { updateAllRelatedArticles } from '@/lib/publish/auto-related';
import { logger } from '@/lib/logger';

export const maxDuration = 60;

export async function POST() {
  try {
    // Auth check
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const result = await updateAllRelatedArticles();

    logger.info('api', 'update-all-related-articles', { updated: result.updated });

    return NextResponse.json({
      success: true,
      updated: result.updated,
      errors: result.errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('api', 'update-related-error', { error: message });
    return NextResponse.json({ error: '関連記事の更新に失敗しました' }, { status: 500 });
  }
}
