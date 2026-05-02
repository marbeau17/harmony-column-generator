/**
 * 画像未生成記事に一括で画像を生成する CLI (P5-21 (ii))
 * --------------------------------------------------------------
 * 対象: image_prompts あり、image_files が空 or 未設定 の記事すべて
 * 認証なし service role で動作 (cookies 不要、CLI 実行可能)
 *
 * 使い方:
 *   npx tsx scripts/ops/batch-image-generate.ts                      # 全件処理
 *   npx tsx scripts/ops/batch-image-generate.ts --limit=5            # 5 件まで
 *   npx tsx scripts/ops/batch-image-generate.ts --dry-run            # 対象一覧表示のみ
 *   npx tsx scripts/ops/batch-image-generate.ts --id=<uuid>          # 単一記事のみ
 */
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envContent = fs.readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const args = process.argv.slice(2);
const getArg = (k: string, fallback?: string) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=').slice(1).join('=') : fallback;
};
const limit = Number(getArg('limit', '50'));
const dryRun = args.includes('--dry-run');
const onlyId = getArg('id');

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const STORAGE_BUCKET = 'article-images';

import { generateImage } from '../../src/lib/ai/gemini-client';

function mimeToExt(mime: string): string {
  const m: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
  };
  return m[mime] || 'webp';
}

async function uploadImageLocal(
  articleId: string,
  position: string,
  buf: Buffer,
  mime: string,
): Promise<string> {
  const ext = mimeToExt(mime);
  const path = `articles/${articleId}/${position}.${ext}`;
  const { error: upErr } = await sb.storage
    .from(STORAGE_BUCKET)
    .upload(path, buf, { contentType: mime, upsert: true });
  if (upErr) throw new Error(`storage upload failed (${position}): ${upErr.message}`);
  const { data } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

interface ImagePrompt {
  prompt: string;
  position?: string;
  section_id?: string;
  alt_text_ja?: string;
  heading_text?: string;
}

interface ImageFile {
  position: string;
  url: string;
  alt: string;
  filename: string;
}

function normalizePrompts(raw: unknown, themeName: string): ImagePrompt[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
      .map((p) => ({
        prompt: String(p.prompt ?? ''),
        position: String((p.position as string) ?? (p.section_id as string) ?? ''),
        alt_text_ja: String(p.alt_text_ja ?? p.heading_text ?? `${themeName}のイメージ`),
      }))
      .filter((p) => p.position && p.prompt);
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, string>;
    return (['hero', 'body', 'summary'] as const)
      .filter((slot) => typeof obj[slot] === 'string' && obj[slot].length > 0)
      .map((slot) => ({
        prompt: obj[slot],
        position: slot,
        alt_text_ja: `${themeName}のイメージ — ${slot}`,
      }));
  }
  return [];
}

async function main() {
  const t0 = Date.now();
  console.log('=== Batch Image Generate ===');
  console.log({ limit, dryRun, onlyId: onlyId ?? '(all)' });

  let query = sb
    .from('articles')
    .select('id, article_number, title, theme, image_prompts, image_files')
    .not('image_prompts', 'is', null)
    .order('created_at', { ascending: false });
  if (onlyId) query = query.eq('id', onlyId);

  const { data, error } = await query;
  if (error) throw new Error(`articles fetch failed: ${error.message}`);

  const candidates = (data ?? []).filter((a) => {
    const files = a.image_files as ImageFile[] | null;
    return !files || !Array.isArray(files) || files.length === 0;
  });

  console.log(`総 (image_prompts あり): ${(data ?? []).length}`);
  console.log(`画像未生成: ${candidates.length} 件`);

  if (candidates.length === 0) {
    console.log('処理対象なし。終了。');
    return;
  }

  const target = candidates.slice(0, limit);
  console.log(`今回処理: ${target.length} 件 (--limit=${limit})\n`);

  if (dryRun) {
    console.log('--- DRY-RUN: 対象一覧 ---');
    for (const a of target) {
      console.log(`#${a.article_number} ${a.id} | ${a.title?.slice(0, 50) ?? ''}`);
    }
    return;
  }

  const stats = { ok: 0, partial: 0, failed: 0, total_images: 0 };
  for (const [i, article] of target.entries()) {
    const articleStartedAt = Date.now();
    console.log(
      `\n[${i + 1}/${target.length}] #${article.article_number} ${article.id} ` +
        `${article.title?.slice(0, 40) ?? ''}`,
    );

    const prompts = normalizePrompts(article.image_prompts, (article.theme as string) ?? '記事');
    console.log(`  prompts: ${prompts.length} 種`);
    if (prompts.length === 0) {
      stats.failed++;
      console.warn('  → スキップ (prompts なし)');
      continue;
    }

    const imageFiles: ImageFile[] = [];
    let articleErr = 0;
    for (const p of prompts.slice(0, 3)) {
      const t = Date.now();
      try {
        const result = await generateImage(p.prompt, { timeoutMs: 120_000 });
        const url = await uploadImageLocal(article.id, p.position!, result.imageBuffer, result.mimeType);
        const ext = result.mimeType.split('/')[1] || 'webp';
        imageFiles.push({
          position: p.position!,
          url,
          alt: p.alt_text_ja ?? '',
          filename: `${p.position}.${ext}`,
        });
        stats.total_images++;
        console.log(`    ✓ ${p.position} (${Date.now() - t}ms)`);
      } catch (e) {
        articleErr++;
        console.error(`    ✗ ${p.position}: ${(e as Error).message}`);
      }
    }

    if (imageFiles.length === 0) {
      stats.failed++;
      console.warn('  → 全失敗、skip UPDATE');
      continue;
    }

    const { error: updErr } = await sb
      .from('articles')
      .update({ image_files: imageFiles })
      .eq('id', article.id);
    if (updErr) {
      stats.failed++;
      console.error('  → UPDATE 失敗:', updErr.message);
      continue;
    }

    if (articleErr > 0) stats.partial++;
    else stats.ok++;
    console.log(
      `  ✓ ${imageFiles.length}/${prompts.length} 枚反映 (${Date.now() - articleStartedAt}ms)`,
    );
  }

  console.log('\n=== 結果 ===');
  console.log(JSON.stringify(stats, null, 2));
  console.log(`総経過: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error('\n✗ FAILED:', err);
  process.exit(1);
});
