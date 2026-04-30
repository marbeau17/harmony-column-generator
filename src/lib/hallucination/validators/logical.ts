// ============================================================================
// src/lib/hallucination/validators/logical.ts
// 論理的整合性検証器（spec §6.4）
//
// 機能:
//   - 文ペアを Gemini (temperature=0.1) に渡して二次判定
//   - 「以下 2 文は矛盾するか? yes/no + reason」プロンプト
//   - 矛盾検出時 → severity=high
// ============================================================================

import type { ClaimResult, ContradictionJudgeFn } from '../types';

// ─── プロンプト ─────────────────────────────────────────────────────────────

export const CONTRADICTION_PROMPT = (a: string, b: string): string => `
あなたは論理整合性を判定する厳格な校閲者です。
以下の 2 文を読み、「事実関係として矛盾するか」を判定してください。

## 文A
${a}

## 文B
${b}

## 出力
JSON のみを返してください。Markdown コードフェンスは禁止。
{"contradiction": "yes" | "no", "reason": "<日本語で 100 字以内>"}
`.trim();

// ─── デフォルト judge (LLM 未注入時の no-op) ───────────────────────────────

const defaultJudge: ContradictionJudgeFn = async (_a, _b) => ({
  contradiction: false,
  reason: 'LLM judge 未注入のため判定スキップ',
});

// ─── メインエントリ ─────────────────────────────────────────────────────────

/**
 * 2 文間の論理矛盾を検証する。
 *
 * @param sentenceA 文A
 * @param sentenceB 文B
 * @param judge LLM judge 関数（DI）。未指定時は no-op。
 */
export async function validateLogicalPair(
  sentenceA: string,
  sentenceB: string,
  judge?: ContradictionJudgeFn
): Promise<ClaimResult> {
  const claim = `A: ${sentenceA} ／ B: ${sentenceB}`;

  // 同一文 / どちらかが空 → スキップ
  if (!sentenceA.trim() || !sentenceB.trim() || sentenceA.trim() === sentenceB.trim()) {
    return {
      type: 'logical',
      claim,
      verdict: 'grounded',
      similarity: 1,
      severity: 'none',
      evidence: [],
      reason: '文ペアが不正または同一のため検証対象外',
    };
  }

  const fn = judge ?? defaultJudge;

  let result: { contradiction: boolean; reason: string };
  try {
    result = await fn(sentenceA, sentenceB);
  } catch (e) {
    return {
      type: 'logical',
      claim,
      verdict: 'weak',
      similarity: 0.5,
      severity: 'medium',
      evidence: [],
      reason: `LLM 判定失敗: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (result.contradiction) {
    return {
      type: 'logical',
      claim,
      verdict: 'flagged',
      similarity: 0,
      severity: 'high',
      evidence: [],
      reason: `矛盾検出: ${result.reason}`,
    };
  }

  return {
    type: 'logical',
    claim,
    verdict: 'grounded',
    similarity: 1,
    severity: 'none',
    evidence: [],
    reason: result.reason || '矛盾なし',
  };
}
