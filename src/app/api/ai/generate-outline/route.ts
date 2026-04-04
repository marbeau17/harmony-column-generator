// ============================================================================
// src/app/api/ai/generate-outline/route.ts
// POST /api/ai/generate-outline
// ステージ1: 構成案生成（スピリチュアルコラム向け・Supabase使用）
//
// フロー:
//   1. リクエスト検証 (articleId 必須)
//   2. Supabase認証チェック
//   3. 記事取得 (status=draft のみ構成案生成可能)
//   4. Stage1プロンプト構築 → Gemini JSON モード呼び出し
//   5. レスポンス検証 → DB保存
//      (seo_filename, title, meta_description, stage1_outline,
//       image_prompts, cta_texts, faq_data)
//   6. ステータス遷移: draft → outline_pending
//   7. 結果返却
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateJson } from '@/lib/ai/gemini-client';
import {
  buildStage1SystemPrompt,
  buildStage1UserPrompt,
} from '@/lib/ai/prompts/stage1-outline';
import { logger } from '@/lib/logger';
import type { Stage1Input, Stage1OutlineResult } from '@/types/ai';

// ─── リクエストスキーマ ─────────────────────────────────────────────────────

const requestSchema = z.object({
  articleId: z.string().uuid('記事IDはUUID形式で指定してください'),
});

// ─── レスポンス検証 (AIの出力をバリデーション) ──────────────────────────────

const outlineResponseSchema = z.object({
  seo_filename: z.string().min(1),
  title_proposal: z.string().min(5).max(100),
  meta_description: z.string().min(10).max(200),
  quick_answer: z.string().optional(),
  headings: z.array(
    z.object({
      level: z.enum(['h2', 'h3']),
      text: z.string().min(1),
      estimated_words: z.number().int().min(50),
      children: z.array(
        z.object({
          level: z.enum(['h2', 'h3']),
          text: z.string().min(1),
          estimated_words: z.number().int().min(50),
        }),
      ).optional(),
    }),
  ).min(2),
  faq: z.array(
    z.object({
      question: z.string().min(1),
      answer: z.string().min(1),
    }),
  ).optional(),
  image_prompts: z.array(
    z.object({
      section_id: z.string(),
      heading_text: z.string(),
      prompt: z.string().min(10),
      suggested_filename: z.string(),
    }),
  ).optional(),
  cta_positions: z.array(z.string()).optional(),
  cta_texts: z.unknown().optional(),
});

