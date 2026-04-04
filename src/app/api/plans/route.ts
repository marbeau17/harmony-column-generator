// ============================================================================
// src/app/api/plans/route.ts
// GET /api/plans — プラン一覧取得
// POST /api/plans — 個別プラン作成（手動追加用）
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

// ─── GET /api/plans ─────────────────────────────────────────────────────────

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
    const batchId = searchParams.get('batch_id') ?? undefined;
    const status = searchParams.get('status') ?? undefined;
    const limit = searchParams.get('limit')
      ? Number(searchParams.get('limit'))
      : 20;
    const offset = searchParams.get('offset')
      ? Number(searchParams.get('offset'))
      : 0;

    // データ取得
    const serviceClient = await createServiceRoleClient();
    let query = serviceClient
      .from('content_plans')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (batchId) {
      query = query.eq('batch_id', batchId);
    }
    if (status) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;

    if (error) {
      logger.error('api', 'listPlans', undefined, error);
      return NextResponse.json(
        { error: 'プラン一覧の取得に失敗しました' },
        { status: 500 },
      );
    }

    logger.info('api', 'listPlans', { batchId, status, count });

    return NextResponse.json({
      data: data ?? [],
      meta: {
        total: count ?? 0,
        limit,
        offset,
      },
    });
  } catch (error) {
    logger.error('api', 'listPlans', undefined, error);
    return NextResponse.json(
      { error: 'プラン一覧の取得に失敗しました' },
      { status: 500 },
    );
  }
}

// ─── POST /api/plans ────────────────────────────────────────────────────────

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

    // リクエストボディ取得
    let body: {
      keyword?: string;
      theme?: string;
      persona?: string;
      perspective_type?: string;
      target_word_count?: number;
      batch_id?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'リクエストボディが不正です。' },
        { status: 400 },
      );
    }

    if (!body.keyword?.trim()) {
      return NextResponse.json(
        { error: 'keyword は必須です。' },
        { status: 400 },
      );
    }

    const serviceClient = await createServiceRoleClient();
    const insertPayload = {
      keyword: body.keyword.trim(),
      theme: body.theme || 'healing',
      persona: body.persona || 'spiritual_beginner',
      perspective_type: body.perspective_type || 'concept_to_practice',
      target_word_count: body.target_word_count || 2000,
      batch_id: body.batch_id || `manual_${Date.now()}`,
      status: 'draft',
    };

    const { data, error } = await serviceClient
      .from('content_plans')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) {
      logger.error('api', 'createPlan', undefined, error);
      return NextResponse.json(
        { error: 'プランの作成に失敗しました' },
        { status: 500 },
      );
    }

    logger.info('api', 'createPlan', { planId: data.id });

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    logger.error('api', 'createPlan', undefined, error);
    return NextResponse.json(
      { error: 'プランの作成に失敗しました' },
      { status: 500 },
    );
  }
}
