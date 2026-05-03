/**
 * P5-58 / H-01-H-02: 修復済み stage2_body_html から stage3_final_html を再生成。
 *
 * 背景:
 *   - P5-57 で stage2 の `<!--<img` 不正コメントを修復したが、stage3 は未更新のため
 *     Vercel `/column/[slug]/` (DB から stage3 を読む) で旧バグが見え続ける。
 *   - H-01/H-02: 本番 published 記事の多くで stage3_final_html が legacy 生成器で作られた
 *     本文 fragment 形式 (`<main>` / `<footer>` を含まない) のままになっている。
 *     そのまま CDN/Vercel 経由で配信すると <main>=0/2, <footer>=0/2 になる。
 *
 * 動作:
 *   - 修復対象 (P5-57 の rollback JSON / X10 で発見) + legacy 構造の記事 (mode 不問) を
 *     generateArticleHtml() で再生成して DB UPDATE。
 *   - 旧 generation_mode フィルタは撤去 (source モードの legacy 記事も対象)。
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

  // stage3 検査対象 (zero / source 双方を含む全記事)
  const { data, error } = await sb
    .from('articles')
    .select('id, slug, title, generation_mode, stage2_body_html, stage3_final_html');
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
    } else if (s3 && s2) {
      // H-01/H-02 修復: stage3 に <main> または <footer> が 0 個 or 2 個以上ある記事も対象
      const mainCount = (s3.match(/<main[\s>]/gi) ?? []).length;
      const footerCount = (s3.match(/<footer[\s>]/gi) ?? []).length;
      if (mainCount !== 1 || footerCount !== 1) {
        targets.push({
          id: a.id as string,
          slug: a.slug as string,
          reason: `legacy stage3 (main=${mainCount}, footer=${footerCount})`,
        });
      }
    }
  }

  console.log(`articles total: ${data?.length ?? 0} 件`);
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
