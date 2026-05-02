/**
 * P5-43 Step 2/3 parity 検証: reviewed_at と visibility_state の整合性を確認。
 *
 * 不変条件 (Step 2 移行のための前提):
 *   (reviewed_at IS NOT NULL) === (visibility_state IN ('live', 'live_hub_stale'))
 *
 * Step 3 後の追加判定 (writers migration 完了後):
 *   - `visibility_state='pending_review'` の記事が増える (writer が直接付与)
 *   - これらは reviewed_at=null かつ非 public なので integrity OK
 *   - 単に「Step 3 で writer 経路統一済み」を示す指標として pending_review 件数を集計に追加
 *
 * 差異がある行を全て報告。blocker 0 件なら Step 2/3 を安全に進められる。
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

  // 不整合 A をさらに分類:
  //   A1 (audit drift): reviewed_at 残存だが visibility_state が unpublished/idle で
  //                     historical audit として正しく非公開扱い → Step 2 影響なし
  //   A2 (blocker): visibility_state が new ノード (draft, pending_review) など
  //                 上記以外。Step 2 で readers が変わると挙動変化する可能性あり
  const ACCEPTABLE_NON_PUBLIC = new Set(['unpublished', 'idle', 'failed']);

  const categoryA1_drift: Mismatch[] = []; // historical audit, OK to ignore
  const categoryA2_blocker: Mismatch[] = []; // genuine blocker
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
      const vs = r.visibility_state ?? '';
      if (ACCEPTABLE_NON_PUBLIC.has(vs)) {
        categoryA1_drift.push(r);
      } else {
        categoryA2_blocker.push(r);
      }
    } else if (!reviewed && isPublicVisibility) {
      categoryB.push(r);
    }
  }

  console.log('\n=== visibility_state 内訳 ===');
  for (const [k, v] of [...visibilityBreakdown.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  // Step 3 後の指標: writer 経路統一により pending_review が増える想定。
  // reviewed_at=null かつ非 public なので integrity 上 OK。
  const pendingReviewCount = visibilityBreakdown.get('pending_review') ?? 0;
  console.log(
    `\n=== Step 3 指標 ===\n  pending_review 件数: ${pendingReviewCount} ` +
      `(writer 経路統一後の正常状態。reviewed_at=null & 非 public なので integrity OK)`,
  );

  console.log('\n=== Parity 検証結果 ===');
  console.log(`A1. reviewed=true & visibility ∈ {idle,unpublished,failed}: ${categoryA1_drift.length} 件 (audit drift / 許容)`);
  console.log(`A2. reviewed=true & visibility ∈ {draft,pending_review,deploying,他}: ${categoryA2_blocker.length} 件 (Step 2 blocker)`);
  console.log(`B.  reviewed=false & visibility=public: ${categoryB.length} 件 (Step 2 blocker)`);

  printSamples('A1. audit drift (Step 2 影響なし)', categoryA1_drift);
  printSamples('A2. Step 2 blocker (要対処)', categoryA2_blocker);
  printSamples('B.  Step 2 blocker — 未審査なのに public (要対処)', categoryB);

  const blockers = categoryA2_blocker.length + categoryB.length;
  if (blockers === 0) {
    console.log(`\n[OK] Step 2 移行可能。audit drift ${categoryA1_drift.length} 件は historical 履歴で許容。`);
    process.exit(0);
  } else {
    console.log(`\n[NG] Step 2 ブロッカー ${blockers} 件あり。移行前に解消が必要です。`);
    process.exit(1);
  }
})();
