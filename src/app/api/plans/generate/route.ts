// ============================================================================
// src/app/api/plans/generate/route.ts
// POST /api/plans/generate
// コンテンツプラン一括生成API
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { generateContentPlans } from '@/lib/planner/plan-generator';
import { logger } from '@/lib/logger';

// ─── ハンドラー ─────────────────────────────────────────────────────────────

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
    let body: { count?: number };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'リクエストボディが不正です。JSON形式で count を指定してください。' },
        { status: 400 },
      );
    }

    const count = body.count ?? 5;
    if (count < 1 || count > 20) {
      return NextResponse.json(
        { error: 'count は 1〜20 の範囲で指定してください。' },
        { status: 400 },
      );
    }

    // AI でプラン生成
    const generatedPlans = await generateContentPlans(count);

    // バッチID生成（タイムスタンプベース）
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // content_plans テーブルに一括 insert
    const serviceClient = await createServiceRoleClient();
    const insertRows = generatedPlans.map((plan) => ({
      batch_id: batchId,
      keyword: plan.keyword,
      theme: plan.theme,
      persona: plan.persona,
      perspective_type: plan.perspectiveType,
      target_word_count: plan.targetWordCount ?? 2000,
      status: 'proposed',
      sub_keywords: plan.subKeywords ?? [],
      source_article_ids: plan.sourceArticleIds ?? [],
      predicted_seo_score: plan.predictedSeoScore ?? 75,
      proposal_reason: plan.proposalReason ?? `AIが「${plan.keyword}」をキーワードとして提案`,
    }));

    const { data: insertedPlans, error: insertError } = await serviceClient
      .from('content_plans')
      .insert(insertRows)
      .select('*');

    if (insertError) {
      logger.error('api', 'generatePlans.insert_failed', undefined, insertError);
      return NextResponse.json(
        { error: 'プランのDB保存に失敗しました' },
        { status: 500 },
      );
    }

    logger.info('api', 'generatePlans', {
      batchId,
      count: insertedPlans?.length ?? 0,
    });

    return NextResponse.json(
      {
        batchId,
        plans: insertedPlans,
        count: insertedPlans?.length ?? 0,
      },
      { status: 201 },
    );
  } catch (error) {
    logger.error('api', 'generatePlans', undefined, error);
    return NextResponse.json(
      { error: 'プランの生成に失敗しました' },
      { status: 500 },
    );
  }
}
