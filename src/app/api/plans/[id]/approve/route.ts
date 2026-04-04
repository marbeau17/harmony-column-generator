// ============================================================================
// src/app/api/plans/[id]/approve/route.ts
// POST /api/plans/[id]/approve
// プラン承認 / 却下 API
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

type RouteParams = { params: { id: string } };

export async function POST(request: NextRequest, { params }: RouteParams) {
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

    // リクエストボディ取得
    let body: { approve?: boolean; reject?: boolean; reason?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'リクエストボディが不正です。' },
        { status: 400 },
      );
    }

    if (!body.approve && !body.reject) {
      return NextResponse.json(
        { error: 'approve または reject を指定してください。' },
        { status: 400 },
      );
    }

    if (body.approve && body.reject) {
      return NextResponse.json(
        { error: 'approve と reject は同時に指定できません。' },
        { status: 400 },
      );
    }

    const serviceClient = await createServiceRoleClient();

    // プラン取得
    const { data: plan, error: fetchError } = await serviceClient
      .from('content_plans')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) {
      logger.error('api', 'approvePlan.fetch', { planId: id }, fetchError);
      return NextResponse.json(
        { error: 'プランの取得に失敗しました' },
        { status: 500 },
      );
    }

    if (!plan) {
      return NextResponse.json(
        { error: 'プランが見つかりません' },
        { status: 404 },
      );
    }

    // proposed のみ承認/却下可能
    if (plan.status !== 'proposed') {
      return NextResponse.json(
        { error: `ステータス「${plan.status}」のプランは承認/却下できません。proposed のみ可能です。` },
        { status: 409 },
      );
    }

    // ── 却下 ──
    if (body.reject) {
      const { data: rejected, error: rejectError } = await serviceClient
        .from('content_plans')
        .update({
          status: 'rejected',
          proposal_reason: body.reason ? `[却下理由] ${body.reason}` : plan.proposal_reason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single();

      if (rejectError) {
        logger.error('api', 'rejectPlan', { planId: id }, rejectError);
        return NextResponse.json(
          { error: 'プランの却下に失敗しました' },
          { status: 500 },
        );
      }

      logger.info('api', 'rejectPlan', { planId: id, reason: body.reason });

      return NextResponse.json({ data: rejected });
    }

    // ── 承認 ──
    // 1. プランステータスを approved に更新
    const { data: approved, error: approveError } = await serviceClient
      .from('content_plans')
      .update({
        status: 'approved',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (approveError) {
      logger.error('api', 'approvePlan.update', { planId: id }, approveError);
      return NextResponse.json(
        { error: 'プランの承認に失敗しました' },
        { status: 500 },
      );
    }

    // 2. generation_queue にエントリ追加（step='pending'）
    const { data: queueEntry, error: queueError } = await serviceClient
      .from('generation_queue')
      .insert({
        plan_id: id,
        step: 'pending',
        priority: 0,
      })
      .select('*')
      .single();

    if (queueError) {
      logger.error('api', 'approvePlan.queue_insert', { planId: id }, queueError);
      // キュー追加失敗してもプランの承認は成功扱い
      // ただし警告をログに記録
      logger.warn('api', 'approvePlan.queue_insert_failed', {
        planId: id,
        error: queueError.message,
      });
    }

    logger.info('api', 'approvePlan', {
      planId: id,
      queueEntryId: queueEntry?.id,
    });

    return NextResponse.json({
      data: approved,
      queueEntry: queueEntry ?? null,
    });
  } catch (error) {
    logger.error('api', 'approvePlan', { planId: params.id }, error);
    return NextResponse.json(
      { error: 'プランの承認処理に失敗しました' },
      { status: 500 },
    );
  }
}
