// ============================================================================
// src/app/api/cta/generate-banners/route.ts
// POST /api/cta/generate-banners
// Banana Pro (gemini-3-pro-image-preview) で3枚のCTAバナー画像を生成
// → Supabase Storage に保存 → URLを返却
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateImage } from '@/lib/ai/gemini-client';
import { uploadCtaBannerImage } from './storage';
import { buildCtaBannerPrompts } from '@/lib/ai/prompts/cta-banner-prompt';
import { logger } from '@/lib/logger';

// Vercel Serverless 最大実行時間 (Pro: 300秒, Hobby: 60秒)
export const maxDuration = 300;

// ─── 定数 ──────────────────────────────────────────────────────────────────

const IMAGE_TIMEOUT_MS = 90_000; // 各画像90秒（3枚で合計最大270秒+α）

// ─── 型定義 ─────────────────────────────────────────────────────────────────

interface BannerResult {
  position: string;
  url: string;
  alt: string;
}

interface BannerError {
  position: string;
  error: string;
}

// ─── ハンドラー ─────────────────────────────────────────────────────────────

export async function POST(): Promise<NextResponse> {
  // 1. 認証チェック
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  logger.info('api', 'cta_generate_banners.start');

  // 2. プロンプト取得
  const prompts = buildCtaBannerPrompts();

  // 3. 各プロンプトに対して画像生成 → アップロード
  const results: BannerResult[] = [];
  const errors: BannerError[] = [];

  for (const promptItem of prompts) {
    const { position, prompt, alt_text_ja } = promptItem;

    try {
      // Banana Pro で画像生成
      const imageResult = await generateImageWithRetry(prompt, IMAGE_TIMEOUT_MS);

      logger.info('api', 'cta_generate_banners.image_generated', {
        position,
        mimeType: imageResult.mimeType,
        sizeBytes: imageResult.imageBuffer.length,
      });

      // Supabase Storage にアップロード
      const url = await uploadCtaBannerImage(
        position,
        imageResult.imageBuffer,
        imageResult.mimeType,
      );

      results.push({
        position,
        url,
        alt: alt_text_ja,
      });

      logger.info('api', 'cta_generate_banners.image_uploaded', {
        position,
        url,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(
        'api',
        'cta_generate_banners.image_failed',
        { position, errorMessage: errMsg },
        error,
      );

      errors.push({ position, error: errMsg });
      // 1枚失敗しても残りは続行
    }
  }

  logger.info('api', 'cta_generate_banners.complete', {
    successCount: results.length,
    errorCount: errors.length,
  });

  return NextResponse.json({
    success: errors.length === 0,
    banners: results,
    ...(errors.length > 0 ? { errors } : {}),
  });
}

// ─── ヘルパー ──────────────────────────────────────────────────────────────

/**
 * 画像生成を1回リトライ付きで実行する。
 */
async function generateImageWithRetry(
  prompt: string,
  timeoutMs: number,
): Promise<{ imageBuffer: Buffer; mimeType: string }> {
  try {
    return await generateImage(prompt, { timeoutMs });
  } catch (firstError) {
    logger.warn('ai', 'cta_generate_banners.retry', {
      error:
        firstError instanceof Error ? firstError.message : String(firstError),
    });

    // 2秒待ってリトライ
    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      return await generateImage(prompt, { timeoutMs });
    } catch (retryError) {
      const msg =
        retryError instanceof Error ? retryError.message : String(retryError);
      throw new Error(`CTAバナー画像の生成に失敗しました（リトライ後）: ${msg}`);
    }
  }
}
