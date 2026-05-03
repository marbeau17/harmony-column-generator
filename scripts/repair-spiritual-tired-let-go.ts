/**
 * spiritual-tired-let-go 1記事限定の placeholder 修復スクリプト。
 *
 * 状況:
 *   - image_files の url が `<id>/undefined.jpg` で全件壊れている
 *   - Storage には hero.jpg / body.jpg / summary.jpg が正しく存在する
 *   - stage2_body_html に <!--IMAGE:body:body.jpg--> と <!--IMAGE:summary:summary.jpg--> が残存
 *
 * 修復手順 (--apply で反映):
 *   1. image_files を Storage 実体 (hero/body/summary .jpg) を指す形に修復
 *   2. replaceImagePlaceholders() で stage2_body_html の placeholder を <img> に置換
 *   3. 旧 stage2 を article_revisions (change_type='image_placeholder_repair') に履歴 INSERT
 *   4. stage2_body_html / image_files / stage3_final_html を一括 UPDATE
 *      stage3 は src/lib/generators/article-html-generator の generateArticleHtml で再生成
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import {
  replaceImagePlaceholders,
  type ImageFileRow,
} from '../src/lib/zero-gen/replace-placeholders';

// .env.local
const envContent = fs.readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) {
    const k = m[1].trim();
    const v = m[2].trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

const APPLY = process.argv.includes('--apply');
const SLUG = 'spiritual-tired-let-go';

(async () => {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: full, error } = await sb
    .from('articles')
    .select('*')
    .eq('slug', SLUG)
    .maybeSingle();
  if (error || !full) {
    console.error('ERROR fetch:', error ?? 'not found');
    process.exit(1);
  }

  const id = full.id as string;
  const stage2: string = full.stage2_body_html ?? '';
  const oldImageFiles = Array.isArray(full.image_files) ? (full.image_files as Array<Record<string, unknown>>) : [];

  // ---- 1. image_files 修復 -----------------------------------------------
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, '');
  const baseUrl = `${supabaseUrl}/storage/v1/object/public/article-images/articles/${id}`;
  const fixedImageFiles: ImageFileRow[] = (['hero', 'body', 'summary'] as const).map((position) => {
    const old = oldImageFiles.find((o) => (o.position as string) === position) ?? {};
    return {
      position,
      url: `${baseUrl}/${position}.jpg`,
      filename: `${position}.jpg`,
      alt: typeof old.alt === 'string' ? (old.alt as string) : '',
    };
  });

  console.log('=== image_files 修復 ===');
  for (const f of fixedImageFiles) console.log('  +', JSON.stringify(f));

  // ---- 2. stage2 placeholder 置換 ----------------------------------------
  const repl = replaceImagePlaceholders(stage2, fixedImageFiles);
  console.log('\n=== replaceImagePlaceholders ===');
  console.log(`  phase1=${repl.phase1} phase2=${repl.phase2} mismatched=${repl.mismatched}`);
  console.log(`  before len=${stage2.length} after len=${repl.html.length}`);

  // ---- 3. stage3 再生成 (preview) -----------------------------------------
  const { generateArticleHtml } = await import('../src/lib/generators/article-html-generator');
  const { getOgImageUrl } = await import('../src/lib/config/public-urls');

  const articleForGen = {
    ...full,
    stage2_body_html: repl.html,
    image_files: fixedImageFiles,
  };
  const stage3Html = generateArticleHtml(articleForGen as any, {
    heroImage: `${baseUrl}/hero.jpg`,
    heroImageAlt: (full.title as string) || SLUG,
    ogImage: getOgImageUrl(SLUG, 'hero'),
  });
  console.log(`\n=== stage3 再生成 ===`);
  console.log(`  stage3 len=${stage3Html.length}`);
  // stage3 placeholder 残存検査
  const remainingPlaceholder =
    /IMAGE:(?:hero|body|summary)\b|<!--\s*IMAGE[：:][^>]*-->|<p[^>]*>\s*IMAGE[：:]/.test(stage3Html);
  console.log(`  stage3 placeholder 残存: ${remainingPlaceholder}`);

  if (!APPLY) {
    console.log('\n[dry-run] --apply で反映');
    return;
  }

  // ---- 4. ロールバック JSON 保存 ------------------------------------------
  const tmpDir = path.resolve(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const rollbackPath = path.join(tmpDir, `repair-${SLUG}-rollback-${ts}.json`);
  fs.writeFileSync(
    rollbackPath,
    JSON.stringify(
      {
        id,
        slug: SLUG,
        before_stage2_html: stage2,
        before_image_files: oldImageFiles,
        before_stage3_final_html: full.stage3_final_html,
        after_stage2_html: repl.html,
        after_image_files: fixedImageFiles,
        after_stage3_final_html: stage3Html,
      },
      null,
      2,
    ),
    'utf-8',
  );
  console.log(`\nロールバック JSON: ${rollbackPath}`);

  // ---- 5. article_revisions に履歴 INSERT ---------------------------------
  const { data: existing, error: selErr } = await sb
    .from('article_revisions')
    .select('revision_number')
    .eq('article_id', id)
    .order('revision_number', { ascending: false })
    .limit(1);
  if (selErr) {
    console.error('rev SELECT error:', selErr);
    process.exit(1);
  }
  const nextRev = existing && existing.length > 0 ? (existing[0].revision_number ?? 0) + 1 : 1;
  const { error: insErr } = await sb.from('article_revisions').insert({
    article_id: id,
    revision_number: nextRev,
    html_snapshot: stage2,
    change_type: 'image_placeholder_repair',
    changed_by: 'script:repair-spiritual-tired-let-go',
    comment: JSON.stringify({
      reason: 'image_files の URL が undefined.jpg で壊れていたため修復 + placeholder 再置換 + stage3 再生成',
      phase1: repl.phase1,
      phase2: repl.phase2,
    }),
  });
  if (insErr) {
    console.error('rev INSERT error:', insErr);
    process.exit(1);
  }
  console.log(`article_revisions 履歴 INSERT 完了 (rev=${nextRev})`);

  // ---- 6. articles UPDATE -------------------------------------------------
  const { error: updErr } = await sb
    .from('articles')
    .update({
      stage2_body_html: repl.html,
      stage3_final_html: stage3Html,
      image_files: fixedImageFiles,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (updErr) {
    console.error('articles UPDATE error:', updErr);
    process.exit(1);
  }
  console.log('articles UPDATE 完了');
})();
