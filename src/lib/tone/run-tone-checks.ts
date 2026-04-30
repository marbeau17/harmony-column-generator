// ============================================================================
// src/lib/tone/run-tone-checks.ts
// 由起子トーン採点 + 文体 centroid 類似度 をまとめて実行する統合ランナー
//
// 流れ:
//   1. scoreYukikoTone(htmlBody) で 14 項目 + total を算出
//   2. htmlBody を embedding 化（RETRIEVAL_DOCUMENT）
//   3. centroidSimilarity(textEmbedding) で由起子文体類似度を取得
//   4. passed = tone.passed && centroidSimilarity >= 0.85
//
// エラーハンドリング:
//   * centroid（または embedding）取得が失敗した場合は centroidSimilarity = 0 とし、
//     passed は tone.passed のみで判定する（トーン側がブロッカーになる前提）。
// ============================================================================

import { generateEmbedding } from '@/lib/ai/embedding-client';
import { centroidSimilarity } from '@/lib/tone/centroid-similarity';
import {
  scoreYukikoTone,
  type YukikoToneScore,
} from '@/lib/tone/yukiko-scoring';

/** 由起子文体 centroid との合格しきい値 */
export const CENTROID_SIMILARITY_THRESHOLD = 0.85;

export interface RunToneChecksResult {
  /** 14 項目スコアと合計 */
  tone: YukikoToneScore;
  /** 由起子文体 centroid との cosine 類似度（0-1）。失敗時は 0 */
  centroidSimilarity: number;
  /** tone.passed && centroidSimilarity >= 0.85 */
  passed: boolean;
}

/**
 * 由起子トーン採点と文体 centroid 類似度をまとめて実行する。
 *
 * @param htmlBody 記事本文 HTML（タグ込みでよい — yukiko-scoring 側で除去）
 */
export async function runToneChecks(
  htmlBody: string,
): Promise<RunToneChecksResult> {
  // 1. 14 項目採点
  const tone = scoreYukikoTone(htmlBody);

  // 2. + 3. embedding → centroid 類似度（失敗時は 0 にフォールバック）
  let similarity = 0;
  try {
    const embedding = await generateEmbedding(htmlBody, 'RETRIEVAL_DOCUMENT');
    similarity = await centroidSimilarity(embedding);
  } catch (err) {
    console.warn('[run-tone-checks.centroid_fallback]', {
      reason: err instanceof Error ? err.message : String(err),
    });
    similarity = 0;
  }

  // 4. 合否判定
  // similarity が 0（centroid 不在 / embedding 失敗）の場合は tone.passed のみで判定
  const passed =
    similarity === 0
      ? tone.passed
      : tone.passed && similarity >= CENTROID_SIMILARITY_THRESHOLD;

  return {
    tone,
    centroidSimilarity: similarity,
    passed,
  };
}
