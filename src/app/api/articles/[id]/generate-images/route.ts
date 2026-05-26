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
// P5-104 五重防御の経路統一: dual-schema (stage1-outline / image-prompt) を canonical 化。
import { normalizeImagePrompts } from '@/lib/content/image-prompts-normalizer';
// P5-68 E3: ローカル独自実装の replaceImagePlaceholders を canonical 共通実装に統合。
//   旧実装は Phase 1 のみ・class="placeholder" 限定の div ラップを扱っていたが、
//   canonical (src/lib/zero-gen/replace-placeholders.ts) は
//     - Phase 1 (位置名付き) + Phase 2 (順序割当) + Phase 3 (残存検出ログ)
//     - <div[^>]*>...</div> による class 非依存マッチ
//     - 安全な裸 placeholder regex (`>` を含まない安全文字のみ)
//   をすべて備え、過去のミスマッチ事例 (P5-55/57/58) に対する regression テストで保護されている。
import { replaceImagePlaceholders } from '@/lib/zero-gen/replace-placeholders';

// Vercel Serverless 最大実行時間を300秒に設定
export const maxDuration = 300;

// ─── 型定義 ────────────────────────────────────────────────────────────────

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

  // 2. 記事取得（本文HTMLも取得して画像挿入用に使う）
  const { data: article, error: articleError } = await supabase
    .from('articles')
    .select('id, title, image_prompts, stage2_body_html, stage3_final_html')
    .eq('id', articleId)
    .single();

  if (articleError || !article) {
    return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 });
  }

  // 3. image_prompts の検証 — P5-104 normalizer 経由で dual-schema を canonical 化。
  //    不正な要素が 1 件でも含まれていれば throw → 400 で UI に明示。
  //    silent-skip と 'hero' フォールバックでの上書きを物理的に不可能にする。
  const rawPrompts = article.image_prompts;
  if (!rawPrompts || !Array.isArray(rawPrompts) || rawPrompts.length === 0) {
    return NextResponse.json(
      { error: '画像プロンプトが未生成です。先に画像プロンプトを生成してください。' },
      { status: 400 },
    );
  }

  let prompts;
  try {
    prompts = normalizeImagePrompts(rawPrompts).slice(0, MAX_IMAGES);
  } catch (normalizeErr) {
    const msg = normalizeErr instanceof Error ? normalizeErr.message : String(normalizeErr);
    logger.error('ai', 'generate_images.normalize_failed', { articleId, errorMessage: msg }, normalizeErr);
    return NextResponse.json(
      { error: `画像プロンプトの形式が不正です: ${msg}` },
      { status: 400 },
    );
  }

  logger.info('ai', 'generate_images.start', {
    articleId,
    promptsCount: prompts.length,
  });

  // 4. 各プロンプトに対して画像生成 → アップロード
  const results: ImageResult[] = [];
  const errors: ImageError[] = [];

  for (const item of prompts) {
    const { position, prompt, alt } = item;
    const alt_text_ja = alt;

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
      filename: `${r.position}.jpg`,
    }));

    // 本文HTMLのプレースホルダーを実画像に自動置換 (canonical 共通実装を使用)
    const replacePlaceholdersInHtml = (html: string | null): string | null => {
      if (!html) return null;
      const { html: replaced, mismatched } = replaceImagePlaceholders(html, imageFiles);
      if (mismatched > 0) {
        logger.warn('ai', 'generate_images.placeholder_mismatch', {
          articleId,
          mismatched,
        });
      }
      return replaced;
    };

    const updatedStage2 = replacePlaceholdersInHtml(article.stage2_body_html as string | null);
    const updatedStage3 = replacePlaceholdersInHtml(article.stage3_final_html as string | null);

    try {
      const updateFields: Record<string, unknown> = {
        image_files: imageFiles,
        updated_at: new Date().toISOString(),
      };
      if (updatedStage2) updateFields.stage2_body_html = updatedStage2;
      if (updatedStage3) updateFields.stage3_final_html = updatedStage3;

      const { error: updateError } = await supabase
        .from('articles')
        .update(updateFields)
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
