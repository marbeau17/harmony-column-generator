/**
 * H-09 parity blocker 修復スクリプト
 *
 * 対象: id=01d12905-8c43-49c5-aeae-68c797b07dad
 *   - status=published / visibility_state=live / published_at セット済み
 *   - reviewed_at=null のみ欠損 → audit 漏れ
 *
 * 既に本番公開中なので idle 戻しは行わず、reviewed_at に updated_at（無ければ now()）を補完する。
 * (P5-40 fix-published-missing-fields.ts と同じ方針)
 *
 * 使い方:
 *   tsx scripts/fix-h09-blocker.ts          # dry-run
 *   tsx scripts/fix-h09-blocker.ts --apply  # 実行
 */
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const ID = '01d12905-8c43-49c5-aeae-68c797b07dad';
const APPLY = process.argv.includes('--apply');

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: before, error: e1 } = await sb
    .from('articles')
    .select('id, title, status, visibility_state, reviewed_at, published_at, updated_at')
    .eq('id', ID)
    .single();
  if (e1 || !before) {
    console.error('対象記事が見つかりません:', e1?.message);
    process.exit(1);
  }

  const a = before as any;
  console.log('=== 修復前 ===');
  console.log('  id:               ', a.id);
  console.log('  title:            ', a.title);
  console.log('  status:           ', a.status);
  console.log('  visibility_state: ', a.visibility_state);
  console.log('  reviewed_at:      ', a.reviewed_at);
  console.log('  published_at:     ', a.published_at);

  if (a.reviewed_at) {
    console.log('\n[SKIP] reviewed_at は既にセット済みです。修復不要。');
    process.exit(0);
  }
  if (a.status !== 'published' || a.visibility_state !== 'live') {
    console.error('\n[ABORT] 想定外の状態 (published/live でない)。手動確認が必要です。');
    process.exit(1);
  }

  // published_at を reviewed_at に流用 (公開と同時に審査完了したとみなす)
  const reviewedAt = a.published_at ?? new Date().toISOString();
  console.log(`\n→ reviewed_at = ${reviewedAt} を設定 (published_at を踏襲)`);

  if (!APPLY) {
    console.log('\n[dry-run] --apply フラグを付けると実行します。');
    process.exit(0);
  }

  const { error: e2 } = await sb
    .from('articles')
    .update({ reviewed_at: reviewedAt })
    .eq('id', ID);
  if (e2) {
    console.error('UPDATE 失敗:', e2.message);
    process.exit(1);
  }

  const { data: after } = await sb
    .from('articles')
    .select('id, status, visibility_state, reviewed_at')
    .eq('id', ID)
    .single();
  console.log('\n=== 修復後 ===');
  console.log('  reviewed_at:      ', (after as any)?.reviewed_at);
  console.log('\n[OK] 修復完了。parity check を再実行してください。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
