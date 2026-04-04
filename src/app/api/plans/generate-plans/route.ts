// ============================================================================
// src/app/api/plans/generate-plans/route.ts
// POST /api/plans/generate-plans
// Step2: キーワード一覧からプラン生成 → DB保存 → 結果返却
// (タイムアウト対策: ステップ分割方式)
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { generatePlansFromKeywords, selectSourceArticles, predictSeoScore } from '@/lib/planner/plan-generator';
import type { KeywordSuggestion } from '@/lib/planner/keyword-researcher';
import { logger } from '@/lib/logger';

// Vercel Serverless 最大実行時間を60秒に設定
export const maxDuration = 60;

// ─── ハンドラー ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startTime = Date.now();

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
    let body: { keywords?: KeywordSuggestion[]; count?: number };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'リクエストボディが不正です。keywords 配列を指定してください。' },
        { status: 400 },
      );
    }

    const keywords = body.keywords;
    const count = body.count ?? 5;

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return NextResponse.json(
        { error: 'keywords は必須です。Step1 (generate) の結果を渡してください。' },
        { status: 400 },
      );
    }

    logger.info('api', 'generatePlans.step2_start', {
      keywordCount: keywords.length,
      requestedCount: count,
    });

    // Step2-A: Gemini API でプラン提案
    const plans = await generatePlansFromKeywords(keywords);

    if (plans.length === 0) {
      logger.warn('api', 'generatePlans.step2_no_plans');
      return NextResponse.json(
        { error: 'プランを生成できませんでした。再度お試しください。' },
        { status: 500 },
      );
    }

    logger.info('api', 'generatePlans.step2_plans_generated', {
      planCount: plans.length,
    });

    // Step2-B: 各プランに元記事を自動選択
    const plansWithSources = await Promise.all(
      plans.map(async (plan) => {
        const sources = await selectSourceArticles(plan.theme, plan.keyword, 3);
        return {
          ...plan,
          sourceArticleIds: sources.map((s) => s.id),
          sourceArticleTitles: sources.map((s) => s.title),
        };
      }),
    );

    // Step2-C: SEOスコア予測
    const plansWithScores = plansWithSources.map((plan) => ({
      ...plan,
      predictedSeoScore: predictSeoScore({
        keyword: plan.keyword,
        subKeywords: plan.subKeywords,
        targetWordCount: plan.targetWordCount,
        perspectiveType: plan.perspectiveType,
        sourceArticleCount: plan.sourceArticleIds.length,
      }),
    }));

    // スコア順でソートして必要数に絞る
    plansWithScores.sort((a, b) => b.predictedSeoScore - a.predictedSeoScore);
    const finalPlans = plansWithScores.slice(0, count);

    // Step2-D: DB に保存
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const serviceClient = await createServiceRoleClient();
    const insertRows = finalPlans.map((plan) => ({
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
      logger.error('api', 'generatePlans.step2_insert_failed', undefined, insertError);
      return NextResponse.json(
        { error: 'プランのDB保存に失敗しました' },
        { status: 500 },
      );
    }

    const durationMs = Date.now() - startTime;
    logger.info('api', 'generatePlans.step2_done', {
      batchId,
      count: insertedPlans?.length ?? 0,
      durationMs,
    });

    return NextResponse.json(
      {
        step: 'plans_ready',
        batchId,
        plans: insertedPlans,
        count: insertedPlans?.length ?? 0,
      },
      { status: 201 },
    );
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('api', 'generatePlans.step2_failed', { durationMs, errorMessage }, error);
    return NextResponse.json(
      {
        error: 'プラン生成に失敗しました',
        detail: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      },
      { status: 500 },
    );
  }
}
