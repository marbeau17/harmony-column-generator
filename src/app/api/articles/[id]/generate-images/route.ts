// ============================================================================
// src/app/api/articles/[id]/generate-images/route.ts
// POST /api/articles/:id/generate-images
// 記事の画像プロンプトから実際に画像を生成し、Supabase Storage に保存する
//
// フロー:
//   1. Supabase 認証チェック
//   2. 記事取得 → image_prompts を取得
//   3. 各プロンプト（最大3枚）に対して Banana Pro で画像生成
//   4. Supabase Storage にアップロード
//   5. image_files カラムに全画像URLを保存
//   6. 結果返却
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateImage } from '@/lib/ai/gemini-client';
import { uploadImage } from '@/lib/storage/image-storage';
import { logger } from '@/lib/logger';

// Vercel Serverless 最大実行時間を300秒に設定
export const maxDuration = 300;

// ─── 型定義 ────────────────────────────────────────────────────────────────

interface ImagePromptItem {
  position: string;   // hero | body | summary
  prompt: string;
  alt_text_ja?: string;
  caption_ja?: string;
  negative_prompt?: string;
  aspect_ratio?: string;
}

interface ImageResult {
  position: string;
  url: string;
  alt: string;
}

interface ImageError {
  position: string;
  error: string;
}

// ─── 定数 ──────────────────────────────────────────────────────────────────

const MAX_IMAGES = 3;
const IMAGE_TIMEOUT_MS = 60_000; // 各画像60秒

// ─── ハンドラー ────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: articleId } = params;

  // 1. 認証チェック
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  // 2. 記事取得
  const { data: article, error: articleError } = await supabase
    .from('articles')
    .select('id, title, image_prompts')
    .eq('id', articleId)
    .single();

  if (articleError || !article) {
    return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 });
  }

  // 3. image_prompts の検証
  const rawPrompts = article.image_prompts;
  if (!rawPrompts || !Array.isArray(rawPrompts) || rawPrompts.length === 0) {
    return NextResponse.json(
      { error: '画像プロンプトが未生成です。先に画像プロンプトを生成してください。' },
      { status: 400 },
    );
  }

  const prompts = (rawPrompts as ImagePromptItem[]).slice(0, MAX_IMAGES);

  logger.info('ai', 'generate_images.start', {
    articleId,
    promptsCount: prompts.length,
  });

  // 4. 各プロンプトに対して画像生成 → アップロード
  const results: ImageResult[] = [];
  const errors: ImageError[] = [];

  for (const rawItem of prompts) {
    // DB内のフィールド名の違いを吸収（section_id → position, heading_text → alt_text_ja等）
    const raw = rawItem as unknown as Record<string, string>;
    const promptItem = {
      position: raw.position || raw.section_id || 'hero',
      prompt: raw.prompt || '',
      alt_text_ja: raw.alt_text_ja || raw.heading_text || '',
    };
    const { position, prompt, alt_text_ja } = promptItem;

    if (!prompt) {
      logger.warn('ai', 'generate_images.empty_prompt', { articleId, position });
      errors.push({ position, error: 'プロンプトが空です' });
      continue;
    }

    try {
      const imageResult = await generateImageWithRetry(prompt, IMAGE_TIMEOUT_MS);

      logger.info('ai', 'generate_images.image_generated', {
        articleId,
        position,
        mimeType: imageResult.mimeType,
        sizeBytes: imageResult.imageBuffer.length,
      });

      // Supabase Storage にアップロード
      const url = await uploadImage(
        articleId,
        position,
        imageResult.imageBuffer,
        imageResult.mimeType,
      );

      results.push({
        position,
        url,
        alt: alt_text_ja || '',
      });

      logger.info('ai', 'generate_images.image_uploaded', {
        articleId,
        position,
        url,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error('ai', 'generate_images.image_failed', {
        articleId,
        position,
        errorMessage: errMsg,
      }, error);

      errors.push({ position, error: errMsg });
      // 1枚失敗しても残りは続行
    }
  }

  // 5. 成功した画像がある場合、image_files カラムに保存
  if (results.length > 0) {
    const imageFiles = results.map((r) => ({
      position: r.position,
      url: r.url,
      alt: r.alt,
      filename: `${r.position}.webp`,
    }));

    try {
      const { error: updateError } = await supabase
        .from('articles')
        .update({
          image_files: imageFiles,
          updated_at: new Date().toISOString(),
        })
        .eq('id', articleId);

      if (updateError) {
        logger.error('ai', 'generate_images.db_save_failed', {
          articleId,
          errorMessage: updateError.message,
        });
        return NextResponse.json(
          {
            error: '画像生成は成功しましたが、DB保存に失敗しました',
            ...(process.env.NODE_ENV === 'development' ? { detail: updateError.message } : {}),
          },
          { status: 500 },
        );
      }
    } catch (dbError) {
      logger.error('ai', 'generate_images.db_save_failed', { articleId }, dbError);
      return NextResponse.json(
        { error: '画像生成は成功しましたが、DB保存に失敗しました' },
        { status: 500 },
      );
    }
  }

  logger.info('ai', 'generate_images.complete', {
    articleId,
    successCount: results.length,
    errorCount: errors.length,
  });

  // 6. 結果返却
  return NextResponse.json({
    success: errors.length === 0,
    images: results,
    ...(errors.length > 0 ? { errors } : {}),
  });
}

// ─── ヘルパー ──────────────────────────────────────────────────────────────

/**
 * 画像生成を1回リトライ付きで実行する。
 * generateImage 自体にもリトライがあるが、ここではアプリケーションレベルでの
 * 追加リトライ（1回）を行う。
 */
async function generateImageWithRetry(
  prompt: string,
  timeoutMs: number,
): Promise<{ imageBuffer: Buffer; mimeType: string }> {
  try {
    return await generateImage(prompt, { timeoutMs });
  } catch (firstError) {
    logger.warn('ai', 'generate_images.retry', {
      error: firstError instanceof Error ? firstError.message : String(firstError),
    });

    // 1秒待ってリトライ
    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
      return await generateImage(prompt, { timeoutMs });
    } catch (retryError) {
      // リトライも失敗した場合は元のエラーを含めて投げる
      const msg = retryError instanceof Error ? retryError.message : String(retryError);
      throw new Error(`画像生成に失敗しました（リトライ後）: ${msg}`);
    }
  }
}
