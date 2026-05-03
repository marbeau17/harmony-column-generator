import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// ─── .env.local 読み込み ─────────────────────────
const envContent = fs.readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) {
    const k = m[1];
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BASE = 'https://harmony-mc.com/spiritual/column/';
const PATTERN = /<!--<img/g;

async function main() {
  // 公開記事を取得 (status='published' or published_at IS NOT NULL)
  const { data, error } = await supabase
    .from('articles')
    .select('slug, status, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (error) { console.error('DB error:', error); process.exit(1); }
  if (!data) { console.error('no data'); process.exit(1); }

  console.log(`# 公開記事数: ${data.length}`);

  const results: { slug: string; count: number; status: string }[] = [];

  for (const row of data) {
    const url = `${BASE}${row.slug}/index.html`;
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) {
        results.push({ slug: row.slug, count: -1, status: `HTTP ${res.status}` });
        continue;
      }
      const html = await res.text();
      const matches = html.match(PATTERN);
      const count = matches ? matches.length : 0;
      results.push({ slug: row.slug, count, status: count === 0 ? 'OK' : 'BROKEN' });
    } catch (e: any) {
      results.push({ slug: row.slug, count: -1, status: `ERR ${e.message}` });
    }
  }

  console.log('\n## 結果');
  console.log('| slug | broken count | 状態 |');
  console.log('|---|---|---|');
  for (const r of results) {
    console.log(`| ${r.slug} | ${r.count} | ${r.status} |`);
  }

  const broken = results.filter(r => r.count > 0);
  const errored = results.filter(r => r.count < 0);
  console.log(`\n## サマリ`);
  console.log(`- 総数: ${results.length}`);
  console.log(`- 正常: ${results.filter(r => r.count === 0).length}`);
  console.log(`- 残存(broken>0): ${broken.length}`);
  console.log(`- エラー: ${errored.length}`);
  if (broken.length > 0) {
    console.log(`\n### 残存記事`);
    for (const b of broken) console.log(`- ${b.slug} (count=${b.count})`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
