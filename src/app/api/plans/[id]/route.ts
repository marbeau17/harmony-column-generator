// ============================================================================
// src/app/api/plans/[id]/route.ts
// GET /api/plans/[id] — プラン詳細
// PUT /api/plans/[id] — プラン修正
// DELETE /api/plans/[id] — プラン削除
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

type RouteParams = { params: { id: string } };

// ─── GET /api/plans/[id] ────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: RouteParams) {
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

    const serviceClient = await createServiceRoleClient();
    const { data, error } = await serviceClient
      .from('content_plans')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      logger.error('api', 'getPlan', { planId: id }, error);
      return NextResponse.json(
        { error: 'プランの取得に失敗しました' },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: 'プランが見つかりません' },
        { status: 404 },
      );
    }

    logger.info('api', 'getPlan', { planId: id });

    return NextResponse.json({ data });
  } catch (error) {
    logger.error('api', 'getPlan', { planId: params.id }, error);
    return NextResponse.json(
      { error: 'プランの取得に失敗しました' },
      { status: 500 },
    );
  }
}

// ─── PUT /api/plans/[id] ────────────────────────────────────────────────────

export async function PUT(request: NextRequest, { params }: RouteParams) {
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

    // 存在確認
    const serviceClient = await createServiceRoleClient();
    const { data: existing, error: fetchError } = await serviceClient
      .from('content_plans')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) {
      logger.error('api', 'updatePlan.fetch', { planId: id }, fetchError);
      return NextResponse.json(
        { error: 'プランの取得に失敗しました' },
        { status: 500 },
      );
    }

    if (!existing) {
      return NextResponse.json(
        { error: 'プランが見つかりません' },
        { status: 404 },
      );
    }

    // draft または rejected のみ編集可能
    if (existing.status !== 'draft' && existing.status !== 'rejected') {
      return NextResponse.json(
        { error: `ステータス「${existing.status}」のプランは編集できません。` },
        { status: 409 },
      );
    }

    // リクエストボディ取得
    let body: {
      keyword?: string;
      theme?: string;
      persona?: string;
      perspective_type?: string;
      target_word_count?: number;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'リクエストボディが不正です。' },
        { status: 400 },
      );
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.keyword !== undefined) updatePayload.keyword = body.keyword;
    if (body.theme !== undefined) updatePayload.theme = body.theme;
    if (body.persona !== undefined) updatePayload.persona = body.persona;
    if (body.perspective_type !== undefined) updatePayload.perspective_type = body.perspective_type;
    if (body.target_word_count !== undefined) updatePayload.target_word_count = body.target_word_count;

    const { data: updated, error: updateError } = await serviceClient
      .from('content_plans')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .single();

    if (updateError) {
      logger.error('api', 'updatePlan', { planId: id }, updateError);
      return NextResponse.json(
        { error: 'プランの更新に失敗しました' },
        { status: 500 },
      );
    }

    logger.info('api', 'updatePlan', {
      planId: id,
      updatedFields: Object.keys(body),
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    logger.error('api', 'updatePlan', { planId: params.id }, error);
    return NextResponse.json(
      { error: 'プランの更新に失敗しました' },
      { status: 500 },
    );
  }
}

// ─── DELETE /api/plans/[id] ─────────────────────────────────────────────────

export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

    // 存在確認
    const serviceClient = await createServiceRoleClient();
    const { data: existing, error: fetchError } = await serviceClient
      .from('content_plans')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) {
      logger.error('api', 'deletePlan.fetch', { planId: id }, fetchError);
      return NextResponse.json(
        { error: 'プランの取得に失敗しました' },
        { status: 500 },
      );
    }

    if (!existing) {
      return NextResponse.json(
        { error: 'プランが見つかりません' },
        { status: 404 },
      );
    }

    // processing 中は削除不可
    if (existing.status === 'processing') {
      return NextResponse.json(
        { error: '処理中のプランは削除できません。' },
        { status: 409 },
      );
    }

    const { error: deleteError } = await serviceClient
      .from('content_plans')
      .delete()
      .eq('id', id);

    if (deleteError) {
      logger.error('api', 'deletePlan', { planId: id }, deleteError);
      return NextResponse.json(
        { error: 'プランの削除に失敗しました' },
        { status: 500 },
      );
    }

    logger.info('api', 'deletePlan', { planId: id });

    return NextResponse.json({ data: { id, deleted: true } });
  } catch (error) {
    logger.error('api', 'deletePlan', { planId: params.id }, error);
    return NextResponse.json(
      { error: 'プランの削除に失敗しました' },
      { status: 500 },
    );
  }
}
