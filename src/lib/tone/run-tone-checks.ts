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
  const t0 = Date.now();
  console.log('[tone.run-checks.begin]', { body_chars: htmlBody.length });

  // 1. 14 項目採点
  const toneStart = Date.now();
  const tone = scoreYukikoTone(htmlBody);
  const toneElapsed = Date.now() - toneStart;

  // breakdown は Record<string, number>（フラット構造、各値は 0-1 のスコア）
  console.log('[tone.yukiko_scoring.computed]', {
    total: tone.total,
    passed: tone.passed,
    blockers_count: tone.blockers?.length ?? 0,
    blockers: tone.blockers ?? [],
    breakdown_keys: Object.keys(tone.breakdown ?? {}).length,
    breakdown_summary: Object.entries(tone.breakdown ?? {}).map(
      ([criterion, score]) => ({
        criterion,
        score,
        // breakdown はフラットな number。0 を「失格」、>=0.5 を「合格」と便宜的に扱う。
        passed: typeof score === 'number' ? score >= 0.5 : undefined,
      }),
    ),
    elapsed_ms: toneElapsed,
  });

  // 2. + 3. embedding → centroid 類似度（失敗時は 0 にフォールバック）
  let similarity = 0;
  const centroidStart = Date.now();
  try {
    const embedding = await generateEmbedding(htmlBody, 'RETRIEVAL_DOCUMENT');
    similarity = await centroidSimilarity(embedding);
  } catch (err) {
    console.warn('[run-tone-checks.centroid_fallback]', {
      reason: err instanceof Error ? err.message : String(err),
    });
    similarity = 0;
  }
  const centroidElapsed = Date.now() - centroidStart;

  const centroidPassed =
    similarity === 0 ? null : similarity >= CENTROID_SIMILARITY_THRESHOLD;
  console.log('[tone.centroid.computed]', {
    centroid_similarity: similarity,
    centroid_threshold: CENTROID_SIMILARITY_THRESHOLD,
    centroid_passed: centroidPassed,
    centroid_skipped: similarity === 0,
    elapsed_ms: centroidElapsed,
  });

  // 4. 合否判定
  // similarity が 0（centroid 不在 / embedding 失敗）の場合は tone.passed のみで判定
  const passed =
    similarity === 0
      ? tone.passed
      : tone.passed && similarity >= CENTROID_SIMILARITY_THRESHOLD;

  const result: RunToneChecksResult = {
    tone,
    centroidSimilarity: similarity,
    passed,
  };

  const totalElapsed = Date.now() - t0;
  console.log('[tone.run-checks.end]', {
    overall_passed: result.passed,
    tone_passed: result.tone.passed,
    tone_total: result.tone.total,
    centroid_similarity: result.centroidSimilarity,
    blockers: result.tone.blockers,
    total_elapsed_ms: totalElapsed,
  });

  return result;
}
