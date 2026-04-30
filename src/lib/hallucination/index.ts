// ============================================================================
// src/lib/hallucination/index.ts
// ハルシネーション検証層エントリポイント（spec §6）
//
// 機能:
//   - 4 検証器（factual / attribution / spiritual / logical）を Promise.all で並列実行
//   - 結果を集計し hallucination_score (0..100) を算出
//
// スコア算出:
//   base = 100
//   減点 (severity 別):
//     critical → -25
//     high     → -15
//     medium   → -7
//     low      → -3
//   下限 0、上限 100。
// ============================================================================

import { validateFactualClaim } from './validators/factual';
import { validateAttributionClaim } from './validators/attribution';
import { validateSpiritualClaim } from './validators/spiritual';
import { validateLogicalPair } from './validators/logical';
import type {
  ClaimResult,
  ClaimsPayload,
  HallucinationDeps,
  HallucinationResult,
  Severity,
} from './types';

const SEVERITY_PENALTY: Record<Severity, number> = {
  none: 0,
  low: 3,
  medium: 7,
  high: 15,
  critical: 25,
};

function calcScore(results: ClaimResult[]): number {
  const total = results.reduce((acc, r) => acc + SEVERITY_PENALTY[r.severity], 0);
  return Math.max(0, Math.min(100, 100 - total));
}

function summarize(results: ClaimResult[]): HallucinationResult['summary'] {
  return {
    total: results.length,
    grounded: results.filter((r) => r.verdict === 'grounded').length,
    weak: results.filter((r) => r.verdict === 'weak').length,
    unsupported: results.filter((r) => r.verdict === 'unsupported').length,
    flagged: results.filter((r) => r.verdict === 'flagged').length,
    critical_hits: results.filter((r) => r.severity === 'critical').length,
  };
}

/**
 * 4 種のクレーム検証を並列実行し、ハルシネーション総合判定を返す。
 *
 * @param claims 検証対象のクレーム群（spec §6 で定義された分類済み入力）
 * @param deps   F2 RAG retriever / Gemini judge を注入する DI
 */
export async function validateHallucination(
  claims: ClaimsPayload,
  deps: HallucinationDeps = {}
): Promise<HallucinationResult> {
  const factualPromises = claims.factualClaims.map((c) =>
    validateFactualClaim(c, deps.retrieveTopK)
  );
  const attributionPromises = claims.attributionClaims.map((c) =>
    validateAttributionClaim(c)
  );
  const spiritualPromises = claims.spiritualClaims.map((c) =>
    validateSpiritualClaim(c)
  );
  const logicalPromises = claims.logicalPairs.map(([a, b]) =>
    validateLogicalPair(a, b, deps.judgeContradiction)
  );

  const all = await Promise.all([
    Promise.all(factualPromises),
    Promise.all(attributionPromises),
    Promise.all(spiritualPromises),
    Promise.all(logicalPromises),
  ]);

  const results: ClaimResult[] = all.flat();
  return {
    hallucination_score: calcScore(results),
    results,
    summary: summarize(results),
  };
}

// 個別 validator も再 export（呼び出し元から直接利用したい場合用）
export { validateFactualClaim } from './validators/factual';
export { validateAttributionClaim } from './validators/attribution';
export { validateSpiritualClaim } from './validators/spiritual';
export { validateLogicalPair } from './validators/logical';
export type {
  ClaimResult,
  ClaimsPayload,
  ClaimType,
  ContradictionJudgeFn,
  HallucinationDeps,
  HallucinationResult,
  RetrieveChunksFn,
  RetrievedChunk,
  Severity,
  Verdict,
} from './types';
