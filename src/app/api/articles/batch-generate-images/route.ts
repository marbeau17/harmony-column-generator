// ============================================================================
// POST /api/articles/batch-generate-images
// プロンプトはあるが画像がない全記事に対して一括で画像生成
// ============================================================================

import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { generateImage } from '@/lib/ai/gemini-client';
import { uploadImage } from '@/lib/storage/image-storage';
import { logger } from '@/lib/logger';
// P5-104 五重防御の経路統一: dual-schema (stage1-outline / image-prompt) を canonical 化。
import { normalizeImagePrompts } from '@/lib/content/image-prompts-normalizer';

export const maxDuration = 300;

export async function POST() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '認証が必要です' }, { status: 401 });

    const serviceClient = await createServiceRoleClient();

    // プロンプトはあるが画像がない記事を取得
    const { data: articles, error } = await serviceClient
      .from('articles')
      .select('id, title, image_prompts, image_files')
      .not('image_prompts', 'is', null)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: '記事の取得に失敗しました' }, { status: 500 });
    }

    // 画像がない記事をフィルタ
    const needImages = (articles ?? []).filter((a) => {
      const files = a.image_files as unknown[] | null;
      return !files || !Array.isArray(files) || files.length === 0;
    });

    if (needImages.length === 0) {
      return NextResponse.json({ message: '画像生成が必要な記事はありません', processed: 0 });
    }

    logger.info('api', 'batchGenerateImages.start', { count: needImages.length });

    const results: { articleId: string; title: string; imagesGenerated: number; errors: string[] }[] = [];

    for (const article of needImages) {
      // P5-104 五重防御 (Phase 1 normalizer): dual-schema 並存を canonical 化。
      // 不正な要素を含む記事はスキップして errors に記録 (silent skip 禁止)。
      let prompts;
      try {
        prompts = normalizeImagePrompts(article.image_prompts).slice(0, 3);
      } catch (normalizeErr) {
        const msg = normalizeErr instanceof Error ? normalizeErr.message : String(normalizeErr);
        logger.warn('api', 'batchGenerateImages.normalize_failed', { articleId: article.id, error: msg });
        results.push({
          articleId: article.id,
          title: (article.title as string) || '(無題)',
          imagesGenerated: 0,
          errors: [`画像プロンプトの形式が不正: ${msg}`],
        });
        continue;
      }
      if (prompts.length === 0) continue;

      const imageFiles: { position: string; url: string; alt: string; filename: string }[] = [];
      const errors: string[] = [];

      for (const imgPrompt of prompts) {
        try {
          logger.info('api', 'batchGenerateImages.generating', { articleId: article.id, position: imgPrompt.position });
          const result = await generateImage(imgPrompt.prompt, { timeoutMs: 90_000 });
          const url = await uploadImage(article.id, imgPrompt.position, result.imageBuffer, result.mimeType);
          imageFiles.push({
            position: imgPrompt.position,
            url,
            alt: imgPrompt.alt,
            filename: `${imgPrompt.position}.webp`,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${imgPrompt.position}: ${msg}`);
          logger.warn('api', 'batchGenerateImages.imageFailed', { articleId: article.id, position: imgPrompt.position, error: msg });
        }
      }

      if (imageFiles.length > 0) {
        await serviceClient
          .from('articles')
          .update({ image_files: imageFiles, updated_at: new Date().toISOString() })
          .eq('id', article.id);
      }

      results.push({
        articleId: article.id,
        title: (article.title as string) || '(無題)',
        imagesGenerated: imageFiles.length,
        errors,
      });
    }

    const totalImages = results.reduce((sum, r) => sum + r.imagesGenerated, 0);
    logger.info('api', 'batchGenerateImages.complete', { articles: results.length, totalImages });

    return NextResponse.json({
      message: `${results.length}記事、${totalImages}枚の画像を生成しました`,
      processed: results.length,
      totalImages,
      results,
    });
  } catch (err) {
    logger.error('api', 'batchGenerateImages', undefined, err);
    return NextResponse.json(
      { error: '一括画像生成に失敗しました', detail: process.env.NODE_ENV === 'development' ? String(err) : undefined },
      { status: 500 },
    );
  }
}
