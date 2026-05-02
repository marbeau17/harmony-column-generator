/**
 * P5-43 Step 1 マイグレーション適用確認
 *
 * service-role client を使い、CHECK 制約に新値が追加されたかを検証する。
 * 実際に存在しない ID に対して visibility_state='pending_review' で UPDATE を試み、
 * - CHECK 制約違反エラーになる → 旧制約のまま (適用未完了)
 * - エラーなしで 0 行更新 → 新制約適用済み
 * を判定する。
 *
 * read-only 動作 (存在しない ID を更新するため副作用なし)。
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

const NONEXISTENT_ID = '00000000-0000-0000-0000-000000000000';

async function testValue(value: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb
    .from('articles')
    .update({ visibility_state: value })
    .eq('id', NONEXISTENT_ID);
  if (error) {
    if (error.message.includes('check constraint') || error.code === '23514') {
      return { ok: false, error: 'CHECK violation' };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

(async () => {
  console.log('=== P5-43 Step 1 マイグレーション適用確認 ===\n');

  console.log('[1] 既存値テスト (idle): 受け入れられるはず');
  const r1 = await testValue('idle');
  console.log(`    ${r1.ok ? '✅ accepted' : '❌ rejected: ' + r1.error}`);

  console.log('\n[2] 新値テスト (draft): 適用済なら accepted');
  const r2 = await testValue('draft');
  console.log(`    ${r2.ok ? '✅ accepted (適用済)' : '❌ rejected: ' + r2.error + ' → 未適用'}`);

  console.log('\n[3] 新値テスト (pending_review): 適用済なら accepted');
  const r3 = await testValue('pending_review');
  console.log(`    ${r3.ok ? '✅ accepted (適用済)' : '❌ rejected: ' + r3.error + ' → 未適用'}`);

  console.log('\n[4] 不正値テスト (invalid_xxx): 必ず rejected であるべき');
  const r4 = await testValue('invalid_xxx');
  console.log(`    ${!r4.ok ? '✅ rejected (期待通り)' : '❌ accepted (CHECK 制約壊れている?)'}`);

  console.log('\n=== 判定 ===');
  if (r1.ok && r2.ok && r3.ok && !r4.ok) {
    console.log('✅ Step 1 マイグレーション適用 OK');
    process.exit(0);
  } else {
    console.log('❌ 適用に問題あり (上記結果を確認)');
    process.exit(1);
  }
})();
