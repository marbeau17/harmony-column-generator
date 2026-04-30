// ============================================================================
// src/lib/tone/centroid-similarity.ts
// 由起子文体 centroid との cosine similarity 算出
//
// spec §7.2 文体 centroid マッチング:
//   - 生成記事の本文 embedding を入力として受け取る
//   - DB の yukiko_style_centroid (is_active=true) の最新 row と cosine 比較
//   - スコア [-1, 1] を返す（実際は L2 正規化済 embedding 同士なので [0, 1]）
//
// 注意:
//   * embedding 生成自体は行わない（呼び出し側が事前に generateEmbedding 済の前提）
//   * 失敗時は明示的に Error を throw（fallback 0 にしない＝品質ゲート用途）
// ============================================================================

import { createServiceRoleClient } from '@/lib/supabase/server';

/** is_active=true の centroid row（必要列のみ） */
interface ActiveCentroidRow {
  id: number;
  embedding: number[] | string;
  ngram_hash: Record<string, number> | null;
  sample_size: number | null;
  version: string;
  computed_at: string;
}

/**
 * pgvector の vector 型が文字列で返るケース（"[0.1,0.2,...]"）に対応するパーサ。
 * 配列で返ってきた場合はそのまま透過。
 */
function parseEmbedding(raw: number[] | string): number[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim().replace(/^\[/, '').replace(/\]$/, '');
    if (!trimmed) return [];
    return trimmed.split(',').map((s) => Number(s.trim()));
  }
  throw new Error('parseEmbedding: unsupported embedding format');
}

/**
 * cosine similarity を計算する。
 * 両ベクトルが非ゼロ前提。次元不一致は明示的に throw。
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity: dim mismatch (a=${a.length}, b=${b.length})`,
    );
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) {
    throw new Error('cosineSimilarity: zero-norm vector');
  }
  return dot / denom;
}

/**
 * is_active=true な centroid を DB から 1 件取得し、入力 embedding との
 * cosine similarity を返す。
 */
export async function centroidSimilarity(
  textEmbedding: number[],
): Promise<number> {
  if (!Array.isArray(textEmbedding) || textEmbedding.length === 0) {
    throw new Error('centroidSimilarity: textEmbedding must be non-empty');
  }

  const supabase = await createServiceRoleClient();

  const { data, error } = await supabase
    .from('yukiko_style_centroid')
    .select('id, embedding, ngram_hash, sample_size, version, computed_at')
    .eq('is_active', true)
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`centroidSimilarity: fetch active centroid failed: ${error.message}`);
  }
  if (!data) {
    throw new Error(
      'centroidSimilarity: no active centroid in yukiko_style_centroid (run scripts/recompute-yukiko-centroid.ts first)',
    );
  }

  const row = data as ActiveCentroidRow;
  const centroidVec = parseEmbedding(row.embedding);
  if (centroidVec.length === 0) {
    throw new Error('centroidSimilarity: active centroid has empty embedding');
  }

  return cosineSimilarity(textEmbedding, centroidVec);
}
