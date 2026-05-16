// ============================================================================
// src/app/api/queue/route.ts
// GET /api/queue — 生成キュー一覧取得
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

// ─── レスポンス型定義 ───────────────────────────────────────────────────────

type QueueListItem = {
  id: string;
  plan_id: string;
  plan_name: string;
  current_step:
    | 'pending'
    | 'outline'
    | 'body'
    | 'images'
    | 'seo_check'
    | 'completed'
    | 'failed';
  step_started_at: string | null;
  current_agent: string | null;
  started_at: string | null;
  error_message: string | null;
};

// ─── GET /api/queue ─────────────────────────────────────────────────────────

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
    const step = searchParams.get('step') ?? undefined;
    const limit = searchParams.get('limit')
      ? Number(searchParams.get('limit'))
      : 20;
    const offset = searchParams.get('offset')
      ? Number(searchParams.get('offset'))
      : 0;

    const serviceClient = await createServiceRoleClient();

    // generation_queue と content_plans を join して取得
    let query = serviceClient
      .from('generation_queue')
      .select('*, content_plan:content_plans(*)', { count: 'exact' })
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (step) {
      query = query.eq('step', step);
    }

    const { data, error, count } = await query;

    if (error) {
      logger.error('api', 'listQueue', undefined, error);
      return NextResponse.json(
        { error: 'キュー一覧の取得に失敗しました' },
        { status: 500 },
      );
    }

    logger.info('api', 'listQueue', { step, count });

    // ─ 正規化: row → QueueListItem ─
    const items: QueueListItem[] = (data ?? []).map((row: any) => ({
      id: row.id,
      plan_id: row.plan_id,
      plan_name: row.content_plan?.keyword || '(プラン名なし)',
      current_step: row.step,
      step_started_at: row.step_started_at ?? null,
      current_agent: row.current_agent ?? null,
      started_at: row.started_at ?? null,
      error_message: row.error_message ?? null,
    }));

    return NextResponse.json({
      data: items,
      meta: {
        total: count ?? 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    logger.error('api', 'listQueue', undefined, error);
    return NextResponse.json(
      { error: 'キュー一覧の取得に失敗しました' },
      { status: 500 },
    );
  }
}
