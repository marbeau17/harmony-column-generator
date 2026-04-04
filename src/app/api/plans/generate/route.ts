// ============================================================================
// src/app/api/plans/generate/route.ts
// POST /api/plans/generate
// Step1: キーワードリサーチのみ実行 → キーワード一覧を返却
// (タイムアウト対策: ステップ分割方式)
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { researchKeywords } from '@/lib/planner/keyword-researcher';
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

    logger.info('api', 'generatePlans.step1_start', { count });

    // Step1: キーワードリサーチのみ実行
    const keywordCount = Math.max(count * 2, 10);
    const keywords = await researchKeywords({ count: keywordCount });

    if (keywords.length === 0) {
      logger.warn('api', 'generatePlans.step1_no_keywords');
      return NextResponse.json(
        { error: 'キーワードが見つかりませんでした。再度お試しください。' },
        { status: 500 },
      );
    }

    // 必要数に絞る
    const targetKeywords = keywords.slice(0, Math.max(count + 2, 7));

    const durationMs = Date.now() - startTime;
    logger.info('api', 'generatePlans.step1_done', {
      keywordCount: targetKeywords.length,
      durationMs,
    });

    return NextResponse.json({
      step: 'keywords_ready',
      keywords: targetKeywords,
      requestedCount: count,
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('api', 'generatePlans.step1_failed', { durationMs, errorMessage }, error);
    return NextResponse.json(
      {
        error: 'キーワードリサーチに失敗しました',
        detail: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      },
      { status: 500 },
    );
  }
}
