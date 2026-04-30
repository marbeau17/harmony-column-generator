// ============================================================================
// src/lib/hallucination/validators/factual.ts
// 事実性検証器（spec §6.1）
//
// 機能:
//   - 文中から数値 / 固有名詞を抽出
//   - pgvector で source_chunks を類似検索（retrieveChunks: F2 担当）
//   - similarity スコアに基づき grounded / weak / unsupported を判定
//
// 判定基準:
//   - similarity >= 0.75 → grounded
//   - 0.65 <= similarity < 0.75 → weak
//   - similarity < 0.65 → unsupported
// ============================================================================

import type { ClaimResult, RetrieveChunksFn, RetrievedChunk } from '../types';

// ─── 抽出ヘルパー ────────────────────────────────────────────────────────────

/**
 * 文中から数値表現（百分率/年/月/日/数量）を抽出する。
 * 例: "30%", "2024年", "3割", "5回"
 */
function extractNumbers(text: string): string[] {
  const patterns = [
    /\d+(?:\.\d+)?%/g,
    /\d{4}年/g,
    /\d{1,2}月\d{1,2}日/g,
    /\d{1,2}月/g,
    /\d{1,2}日/g,
    /\d+(?:\.\d+)?(?:回|割|倍|人|件|匹|歳|代)/g,
    /\d+(?:\.\d+)?/g,
  ];

  const found = new Set<string>();
  for (const re of patterns) {
    const matches = text.match(re);
    if (matches) {
      for (const m of matches) found.add(m);
    }
  }
  return Array.from(found);
}

/**
 * 文中から固有名詞候補を抽出する。
 * カタカナ語 (3文字以上) / 漢字連続語 (3文字以上) / 英数字混在固有名詞を対象。
 */
function extractProperNouns(text: string): string[] {
  const patterns = [
    /[ァ-ヴー]{3,}/g,           // カタカナ語
    /[一-龯]{3,}/g,              // 漢字連続
    /[A-Z][A-Za-z0-9]{2,}/g,    // 英字始まりの固有名詞
  ];

  const found = new Set<string>();
  for (const re of patterns) {
    const matches = text.match(re);
    if (matches) {
      for (const m of matches) found.add(m);
    }
  }
  return Array.from(found);
}

/**
 * チャンク群の最大 similarity を取得。空配列なら 0。
 */
function maxSimilarity(chunks: RetrievedChunk[]): number {
  if (chunks.length === 0) return 0;
  return chunks.reduce((acc, c) => Math.max(acc, c.similarity ?? 0), 0);
}

// ─── F2 fallback (retrieveChunks 未実装時) ─────────────────────────────────

/**
 * F2 (RAG) が未完成でも tsc / vitest が通るように、stub を提供。
 * 実運用時は import で渡される `retrieveTopK` を必ず使う。
 */
async function fallbackRetrieve(
  _query: string,
  _topK: number
): Promise<RetrievedChunk[]> {
  return [];
}

// ─── メインエントリ ─────────────────────────────────────────────────────────

/**
 * 単一クレーム文の事実性を検証する。
 *
 * @param claim 検証対象のテキスト（1 文を想定）
 * @param retrieveTopK pgvector 検索関数（F2 が提供）。未渡しなら fallback。
 */
export async function validateFactualClaim(
  claim: string,
  retrieveTopK?: RetrieveChunksFn
): Promise<ClaimResult> {
  const numbers = extractNumbers(claim);
  const properNouns = extractProperNouns(claim);
  const targets = [...numbers, ...properNouns];

  // 抽出対象が無い場合 → 検証対象外として grounded 扱い
  if (targets.length === 0) {
    return {
      type: 'factual',
      claim,
      verdict: 'grounded',
      similarity: 1,
      severity: 'none',
      evidence: [],
      reason: '数値/固有名詞が含まれないため検証対象外',
    };
  }

  const retriever: RetrieveChunksFn = retrieveTopK ?? fallbackRetrieve;

  // クレーム全体で 1 度照合（targets ごとに分けると過剰呼び出しになる）
  const chunks = await retriever(claim, 5);
  const sim = maxSimilarity(chunks);

  let verdict: ClaimResult['verdict'];
  let severity: ClaimResult['severity'];
  if (sim >= 0.75) {
    verdict = 'grounded';
    severity = 'none';
  } else if (sim >= 0.65) {
    verdict = 'weak';
    severity = 'medium';
  } else {
    verdict = 'unsupported';
    severity = 'high';
  }

  return {
    type: 'factual',
    claim,
    verdict,
    similarity: sim,
    severity,
    evidence: chunks,
    reason: `数値:${numbers.length}件 / 固有名詞:${properNouns.length}件 / max_sim=${sim.toFixed(3)}`,
  };
}
