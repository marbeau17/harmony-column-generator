/**
 * 既存 zero-gen 記事を「公開可能 draft」状態まで仕上げる CLI
 * --------------------------------------------------------------
 * Stage2 完了済（stage2_body_html + image_prompts + claims + tone）の記事に対し:
 *   1. 画像 3 枚（hero/body/summary）を Gemini Image Model で生成 → Supabase Storage アップロード
 *   2. image_files 配列を articles に書込
 *   3. meta_description / seo_filename を計算して書込
 *   4. stage3_final_html を generateArticleHtml で生成して書込
 *   5. reviewed_at を NOW() に設定
 *
 * 安全装置:
 *   - status は draft のまま（公開しない）
 *   - is_hub_visible は触らない（ユーザ承認まで保留）
 *   - title は触らない（preserve-article-content ルール）
 *   - slug は触らない
 *
 * Usage:
 *   npx tsx scripts/ops/zero-gen-publish.ts --id=<uuid>
 *   npx tsx scripts/ops/zero-gen-publish.ts --id=<uuid> --skip-images   # 画像 skip（Stage3 のみ）
 *   npx tsx scripts/ops/zero-gen-publish.ts --id=<uuid> --force-images  # 既存 image_files 上書き
 */
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envContent = fs.readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const args = process.argv.slice(2);
const getArg = (k: string, d?: string) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=').slice(1).join('=') : d;
};
const articleId = getArg('id');
const skipImages = args.includes('--skip-images');
const forceImages = args.includes('--force-images');
if (!articleId) {
  console.error('Usage: --id=<article uuid> [--skip-images] [--force-images]');
  process.exit(1);
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

import { generateImage } from '../../src/lib/ai/gemini-client';
import { generateArticleHtml } from '../../src/lib/generators/article-html-generator';
import { generateMetaDescription, generateSlug } from '../../src/lib/seo/meta-generator';

// CLI 用 image upload — image-storage.ts は createServerSupabaseClient (cookie 依存) を使うため
// CLI からは呼べない。同等のロジックを local sb クライアント経由で実行する。
const STORAGE_BUCKET = 'article-images';
function mimeToExt(mime: string): string {
  const m: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  return m[mime] || 'webp';
}
async function uploadImageLocal(articleId: string, position: string, buf: Buffer, mime: string): Promise<string> {
  const ext = mimeToExt(mime);
  const path = `articles/${articleId}/${position}.${ext}`;
  const { error: upErr } = await sb.storage.from(STORAGE_BUCKET).upload(path, buf, { contentType: mime, upsert: true });
  if (upErr) throw new Error(`storage upload failed (${position}): ${upErr.message}`);
  const { data } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

type ImageFileRow = { position: string; url: string; alt: string; filename: string };
type PromptRow = { position: string; prompt: string; alt_text_ja: string };

function normalizePromptsToArray(raw: unknown, themeName: string): PromptRow[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
      .map((p) => ({
        position: String((p.position as string) ?? (p.slot as string) ?? ''),
        prompt: String(p.prompt ?? ''),
        alt_text_ja: String(p.alt_text_ja ?? p.alt ?? `${themeName}のイメージ`),
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

async function main() {
  const t0 = Date.now();
  console.log('=== Zero-Gen Publish (Stage2 → Stage3 + 画像) ===');
  console.log('[zero-gen.publish.start]', { articleId, skipImages, forceImages, startedAt: new Date(t0).toISOString() });

  // 1. 記事ロード
  const { data: article, error: aErr } = await sb
    .from('articles')
    .select('*')
    .eq('id', articleId)
    .maybeSingle();
  if (aErr || !article) throw new Error(`article not found: ${articleId} (${aErr?.message})`);
  if (article.generation_mode !== 'zero') throw new Error(`not zero-mode: ${article.generation_mode}`);
  if (!article.stage2_body_html) throw new Error('stage2_body_html empty — Stage2 を先に実行してください');

  console.log('[zero-gen.publish.article_loaded]', {
    id: article.id,
    title: article.title,
    theme: article.theme,
    persona: article.persona,
    keyword: article.keyword,
    has_image_prompts: Boolean(article.image_prompts),
    has_image_files: Array.isArray(article.image_files) && article.image_files.length > 0,
    has_stage3: Boolean(article.stage3_final_html),
    body_chars: (article.stage2_body_html as string).length,
  });

  // 2. 画像生成
  let imageFiles: ImageFileRow[] = Array.isArray(article.image_files) ? (article.image_files as ImageFileRow[]) : [];
  if (skipImages) {
    console.log('[zero-gen.publish.images.skipped]', { reason: '--skip-images flag' });
  } else if (imageFiles.length > 0 && !forceImages) {
    console.log('[zero-gen.publish.images.skipped]', { reason: 'already populated', count: imageFiles.length });
  } else {
    const prompts = normalizePromptsToArray(article.image_prompts, article.theme as string);
    console.log('[zero-gen.publish.images.begin]', { prompts_count: prompts.length });

    const newImageFiles: ImageFileRow[] = [];
    for (const p of prompts.slice(0, 3)) {
      const t = Date.now();
      console.log('[zero-gen.publish.image.gen.begin]', { position: p.position, prompt_chars: p.prompt.length });
      try {
        const result = await generateImage(p.prompt, { timeoutMs: 120_000 });
        console.log('[zero-gen.publish.image.gen.end]', {
          position: p.position,
          ok: true,
          mime_type: result.mimeType,
          buffer_bytes: result.imageBuffer.length,
          elapsed_ms: Date.now() - t,
        });
        const tu = Date.now();
        const url = await uploadImageLocal(articleId!, p.position, result.imageBuffer, result.mimeType);
        console.log('[zero-gen.publish.image.upload.end]', { position: p.position, ok: true, url, elapsed_ms: Date.now() - tu });
        const ext = result.mimeType.split('/')[1] || 'webp';
        newImageFiles.push({
          position: p.position,
          url,
          alt: p.alt_text_ja,
          filename: `${p.position}.${ext}`,
        });
      } catch (e) {
        console.error('[zero-gen.publish.image.gen.end]', {
          position: p.position,
          ok: false,
          error_message: (e as Error).message,
          elapsed_ms: Date.now() - t,
        });
      }
    }
    if (newImageFiles.length > 0) imageFiles = newImageFiles;
    console.log('[zero-gen.publish.images.end]', { generated: newImageFiles.length, total: imageFiles.length });
  }

  // 3. image_prompts 正規化（Stage1 で object 形だったものを array 形へ統一）
  const normalizedPrompts = normalizePromptsToArray(article.image_prompts, article.theme as string);

  // 4. meta_description 計算
  const metaDescription =
    (article.meta_description as string | null) ??
    generateMetaDescription(article.keyword as string, (article.lead_summary as string) ?? '');
  console.log('[zero-gen.publish.meta.computed]', { chars: metaDescription.length });

  // 5. seo_filename（slug） — 既存があれば保持
  const seoFilename = (article.seo_filename as string | null) ?? generateSlug(article.title as string);
  console.log('[zero-gen.publish.slug.computed]', { seo_filename: seoFilename });

  // 6. stage3_final_html 生成
  console.log('[zero-gen.publish.stage3.begin]');
  const articleForHtml = {
    ...article,
    image_files: imageFiles,
    meta_description: metaDescription,
    seo_filename: seoFilename,
  } as never;
  const stage3Html = generateArticleHtml(articleForHtml, {
    heroImage: imageFiles.find((f) => f.position === 'hero')?.url,
    heroImageAlt: imageFiles.find((f) => f.position === 'hero')?.alt,
  });
  console.log('[zero-gen.publish.stage3.end]', { html_chars: stage3Html.length });

  // 7. DB UPDATE
  console.log('[zero-gen.publish.db.update.begin]');
  const updT = Date.now();
  const upd = await sb
    .from('articles')
    .update({
      image_files: imageFiles,
      image_prompts: normalizedPrompts,
      meta_description: metaDescription,
      seo_filename: seoFilename,
      stage3_final_html: stage3Html,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', articleId)
    .select('id')
    .single();
  if (upd.error) throw new Error(`UPDATE failed: ${upd.error.message}`);
  console.log('[zero-gen.publish.db.update.end]', { ok: true, elapsed_ms: Date.now() - updT });

  // 8. 履歴 snapshot
  try {
    const { error: rErr } = await sb.from('article_revisions').insert({
      article_id: articleId,
      revision_number: 2,
      html_snapshot: stage3Html,
      change_type: 'auto_snapshot',
      changed_by: null,
      comment: JSON.stringify({ source: 'zero-gen-publish', stage: 'stage3' }),
    });
    if (rErr) throw rErr;
    console.log('[zero-gen.publish.revision_snapshot.end]', { ok: true });
  } catch (e) {
    console.warn('[zero-gen.publish.revision_snapshot.end]', { ok: false, error_message: (e as Error).message });
  }

  console.log('[zero-gen.publish.done]', {
    articleId,
    images_count: imageFiles.length,
    stage3_html_chars: stage3Html.length,
    meta_description_chars: metaDescription.length,
    seo_filename: seoFilename,
    total_elapsed_ms: Date.now() - t0,
  });
  console.log('\n✓ 完了。次は手動承認 (is_hub_visible=true) → /api/articles/[id]/deploy で FTP 投入。');
}

main().catch((err) => {
  console.error('\n✗ Publish FAILED:', err);
  process.exit(1);
});
