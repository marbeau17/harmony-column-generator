// ============================================================================
// src/lib/zero-gen/run-completion.ts
//
// P5-24: zero-gen 記事の Stage2 完了後に「公開準備までを自動化」する仕上げ処理。
//
// 役割: zero-generate-async が /zero-generate-full の主要パイプラインを完走させた後、
// この関数を呼ぶことで以下が自動実行される:
//   1. outline.image_prompts → articles.image_prompts へ正規化コピー
//   2. 3 枚の実画像を Gemini Image Model で生成 → Supabase Storage upload
//   3. articles.image_files に URL を書込
//   4. meta_description / seo_filename を計算
//   5. Stage3 final HTML を generateArticleHtml で生成
//   6. articles UPDATE + revision_number=2 snapshot 保存
//
// 安全装置:
//   - status / generation_mode / is_hub_visible / reviewed_at は触らない
//   - title / slug は触らない (preserve-article-content ルール)
//
// 失敗時: throw、async route 側で job.error にメッセージを設定
// ============================================================================

import { createServiceRoleClient } from '@/lib/supabase/server';
import { generateImage } from '@/lib/ai/gemini-client';
import { generateArticleHtml } from '@/lib/generators/article-html-generator';
import {
  generateMetaDescription,
  generateSlug,
} from '@/lib/seo/meta-generator';
import { logger } from '@/lib/logger';

const STORAGE_BUCKET = 'article-images';

interface ImageFileRow {
  position: string;
  url: string;
  alt: string;
  filename: string;
}

interface PromptItem {
  position: string;
  prompt: string;
  alt_text_ja: string;
}

function mimeToExt(mime: string): string {
  const m: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
  };
  return m[mime] ?? 'webp';
}

function normalizePromptsToArray(raw: unknown, themeName: string): PromptItem[] {
  if (Array.isArray(raw)) {
    return (raw as Record<string, unknown>[])
      .filter((x) => x !== null && typeof x === 'object')
      .map((p, idx) => ({
        position: String(
          (p.position as string) ??
            (p.slot as string) ??
            (p.section_id as string) ??
            ['hero', 'body', 'summary'][idx] ??
            `pos${idx}`,
        ),
        prompt: String(p.prompt ?? ''),
        alt_text_ja: String(
          p.alt_text_ja ??
            p.alt ??
            p.heading_text ??
            `${themeName}のイメージ`,
        ),
      }))
      .filter((p) => p.position && p.prompt);
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, string>;
    return (['hero', 'body', 'summary'] as const)
      .filter((slot) => typeof obj[slot] === 'string' && obj[slot].length > 0)
      .map((slot) => ({
        position: slot,
        prompt: obj[slot],
        alt_text_ja: `${themeName}のイメージ — ${slot}`,
      }));
  }
  return [];
}

export interface CompletionResult {
  imageFilesCount: number;
  stage3HtmlChars: number;
  metaDescriptionChars: number;
  seoFilename: string;
  partial: boolean;
}

/**
 * 進捗コールバック (オプショナル)。
 * stage = 'image_prompts' | 'image_gen' | 'stage3' | 'persist'
 */
export type CompletionProgress = (stage: string, info?: Record<string, unknown>) => void;

/**
 * 既に Stage2 が完了している記事を「公開準備状態」まで進める。
 */
