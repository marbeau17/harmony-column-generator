// ============================================================================
// scripts/recompute-yukiko-centroid.ts
// 由起子文体 centroid を再計算して yukiko_style_centroid テーブルへ INSERT する。
//
// 使い方:
//   tsx scripts/recompute-yukiko-centroid.ts
//
// 動作:
//   1. computeYukikoCentroid() で reviewed_at IS NOT NULL 記事から centroid を計算
//   2. 既存の is_active=true 行を一括で is_active=false に降格
//   3. 新しい centroid 行を is_active=true で INSERT
//
// 注意:
//   * service role key を使用するため、必ず .env.local が読み込まれた状態で実行
//   * マイグレを追加せず、既存テーブル yukiko_style_centroid をそのまま使う
//   * 記事本文への write は行わない（読み取りのみ）
// ============================================================================

import { createClient } from '@supabase/supabase-js';

// scripts/ は tsconfig 上 exclude されているため、@/ alias は使わず相対パスで参照する
import { computeYukikoCentroid } from '../src/lib/tone/compute-centroid';

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      '[recompute-yukiko-centroid] missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY',
    );
    process.exit(1);
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error('[recompute-yukiko-centroid] missing env: GEMINI_API_KEY');
    process.exit(1);
  }

  console.log('[recompute-yukiko-centroid] start');

  const result = await computeYukikoCentroid();
  console.log('[recompute-yukiko-centroid] computed', {
    sample_size: result.sample_size,
    embedding_dim: result.embedding.length,
    ngram_keys: Object.keys(result.ngram_hash).length,
  });

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  // 1) 既存 active を全て非アクティブ化
  const { error: deactivateError } = await supabase
    .from('yukiko_style_centroid')
    .update({ is_active: false })
    .eq('is_active', true);

  if (deactivateError) {
    console.error(
      '[recompute-yukiko-centroid] deactivate failed:',
      deactivateError.message,
    );
    process.exit(1);
  }

  // 2) 新 centroid を INSERT。version は ISO タイムスタンプベースで一意化
  const version = `centroid-${new Date().toISOString().replace(/[:.]/g, '-')}`;

  const { data: inserted, error: insertError } = await supabase
    .from('yukiko_style_centroid')
    .insert({
      version,
      embedding: result.embedding,
      ngram_hash: result.ngram_hash,
      sample_size: result.sample_size,
      is_active: true,
    })
    .select('id, version, sample_size, computed_at, is_active')
    .single();

  if (insertError) {
    console.error(
      '[recompute-yukiko-centroid] insert failed:',
      insertError.message,
    );
    process.exit(1);
  }

  console.log('[recompute-yukiko-centroid] inserted', inserted);
  console.log('[recompute-yukiko-centroid] done');
}

main().catch((err) => {
  console.error('[recompute-yukiko-centroid] fatal error:', err);
  process.exit(1);
});
