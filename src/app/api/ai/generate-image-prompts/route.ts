// ============================================================================
// src/app/api/ai/generate-image-prompts/route.ts
// POST /api/ai/generate-image-prompts
// 画像プロンプト生成 — 記事の構成案から Banana Pro 用画像プロンプトを生成
//
// フロー:
//   1. リクエスト検証 (articleId 必須)
//   2. Supabase認証チェック
//   3. 記事取得 (stage1_outline 必須)
//   4. 画像プロンプト構築 → Gemini JSON モード呼び出し
//   5. レスポンス検証 → image_prompts カラムに保存
//   6. 結果返却
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateJson } from '@/lib/ai/gemini-client';
import {
  buildImagePromptSystemPrompt,
  buildImagePromptUserPrompt,
} from '@/lib/ai/prompts/image-prompt';
import { logger } from '@/lib/logger';
import type { ImagePromptsResult } from '@/lib/ai/prompts/image-prompt';

// ─── リクエストスキーマ ─────────────────────────────────────────────────────

const requestSchema = z.object({
  articleId: z.string().uuid('記事IDはUUID形式で指定してください'),
});

// ─── レスポンス検証 (AIの出力をバリデーション) ──────────────────────────────

const imagePromptItemSchema = z.object({
  position: z.enum(['hero', 'body', 'summary']),
  prompt: z.string().min(10),
  negative_prompt: z.string().min(1),
  aspect_ratio: z.enum(['16:9', '1:1']),
  alt_text_ja: z.string().min(1),
  caption_ja: z.string().min(1),
});

const imagePromptsResponseSchema = z.object({
  prompts: z.array(imagePromptItemSchema).min(1).max(5),
});

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

  // stage1_outline が必要
  const outline = article.stage1_outline as Record<string, unknown> | null;
  if (!outline || !outline.headings) {
    return NextResponse.json(
      { error: '構成案（stage1_outline）が未生成です。先に構成案を生成してください。' },
      { status: 409 },
    );
  }

  // 4. プロンプト組み立て
  const headings = outline.headings as { level: string; text: string; children?: { text: string }[] }[];
  const sections = headings.map((h) => h.text);

  // 画像配置位置を組み立て
  const imagePositions: { position: string; context: string }[] = [
    {
      position: 'hero',
      context: `記事タイトル「${article.title || outline.title_proposal || ''}」のアイキャッチ画像`,
    },
    {
      position: 'body',
      context: sections.length > 1
        ? `本文セクション「${sections[1]}」に対応する挿入画像`
        : `本文中の挿入画像`,
    },
    {
      position: 'summary',
      context: `まとめセクション「${sections[sections.length - 1] || ''}」に対応する締めくくり画像`,
    },
  ];

  const systemPrompt = buildImagePromptSystemPrompt();
  const userPrompt = buildImagePromptUserPrompt({
    title: (article.title || outline.title_proposal || '') as string,
    theme: (article.theme || '') as string,
    sections,
    imagePositions,
  });

  // 5. Gemini 呼び出し (JSON モード)
  logger.info('ai', 'image_prompts.generation_start', {
    articleId,
    theme: article.theme,
    positionsCount: imagePositions.length,
  });

  let imagePromptsResult: ImagePromptsResult;

  try {
    const startMs = Date.now();

    const { data, response } = await generateJson<ImagePromptsResult>(
      systemPrompt,
      userPrompt,
      { temperature: 0.8, maxOutputTokens: 4096, timeoutMs: 55_000 },
    );

    const durationMs = Date.now() - startMs;

    // finishReason チェック
    if (response.finishReason === 'MAX_TOKENS') {
      logger.error('ai', 'image_prompts.truncated', {
        articleId,
        finishReason: response.finishReason,
        tokenUsage: response.tokenUsage,
      });
      throw new Error('AI出力がトークン上限で切り捨てられました。再試行してください。');
    }
    if (response.finishReason === 'SAFETY') {
      logger.error('ai', 'image_prompts.safety_blocked', { articleId });
      throw new Error('AIの安全フィルターにより生成がブロックされました。');
    }

    // 空レスポンスチェック
    if (!data || typeof data !== 'object' || !data.prompts) {
      logger.error('ai', 'image_prompts.empty_response', {
        articleId,
        responseText: response.text?.substring(0, 500),
      });
      throw new Error('AIが空のレスポンスを返しました。再試行してください。');
    }

    // AI レスポンスの構造検証
    const validated = imagePromptsResponseSchema.safeParse(data);
    if (!validated.success) {
      logger.warn('ai', 'image_prompts.validation_partial', {
        articleId,
        errors: validated.error.issues,
      });
      // prompts 配列が存在すれば部分的に使用
      if (Array.isArray(data.prompts) && data.prompts.length > 0) {
        imagePromptsResult = data;
      } else {
        throw new Error('AIの画像プロンプトに必須フィールドが含まれていません。再試行してください。');
      }
    } else {
      imagePromptsResult = validated.data as ImagePromptsResult;
    }

    logger.info('ai', 'image_prompts.generation_complete', {
      articleId,
      durationMs,
      tokenUsage: response.tokenUsage,
      promptsCount: imagePromptsResult.prompts.length,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('ai', 'image_prompts.generation_failed', { articleId, errorMessage: errMsg }, error);
    return NextResponse.json(
      { error: errMsg || 'AI による画像プロンプト生成に失敗しました。しばらく待ってから再試行してください。' },
      { status: 502 },
    );
  }

  // 6. DB に保存
  try {
    const { error: updateError } = await supabase
      .from('articles')
      .update({
        image_prompts: imagePromptsResult.prompts,
        updated_at: new Date().toISOString(),
      })
      .eq('id', articleId);

    if (updateError) {
      throw updateError;
    }
  } catch (dbError) {
    logger.error('ai', 'image_prompts.db_save_failed', { articleId }, dbError);
    return NextResponse.json(
      { error: 'DB への保存に失敗しました' },
      { status: 500 },
    );
  }

  // 7. レスポンス返却
  return NextResponse.json({
    success: true,
    imagePrompts: imagePromptsResult.prompts,
  });
}
