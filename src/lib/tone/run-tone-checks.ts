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
//
// 可観測化 (G2):
//   * 全フェーズに logger.info(start/end), logger.error(failed) を配置
//   * AI 呼び出し (generateEmbedding) には外側で 60s timeout、全体に 90s timeout
//   * stuck 防止: タイムアウト超過時は logger.error + throw（=> centroid fallback パス）
// ============================================================================

import { generateEmbedding } from '@/lib/ai/embedding-client';
import { logger } from '@/lib/logger';
import { centroidSimilarity } from '@/lib/tone/centroid-similarity';
import {
  scoreYukikoTone,
  type YukikoToneScore,
} from '@/lib/tone/yukiko-scoring';

/** 由起子文体 centroid との合格しきい値 */
export const CENTROID_SIMILARITY_THRESHOLD = 0.85;

/** AI 呼び出し (embedding) の単独タイムアウト */
const EMBEDDING_TIMEOUT_MS = 60_000;
/** runToneChecks 全体のタイムアウト */
const RUN_TONE_CHECKS_TIMEOUT_MS = 90_000;

export interface RunToneChecksResult {
  /** 14 項目スコアと合計 */
  tone: YukikoToneScore;
  /** 由起子文体 centroid との cosine 類似度（0-1）。失敗時は 0 */
  centroidSimilarity: number;
  /** tone.passed && centroidSimilarity >= 0.85 */
  passed: boolean;
}

/**
 * Promise を timeout 付きで実行する。
 * 超過時は Error('<label> timeout after Xms') を reject する。
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
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
  const body_chars = htmlBody?.length ?? 0;
  logger.info('ai', 'tone.run_checks.start', { body_chars });

  try {
    return await withTimeout(
      runToneChecksInner(htmlBody, t0),
      RUN_TONE_CHECKS_TIMEOUT_MS,
      'tone.run_checks',
    );
  } catch (err) {
    const e = err as Error;
    logger.error(
      'ai',
      'tone.run_checks.failed',
      {
        error: e?.message ?? String(err),
        stack: e?.stack?.slice(0, 500),
        elapsed_ms: Date.now() - t0,
        body_chars,
      },
      err,
    );
    throw err;
  }
}

/**
 * runToneChecks の本体。timeout race 用に内側関数として分離。
 */
async function runToneChecksInner(
  htmlBody: string,
  t0: number,
): Promise<RunToneChecksResult> {
  // 1. 14 項目採点（同期）
  const toneStart = Date.now();
  let tone: YukikoToneScore;
  try {
    tone = scoreYukikoTone(htmlBody);
  } catch (err) {
    const e = err as Error;
    logger.error(
      'ai',
      'tone.score_yukiko.failed',
      {
        error: e?.message ?? String(err),
        stack: e?.stack?.slice(0, 500),
      },
      err,
    );
    throw err;
  }
  const toneElapsed = Date.now() - toneStart;

  // breakdown は Record<string, number>（フラット構造、各値は 0-1 のスコア）
  logger.info('ai', 'tone.score_yukiko.end', {
    elapsed_ms: toneElapsed,
    total: tone.total,
    passed: tone.passed,
    blockers_count: tone.blockers?.length ?? 0,
    blockers: tone.blockers ?? [],
    breakdown_keys: Object.keys(tone.breakdown ?? {}).length,
  });

  // 2. + 3. embedding → centroid 類似度（失敗時は 0 にフォールバック）
  let similarity = 0;
  const centroidStart = Date.now();
  try {
    logger.info('ai', 'tone.centroid.start', {
      body_chars: htmlBody?.length ?? 0,
      embedding_timeout_ms: EMBEDDING_TIMEOUT_MS,
    });
    logger.debug('ai', 'tone.centroid.embedding_input', {
      body_chars: htmlBody?.length ?? 0,
      task_type: 'RETRIEVAL_DOCUMENT',
    });

    const embedding = await withTimeout(
      generateEmbedding(htmlBody, 'RETRIEVAL_DOCUMENT'),
      EMBEDDING_TIMEOUT_MS,
      'tone.centroid.generate_embedding',
    );

    if (!Array.isArray(embedding) || embedding.length === 0) {
      logger.error('ai', 'tone.centroid.embedding_invalid', {
        is_array: Array.isArray(embedding),
        length: Array.isArray(embedding) ? embedding.length : null,
        type: typeof embedding,
      });
      throw new Error('tone.centroid: generateEmbedding returned empty/invalid result');
    }
    logger.info('ai', 'tone.centroid.embedding_received', {
      embedding_dim: embedding.length,
      response_shape: 'number[]',
    });

    similarity = await centroidSimilarity(embedding);
    logger.info('ai', 'tone.centroid.end', {
      elapsed_ms: Date.now() - centroidStart,
      centroid_similarity: similarity,
      centroid_threshold: CENTROID_SIMILARITY_THRESHOLD,
      centroid_passed: similarity >= CENTROID_SIMILARITY_THRESHOLD,
    });
  } catch (err) {
    const e = err as Error;
    logger.warn(
      'ai',
      'tone.centroid.fallback',
      {
        reason: e?.message ?? String(err),
        stack: e?.stack?.slice(0, 500),
        elapsed_ms: Date.now() - centroidStart,
      },
      err,
    );
    similarity = 0;
  }

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
  logger.info('ai', 'tone.run_checks.end', {
    elapsed_ms: totalElapsed,
    overall_passed: result.passed,
    tone_passed: result.tone.passed,
    score: result.tone.total,
    centroid_similarity: result.centroidSimilarity,
    flagged: result.tone.blockers?.length ?? 0,
    blockers: result.tone.blockers,
  });

  return result;
}
