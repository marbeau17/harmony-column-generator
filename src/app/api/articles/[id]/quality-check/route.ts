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
      .select('id, title, keyword, meta_description, theme, stage2_body_html, published_html, status, quality_overrides')
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

    // P5-28: quality_overrides を適用 — ignore-warn された項目は pass 扱いに上書き
    type Override = { check_item_id: string; reason: string; ignored_at: string };
    const overrides = (Array.isArray(article.quality_overrides)
      ? (article.quality_overrides as Override[])
      : []);
    if (overrides.length > 0 && Array.isArray(result.items)) {
      const overrideIds = new Set(overrides.map((o) => o.check_item_id));
      let suppressedErrors = 0;
      let suppressedWarnings = 0;
      for (const item of result.items) {
        if (overrideIds.has(item.id) && item.status !== 'pass') {
          if (item.severity === 'error') suppressedErrors++;
          else suppressedWarnings++;
          item.status = 'pass';
          item.detail = `(無視済) ${item.detail ?? ''}`.trim();
        }
      }
      result.errorCount = Math.max(0, result.errorCount - suppressedErrors);
      result.warningCount = Math.max(0, result.warningCount - suppressedWarnings);
      result.passed = result.errorCount === 0;
      if (result.passed) {
        result.summary = `全${result.items.length}項目クリア（警告${result.warningCount}件、無視済${overrides.length}件）— 公開可能です`;
      }
    }

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
