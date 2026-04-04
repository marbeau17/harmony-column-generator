// ============================================================================
// src/app/api/ai/proofread/route.ts
// POST /api/ai/proofread
// 校正API（スピリチュアルコラム向け・Supabase使用）
//
// 記事の stage2_body_html または stage3_final_html を校正し、
// 修正箇所リストと修正済みテキストを保存・返却する。
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateText } from '@/lib/ai/gemini-client';
import {
  buildProofreadingPrompt,
  parseProofreadingResponse,
} from '@/lib/ai/prompts/stage2-proofreading';
import { logger } from '@/lib/logger';

// Vercel Serverless 最大実行時間を60秒に設定
export const maxDuration = 60;

// ─── ハンドラー ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. 認証チェック
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  // 2. リクエスト解析
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'リクエストボディが不正です。JSON形式で articleId を指定してください。' },
      { status: 400 },
    );
  }

  const { articleId } = body as { articleId?: string };
  if (!articleId) {
    return NextResponse.json({ error: 'articleId は必須です' }, { status: 400 });
  }

  // 3. 記事を取得
  const { data: article, error: articleError } = await supabase
    .from('articles')
    .select('*')
    .eq('id', articleId)
    .single();

  if (articleError || !article) {
    return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 });
  }

  // 校閲対象テキストの取得（stage2_body_html → stage3_final_html の順に試行）
  const bodyHtml = (article.stage2_body_html || article.stage3_final_html) as string | null;
  if (!bodyHtml) {
    return NextResponse.json(
      { error: '校閲対象の本文がありません。先に本文生成（ステージ2）を完了してください。' },
      { status: 400 },
    );
  }

  // 4. Gemini で校閲実行
  try {
    const { system, user: userPrompt } = buildProofreadingPrompt({ bodyHtml });
    const response = await generateText(system, userPrompt, {
      temperature: 0.3,
      maxOutputTokens: 8192,
      timeoutMs: 60_000,
    });

    const result = parseProofreadingResponse(response.text);

    // 5. 結果を DB に保存
    // 既存のログをパース（JSON形式またはプレーンテキスト）
    let currentLog: Record<string, unknown> = {};
    if (article.ai_generation_log) {
      try {
        currentLog =
          typeof article.ai_generation_log === 'object'
            ? (article.ai_generation_log as Record<string, unknown>)
            : JSON.parse(article.ai_generation_log as string);
      } catch {
        currentLog = { _raw: article.ai_generation_log };
      }
    }

    const newLog = {
      ...currentLog,
      proofread_at: new Date().toISOString(),
      proofread_corrections_count: result.corrections.length,
      proofread_corrections: result.corrections,
      proofread_token_usage: response.tokenUsage,
    };

    const { error: updateError } = await supabase
      .from('articles')
      .update({
        stage2_body_html: result.correctedText || bodyHtml,
        ai_generation_log: JSON.stringify(newLog),
        updated_at: new Date().toISOString(),
      })
      .eq('id', articleId);

    if (updateError) {
      throw updateError;
    }

    logger.info('ai', 'proofread_complete', {
      articleId,
      corrections: result.corrections.length,
      tokenUsage: response.tokenUsage,
    });

    return NextResponse.json({
      success: true,
      corrections: result.corrections,
      correctedHtml: result.correctedText,
      stats: {
        correctionsCount: result.corrections.length,
        originalLength: bodyHtml.length,
        correctedLength: (result.correctedText || bodyHtml).length,
      },
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error('ai', 'proofread_failed', { articleId, error: errMsg });
    return NextResponse.json(
      {
        error: '校閲処理に失敗しました',
        ...(process.env.NODE_ENV === 'development' ? { detail: errMsg } : {}),
      },
      { status: 500 },
    );
  }
}