export async function runZeroGenCompletion(args: {
  articleId: string;
  onProgress?: CompletionProgress;
  /** 画像生成を skip する (debug 用) */
  skipImages?: boolean;
}): Promise<CompletionResult> {
  const { articleId, onProgress, skipImages = false } = args;
  const t0 = Date.now();
  const supabase = await createServiceRoleClient();

  // 1. 記事ロード (zero-gen 用に必要なフィールド)
  const { data: article, error: aErr } = await supabase
    .from('articles')
    .select('*')
    .eq('id', articleId)
    .maybeSingle();
  if (aErr || !article) {
    throw new Error(`runZeroGenCompletion: article not found: ${articleId}`);
  }
  if (!article.stage2_body_html) {
    throw new Error('runZeroGenCompletion: stage2_body_html が空です');
  }

  // outline 内の image_prompts を articles 列にコピー (P5-24)
  const outline = (article.stage1_outline as Record<string, unknown>) ?? {};
  const themeName = (article.theme as string) ?? '';
  let prompts = normalizePromptsToArray(article.image_prompts, themeName);
  if (prompts.length === 0) {
    prompts = normalizePromptsToArray(outline.image_prompts, themeName);
  }
  onProgress?.('image_prompts', { count: prompts.length });

  // 2. 画像生成 (skipImages=true なら飛ばす、既に image_files があれば飛ばす)
  let imageFiles: ImageFileRow[] = Array.isArray(article.image_files)
    ? (article.image_files as ImageFileRow[])
    : [];
  let imageGenPartial = false;

  if (skipImages) {
    logger.info('ai', 'images.skipped', { articleId, reason: 'flag' });
  } else if (imageFiles.length === prompts.length && imageFiles.length > 0) {
    logger.info('ai', 'images.skipped', {
      articleId,
      reason: 'already populated',
      count: imageFiles.length,
    });
  } else {
    const newImageFiles: ImageFileRow[] = [];
    for (const p of prompts.slice(0, 3)) {
      const tImg = Date.now();
      onProgress?.('image_gen', { position: p.position });
      try {
        const result = await generateImage(p.prompt, { timeoutMs: 90_000 });
        const path = `articles/${articleId}/${p.position}.${mimeToExt(result.mimeType)}`;
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, result.imageBuffer, {
            contentType: result.mimeType,
            upsert: true,
          });
        if (upErr) throw new Error(`storage upload (${p.position}): ${upErr.message}`);
        const { data: urlData } = supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(path);
        newImageFiles.push({
          position: p.position,
          url: urlData.publicUrl,
          alt: p.alt_text_ja,
          filename: `${p.position}.${mimeToExt(result.mimeType)}`,
        });
        logger.info('ai', 'image.ok', {
          articleId,
          position: p.position,
          elapsed_ms: Date.now() - tImg,
        });
      } catch (e) {
        imageGenPartial = true;
        logger.error('ai', 'image.failed', {
          articleId,
          position: p.position,
          error_message: (e as Error).message,
        });
      }
    }
    if (newImageFiles.length > 0) imageFiles = newImageFiles;
  }

  // 3. meta_description / seo_filename
  const metaDescription =
    (article.meta_description as string | null) ??
    generateMetaDescription(
      (article.keyword as string) ?? '',
      (article.lead_summary as string) ?? '',
    );
  const seoFilename =
    (article.seo_filename as string | null) ??
    generateSlug((article.title as string) ?? '');

  // 4. Stage3 final HTML
  onProgress?.('stage3');
  const articleForHtml = {
    ...article,
    image_files: imageFiles,
    image_prompts: prompts,
    meta_description: metaDescription,
    seo_filename: seoFilename,
  } as never;
  const stage3Html = generateArticleHtml(articleForHtml, {
    heroImage: imageFiles.find((f) => f.position === 'hero')?.url,
    heroImageAlt: imageFiles.find((f) => f.position === 'hero')?.alt,
  });

  // 5. articles UPDATE
  onProgress?.('persist');
  const { error: updErr } = await supabase
    .from('articles')
    .update({
      image_files: imageFiles,
      image_prompts: prompts,
      meta_description: metaDescription,
      seo_filename: seoFilename,
      stage3_final_html: stage3Html,
      reviewed_at: null, // ← 承認ゲートは触らない (人間判断)
    })
    .eq('id', articleId);
  if (updErr) throw new Error(`articles UPDATE failed: ${updErr.message}`);

  // 6. revision snapshot (revision_number=2、Stage3 完成版)
  try {
    await supabase.from('article_revisions').insert({
      article_id: articleId,
      revision_number: 2,
      html_snapshot: stage3Html,
      change_type: 'auto_snapshot',
      changed_by: null,
      comment: JSON.stringify({
        source: 'run-completion',
        stage: 'stage3',
        partial: imageGenPartial,
      }),
    });
  } catch (e) {
    // 履歴失敗は warning のみ (本体 UPDATE は成功させる)
    logger.warn('ai', 'revision_snapshot_failed', {
      articleId,
      error_message: (e as Error).message,
    });
  }

  logger.info('ai', 'done', {
    articleId,
    images_count: imageFiles.length,
    stage3_chars: stage3Html.length,
    meta_chars: metaDescription.length,
    seo_filename: seoFilename,
    partial: imageGenPartial,
    total_elapsed_ms: Date.now() - t0,
  });

  return {
    imageFilesCount: imageFiles.length,
    stage3HtmlChars: stage3Html.length,
    metaDescriptionChars: metaDescription.length,
    seoFilename,
    partial: imageGenPartial,
  };
}
