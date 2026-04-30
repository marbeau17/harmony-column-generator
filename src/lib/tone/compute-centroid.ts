// ============================================================================
// src/lib/tone/compute-centroid.ts
// 由起子さんの文体 centroid（重心ベクトル）計算ロジック
//
// spec §7.2 文体 centroid 計算
// ----------------------------------------------------------------------------
// - reviewed_at IS NOT NULL の articles を集める（=由起子さんがレビュー済の正例）
// - 各記事の本文を text-embedding-004 で 768 次元 embedding に変換
// - 全記事の平均ベクトルを取り、L2 正規化して centroid とする
// - 文字 4-gram の出現頻度ハッシュも併せて生成（後段の文体スコアで併用）
//
// 注意:
//   * 記事本文への write は禁止（読み取り専用）
//   * このモジュール自体は副作用を持たず、純粋に embedding を返す。
//     書き込みは scripts/recompute-yukiko-centroid.ts 側の責務。
// ============================================================================

import { createServiceRoleClient } from '@/lib/supabase/server';
import { generateEmbedding } from '@/lib/ai/gemini-client';

/** centroid 計算結果 */
export interface YukikoCentroidResult {
  /** L2 正規化済み平均 embedding（768 次元想定） */
  embedding: number[];
  /** 4-gram 出現頻度ハッシュ（key: 4-gram、value: 頻度） */
  ngram_hash: Record<string, number>;
  /** 集計に使った記事数 */
  sample_size: number;
}

/**
 * HTML タグを除去してプレーンテキスト化する（軽量版）。
 * embedding 入力としてはタグノイズを抑えたいので簡易ストリップで十分。
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 文字単位 4-gram 頻度を集計する。
 * 入力は事前に HTML 除去済みのプレーンテキストを想定。
 */
export function buildNgramHash(text: string, n = 4): Record<string, number> {
  const hash: Record<string, number> = {};
  if (!text || text.length < n) return hash;
  // 連続空白は 1 文字に圧縮済みの想定だが念のため
  const cleaned = text.replace(/\s+/g, ' ');
  for (let i = 0; i <= cleaned.length - n; i++) {
    const gram = cleaned.slice(i, i + n);
    hash[gram] = (hash[gram] ?? 0) + 1;
  }
  return hash;
}

/**
 * 複数の n-gram hash を加算合成する。
 */
function mergeNgramHashes(
  hashes: Record<string, number>[],
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const h of hashes) {
    for (const [k, v] of Object.entries(h)) {
      merged[k] = (merged[k] ?? 0) + v;
    }
  }
  return merged;
}

/**
 * 平均ベクトルを計算し L2 正規化する。
 */
function averageAndNormalize(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    throw new Error('averageAndNormalize: vectors must not be empty');
  }
  const dim = vectors[0].length;
  const sum = new Array(dim).fill(0);
  for (const v of vectors) {
    if (v.length !== dim) {
      throw new Error(
        `averageAndNormalize: vector dim mismatch (expected ${dim}, got ${v.length})`,
      );
    }
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  const avg = sum.map((x) => x / vectors.length);
  const norm = Math.sqrt(avg.reduce((acc, x) => acc + x * x, 0));
  if (norm === 0) {
    // ゼロベクトルは正規化できない。仕様上 ai 生成 embedding なので発生しない想定。
    return avg;
  }
  return avg.map((x) => x / norm);
}

/**
 * 由起子さん文体 centroid を計算する。
 *
 * 1. articles テーブルから reviewed_at IS NOT NULL の記事を全件取得
 * 2. 各記事の本文（stage3_final_html を優先、無ければ stage2_body_html）を抽出
 * 3. HTML 除去後のテキストを embedding（task_type=CLUSTERING）
 * 4. 平均ベクトルを L2 正規化して返す。同時に 4-gram hash も合成して返す。
 */
export async function computeYukikoCentroid(): Promise<YukikoCentroidResult> {
  const supabase = await createServiceRoleClient();

  const { data, error } = await supabase
    .from('articles')
    .select('id, stage3_final_html, stage2_body_html, reviewed_at')
    .not('reviewed_at', 'is', null);

  if (error) {
    throw new Error(`computeYukikoCentroid: list articles failed: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{
    id: string;
    stage3_final_html: string | null;
    stage2_body_html: string | null;
    reviewed_at: string | null;
  }>;

  if (rows.length === 0) {
    throw new Error(
      'computeYukikoCentroid: no reviewed articles found (reviewed_at IS NOT NULL = 0)',
    );
  }

  // 本文抽出 → embedding
  const embeddings: number[][] = [];
  const ngramHashes: Record<string, number>[] = [];
  let skipped = 0;

  for (const row of rows) {
    const html = row.stage3_final_html || row.stage2_body_html || '';
    const plain = stripHtml(html);
    if (!plain || plain.length < 50) {
      skipped++;
      console.warn('[centroid] skip empty/short article', {
        id: row.id,
        len: plain.length,
      });
      continue;
    }

    // task_type は文体クラスタリング用途なので CLUSTERING を採用
    // 1 article 1 embedding。長文は API 側で切り捨てられるが本実装では原文を渡す。
    const vec = await generateEmbedding(plain, 'CLUSTERING');
    embeddings.push(vec);
    ngramHashes.push(buildNgramHash(plain));
  }

  if (embeddings.length === 0) {
    throw new Error(
      'computeYukikoCentroid: no embeddings produced (all articles skipped)',
    );
  }

  const centroid = averageAndNormalize(embeddings);
  const ngram_hash = mergeNgramHashes(ngramHashes);

  console.info('[centroid] computed', {
    sample_size: embeddings.length,
    skipped,
    dim: centroid.length,
    ngram_keys: Object.keys(ngram_hash).length,
  });

  return {
    embedding: centroid,
    ngram_hash,
    sample_size: embeddings.length,
  };
}
