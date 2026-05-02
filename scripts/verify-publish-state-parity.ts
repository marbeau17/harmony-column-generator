/**
 * P5-43 Step 2 準備: reviewed_at と visibility_state の parity を検証。
 *
 * 不変条件 (Step 2 移行のための前提):
 *   (reviewed_at IS NOT NULL) === (visibility_state IN ('live', 'live_hub_stale'))
 *
 * 差異がある行を全て報告。0 件なら Step 2 を安全に進められる。
 *
 * 使い方: tsx scripts/verify-publish-state-parity.ts
 */
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

// visibility_state のうち「公開中」とみなす値の集合
const PUBLIC_VISIBILITY_STATES = new Set(['live', 'live_hub_stale']);

type Row = {
  id: string;
  title: string | null;
  slug: string | null;
  reviewed_at: string | null;
  visibility_state: string | null;
};

type Mismatch = {
  id: string;
  title: string | null;
  slug: string | null;
  reviewed_at: string | null;
  visibility_state: string | null;
};

const SAMPLE_LIMIT = 10;

function printSamples(label: string, rows: Mismatch[]) {
  console.log(`\n--- ${label} (${rows.length} 件) ---`);
  if (rows.length === 0) return;
  const samples = rows.slice(0, SAMPLE_LIMIT);
  for (const r of samples) {
    console.log(
      `  id=${r.id} | visibility_state=${r.visibility_state ?? 'null'} | reviewed_at=${
        r.reviewed_at ?? 'null'
      } | title=${(r.title ?? '').slice(0, 60)}`,
    );
  }
  if (rows.length > SAMPLE_LIMIT) {
    console.log(`  ... 他 ${rows.length - SAMPLE_LIMIT} 件省略`);
  }
}

(async () => {
  // 全 articles を pagination で取得 (1499 件規模を想定)
  const PAGE_SIZE = 1000;
  const all: Row[] = [];
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await sb
      .from('articles')
      .select('id, title, slug, reviewed_at, visibility_state')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error('fetch error', error);
      process.exit(2);
    }
    if (!data || data.length === 0) break;
    all.push(...(data as Row[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  console.log(`総記事数: ${all.length}`);

  const categoryA: Mismatch[] = []; // reviewed=true, visibility 非public
  const categoryB: Mismatch[] = []; // reviewed=false, visibility=public

  // visibility_state ごとの内訳も集計 (デバッグ補助)
  const visibilityBreakdown = new Map<string, number>();

  for (const r of all) {
    const reviewed = r.reviewed_at !== null;
    const isPublicVisibility =
      r.visibility_state !== null && PUBLIC_VISIBILITY_STATES.has(r.visibility_state);

    const key = r.visibility_state ?? '(null)';
    visibilityBreakdown.set(key, (visibilityBreakdown.get(key) ?? 0) + 1);

    if (reviewed && !isPublicVisibility) {
      categoryA.push(r);
    } else if (!reviewed && isPublicVisibility) {
      categoryB.push(r);
    }
  }

  console.log('\n=== visibility_state 内訳 ===');
  for (const [k, v] of [...visibilityBreakdown.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  const totalMismatch = categoryA.length + categoryB.length;

  console.log('\n=== Parity 検証結果 ===');
  console.log(`差異総数: ${totalMismatch}`);
  console.log(`  A. reviewed=true & visibility 非public: ${categoryA.length}`);
  console.log(`  B. reviewed=false & visibility=public: ${categoryB.length}`);

  printSamples('A. reviewed_at セット済 / visibility_state 非public (Step 2 で消える可能性)', categoryA);
  printSamples('B. reviewed_at null / visibility_state public (理論上ありえない、要調査)', categoryB);

  if (totalMismatch === 0) {
    console.log('\n[OK] parity 一致。Step 2 を安全に進められます。');
    process.exit(0);
  } else {
    console.log('\n[NG] parity 不一致あり。Step 2 移行前に解消が必要です。');
    process.exit(1);
  }
})();
