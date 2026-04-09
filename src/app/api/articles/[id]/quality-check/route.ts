// POST /api/articles/[id]/quality-check
// 記事の品質チェックリストを実行し、結果をDBに保存して返す

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { runQualityChecklist } from '@/lib/content/quality-checklist';

type RouteParams = { params: { id: string } };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: articleId } = params;

  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const serviceClient = await createServiceRoleClient();

    const { data: article, error } = await serviceClient
      .from('articles')
      .select('id, title, keyword, meta_description, theme, stage2_body_html, published_html, status')
      .eq('id', articleId)
      .single();

    if (error || !article) {
      return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 });
    }

    const html = article.published_html || article.stage2_body_html || '';
    if (!html) {
      return NextResponse.json({ error: '本文がまだ生成されていません' }, { status: 400 });
    }

    const result = runQualityChecklist({
      title: article.title || '',
      html,
      keyword: article.keyword || undefined,
      metaDescription: article.meta_description || undefined,
      theme: article.theme || undefined,
    });

    // 結果をDBに保存（quality_checkカラムが存在する場合のみ）
    try {
      await serviceClient
        .from('articles')
        .update({ quality_check: result } as Record<string, unknown>)
        .eq('id', articleId);
    } catch {
      // quality_check column may not exist yet
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
