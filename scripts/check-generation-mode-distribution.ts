/**
 * 全公開記事 (visibility_state IN ('live','live_hub_stale')) の
 * generation_mode 分布を確認する read-only スクリプト。
 *
 * 出力:
 *   - generation_mode ごとの件数
 *   - 各 mode の slug サンプル 5 件
 *   - 「新規作成 (zero) のみ」と「書き換え (source/null) のみ」の集計
 *
 * 使い方:
 *   tsx scripts/check-generation-mode-distribution.ts
 */
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// .env.local 読み込み
const env = fs.readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

type Row = {
  id: string;
  slug: string | null;
  title: string | null;
  generation_mode: string | null;
  status: string | null;
  visibility_state: string | null;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 未設定');
    process.exit(1);
  }

  const sb = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await sb
    .from('articles')
    .select('id, slug, title, generation_mode, status, visibility_state')
    .in('visibility_state', ['live', 'live_hub_stale']);

  if (error) {
    console.error('SELECT 失敗:', error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Row[];
  console.log(`公開記事総数 (live + live_hub_stale): ${rows.length} 件\n`);

  // mode ごとに集計
  const bucket = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.generation_mode ?? 'NULL';
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key)!.push(r);
  }

  // 件数降順でソート
  const entries = Array.from(bucket.entries()).sort(
    (a, b) => b[1].length - a[1].length,
  );

  console.log('| generation_mode | 件数 | サンプル slug |');
  console.log('|---|---|---|');
  for (const [mode, arr] of entries) {
    const samples = arr
      .slice(0, 5)
      .map((r) => r.slug ?? `(no-slug:${r.id.slice(0, 8)})`)
      .join(', ');
    console.log(`| ${mode} | ${arr.length} | ${samples} |`);
  }

  // 集計サマリ
  const zeroCount = bucket.get('zero')?.length ?? 0;
  const sourceCount = bucket.get('source')?.length ?? 0;
  const nullCount = bucket.get('NULL')?.length ?? 0;
  const otherKnown = new Set(['zero', 'source', 'NULL']);
  const otherCount = entries
    .filter(([k]) => !otherKnown.has(k))
    .reduce((sum, [, v]) => sum + v.length, 0);

  console.log('\n── サマリ ──');
  console.log(`zero (新規作成):     ${zeroCount} 件`);
  console.log(`source (書き換え):   ${sourceCount} 件`);
  console.log(`NULL:                ${nullCount} 件`);
  console.log(`その他:              ${otherCount} 件`);
  console.log('');
  console.log(`「新規作成 (zero) のみ」フィルタ:        ${zeroCount} 件`);
  console.log(`「書き換え (source / NULL) のみ」フィルタ: ${sourceCount + nullCount} 件`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
