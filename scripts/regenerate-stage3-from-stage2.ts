/**
 * P5-58: 修復済み stage2_body_html から stage3_final_html を再生成。
 *
 * 背景: P5-57 で stage2 の `<!--<img` 不正コメントを修復したが、stage3 は未更新のため
 *       Vercel `/column/[slug]/` (DB から stage3 を読む) で旧バグが見え続ける。
 *
 * 動作: 修復した記事 (P5-57 の rollback JSON 参照) + 残存 article (X10 で発見) の stage3 を
 *       generateArticleHtml() で再生成して DB UPDATE。
 */
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
}

const APPLY = process.argv.includes('--apply');

(async () => {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // stage3 中に <!--<img を含む記事をスキャン (DB 全件)
  const { data, error } = await sb
    .from('articles')
    .select('id, slug, title, stage2_body_html, stage3_final_html')
    .eq('generation_mode', 'zero');
  if (error) {
    console.error(error);
    process.exit(1);
  }

  const targets: { id: string; slug: string; reason: string }[] = [];
  for (const a of data ?? []) {
    const s2 = (a.stage2_body_html as string) ?? '';
    const s3 = (a.stage3_final_html as string) ?? '';
    if (s3.includes('<!--<img')) {
      targets.push({
        id: a.id as string,
        slug: a.slug as string,
        reason: 'stage3 contains <!--<img',
      });
    } else if (!s3 && s2) {
      targets.push({
        id: a.id as string,
        slug: a.slug as string,
        reason: 'stage3 empty but stage2 exists',
      });
    }
  }

  console.log(`zero-gen: ${data?.length ?? 0} 件`);
  console.log(`stage3 再生成対象: ${targets.length} 件\n`);
  for (const t of targets) console.log(`  - ${t.slug}: ${t.reason}`);

  if (!APPLY) {
    console.log('\n[dry-run] --apply で再生成');
    return;
  }

  const { generateArticleHtml } = await import('../src/lib/generators/article-html-generator');
  const { getOgImageUrl } = await import('../src/lib/config/public-urls');

  let ok = 0;
  for (const t of targets) {
    const { data: full } = await sb
      .from('articles')
      .select('*')
      .eq('id', t.id)
      .maybeSingle();
    if (!full) {
      console.error(`  ❌ ${t.slug}: not found`);
      continue;
    }
    try {
      const html = generateArticleHtml(full as any, {
        heroImage: 'images/hero.jpg',
        heroImageAlt: (full.title as string) || (full.slug as string),
        ogImage: getOgImageUrl((full.slug as string) || (full.id as string), 'hero'),
      });
      const { error: e } = await sb
        .from('articles')
        .update({ stage3_final_html: html })
        .eq('id', t.id);
      if (e) {
        console.error(`  ❌ ${t.slug}: ${e.message}`);
      } else {
        console.log(`  ✅ ${t.slug} (${html.length} bytes)`);
        ok++;
      }
    } catch (e) {
      console.error(`  ❌ ${t.slug}: ${(e as Error).message}`);
    }
  }
  console.log(`\n完了: ${ok}/${targets.length}`);
})();