// ─── ハンドラー ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. 認証チェック
  const supabase = createServerSupabaseClient();
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

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }
  const { articleId } = parsed.data;

  // 3. 記事を取得
  const { data: article, error: articleError } = await supabase
    .from('articles')
    .select('*')
    .eq('id', articleId)
    .single();

  if (articleError || !article) {
    return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 });
  }

  // ステータスチェック (draft のみ構成案生成可能、outline_pending は再生成可能)
  if (article.status !== 'draft' && article.status !== 'outline_pending') {
    return NextResponse.json(
      { error: `現在のステータス「${article.status}」では構成案を生成できません` },
      { status: 409 },
    );
  }

  // 4. プロンプト組み立て
  const stage1Input: Stage1Input = {
    keyword: article.keyword || '',
    theme: article.theme || 'spiritual_intro',
    targetPersona: article.persona || 'spiritual_beginner',
    perspectiveType: article.perspective_type || 'concept_to_practice',
    targetWordCount: article.target_word_count ?? 2000,
    sourceArticleId: article.source_article_id || undefined,
  };

  const systemPrompt = buildStage1SystemPrompt(stage1Input);
  const userPrompt = buildStage1UserPrompt(stage1Input);

  // 5. Gemini 呼び出し (JSON モード)
  logger.info('ai', 'stage1.generation_start', {
    articleId,
    keyword: article.keyword,
  });

  let outlineResult: Stage1OutlineResult;
  let generationLog = '';

  try {
    const startMs = Date.now();

    const { data, response } = await generateJson<Stage1OutlineResult>(
      systemPrompt,
      userPrompt,
      { temperature: 0.8, maxOutputTokens: 16384, timeoutMs: 55_000 },
    );

    const durationMs = Date.now() - startMs;

    // finishReason チェック
    if (response.finishReason === 'MAX_TOKENS') {
      logger.error('ai', 'stage1.truncated', {
        articleId,
        finishReason: response.finishReason,
        tokenUsage: response.tokenUsage,
      });
      throw new Error('AI出力がトークン上限で切り捨てられました。再試行してください。');
    }
    if (response.finishReason === 'SAFETY') {
      logger.error('ai', 'stage1.safety_blocked', { articleId });
      throw new Error('AIの安全フィルターにより生成がブロックされました。キーワードを変更して再試行してください。');
    }

    // 空レスポンスチェック
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      logger.error('ai', 'stage1.empty_response', {
        articleId,
        responseText: response.text?.substring(0, 500),
      });
      throw new Error('AIが空のレスポンスを返しました。再試行してください。');
    }

    // AI レスポンスの構造検証
    const validated = outlineResponseSchema.safeParse(data);
    if (!validated.success) {
      const hasHeadings = Array.isArray(data.headings) && data.headings.length > 0;
      const hasTitle = typeof data.title_proposal === 'string' && data.title_proposal.length > 0;
      if (!hasHeadings || !hasTitle) {
        logger.error('ai', 'stage1.critical_fields_missing', {
          articleId,
          hasHeadings,
          hasTitle,
          errors: validated.error.issues,
          rawData: JSON.stringify(data).substring(0, 500),
        });
        throw new Error('AIの構成案に必須フィールド（見出し・タイトル）が含まれていません。再試行してください。');
      }
      logger.warn('ai', 'stage1.validation_partial', {
        articleId,
        errors: validated.error.issues,
      });
      outlineResult = data;
    } else {
      outlineResult = validated.data as Stage1OutlineResult;
    }

    // image_prompts を最大3枚に制限（hero / body / summary）
    if (outlineResult.image_prompts && outlineResult.image_prompts.length > 3) {
      logger.warn('ai', 'stage1.image_prompts_truncated', {
        articleId,
        original: outlineResult.image_prompts.length,
        truncatedTo: 3,
      });
      outlineResult.image_prompts = outlineResult.image_prompts.slice(0, 3);
    }

    // 生成ログ
    generationLog = JSON.stringify({
      stage: 'stage1_outline',
      timestamp: new Date().toISOString(),
      durationMs,
      tokenUsage: response.tokenUsage,
      finishReason: response.finishReason,
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
      responseLength: response.text.length,
    }, null, 2);

    logger.info('ai', 'stage1.generation_complete', {
      articleId,
      durationMs,
      tokenUsage: response.tokenUsage,
      headingsCount: outlineResult.headings?.length,
    });

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('ai', 'stage1.generation_failed', { articleId, errorMessage: errMsg }, error);
    return NextResponse.json(
      { error: errMsg || 'AI による構成案生成に失敗しました。しばらく待ってから再試行してください。' },
      { status: 502 },
    );
  }

  // 6. DB に保存 + ステータス遷移
  try {
    const outlineData = {
      seo_filename: outlineResult.seo_filename,
      title_proposal: outlineResult.title_proposal,
      meta_description: outlineResult.meta_description,
      quick_answer: outlineResult.quick_answer || '',
      headings: outlineResult.headings || [],
      faq: outlineResult.faq || [],
      image_prompts: outlineResult.image_prompts || [],
      cta_positions: outlineResult.cta_positions || [],
      cta_texts: outlineResult.cta_texts || [],
    };

    const updatePayload: Record<string, unknown> = {
      status: 'outline_pending',
      slug: outlineResult.seo_filename,
      title: outlineResult.title_proposal,
      meta_description: outlineResult.meta_description,
      stage1_outline: outlineData,
      image_prompts: outlineResult.image_prompts || [],
      cta_texts: outlineResult.cta_texts || [],
      faq_data: outlineResult.faq || [],
      updated_at: new Date().toISOString(),
    };

    // 再生成の場合はログを追記
    if (article.status === 'outline_pending') {
      const existingLog = article.ai_generation_log || '';
      updatePayload.ai_generation_log = existingLog
        ? existingLog + '\n---\n' + generationLog
        : generationLog;
    } else {
      updatePayload.ai_generation_log = generationLog;
    }

    const { error: updateError } = await supabase
      .from('articles')
      .update(updatePayload)
      .eq('id', articleId);

    if (updateError) {
      throw updateError;
    }
  } catch (dbError) {
    logger.error('ai', 'stage1.db_save_failed', { articleId }, dbError);
    return NextResponse.json(
      { error: 'DB への保存に失敗しました' },
      { status: 500 },
    );
  }

  // 7. レスポンス返却
  return NextResponse.json({
    success: true,
    outline: outlineResult,
  });
}
