/**
 * P5-57: 不正コメント `<!--<img ... />` (閉じ `-->` 無し) を修復。
 * Pattern 2 regex が `>` を除外せず closing `-->` を消費していたバグの掃除。
 *
 * 検出ロジック:
 *   - stage2_body_html に `<!--<img` が含まれる
 *   - 対応する `-->` が img タグ後に存在しない
 *
 * 修正:
 *   - `<!--<img ... />` → `<img ... />` (先頭の <!-- を除去)
 *   - これで img タグが正常に表示され、本文も飲み込まれない
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

  const { data, error } = await sb
    .from('articles')
    .select('id, slug, title, stage2_body_html');

  if (error) {
    console.error('SELECT error:', error.message);
    process.exit(1);
  }

  const targets: { id: string; slug: string; before: string; after: string; count: number }[] = [];
  for (const a of data ?? []) {
    const html = (a.stage2_body_html as string) ?? '';
    if (!html.includes('<!--<img')) continue;
    // <!--<img ... /> の先頭 <!-- を除去
    const fixed = html.replace(/<!--\s*(<img\s[^>]*\/?>)/g, '$1');
    const matches = (html.match(/<!--<img/g) ?? []).length;
    if (fixed !== html) {
      targets.push({
        id: a.id as string,
        slug: a.slug as string,
        before: html,
        after: fixed,
        count: matches,
      });
    }
  }

  console.log(`zero-gen 記事: ${data?.length ?? 0} 件`);
  console.log(`不正コメント残存: ${targets.length} 件\n`);

  for (const t of targets) {
    console.log(`  ${t.slug}: ${t.count} 個の <!--<img を修復`);
  }

  if (!APPLY) {
    console.log('\n[dry-run] --apply で修復を実行します');
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync(
    `tmp/fix-broken-img-rollback-${ts}.json`,
    JSON.stringify(targets.map((t) => ({ id: t.id, slug: t.slug, before: t.before })), null, 2),
  );
  console.log(`\nロールバック JSON: tmp/fix-broken-img-rollback-${ts}.json`);

  let ok = 0;
  for (const t of targets) {
    // article_revisions に旧版 snapshot を残してから UPDATE
    await sb.from('article_revisions').insert({
      article_id: t.id,
      revision_number: 0,
      html_snapshot: t.before,
      change_type: 'auto_snapshot',
      comment: JSON.stringify({ source: 'P5-57', reason: 'fix-broken-img-comment' }),
    }).select().maybeSingle();

    const { error: e } = await sb
      .from('articles')
      .update({ stage2_body_html: t.after })
      .eq('id', t.id);
    if (e) {
      console.error(`  ❌ ${t.slug}: ${e.message}`);
    } else {
      console.log(`  ✅ ${t.slug}`);
      ok++;
    }
  }
  console.log(`\n完了: ${ok}/${targets.length}`);
})();
