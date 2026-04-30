// ============================================================================
// src/lib/hallucination/types.ts
// ハルシネーション検証層の共通型（spec §6）
// ============================================================================

/** 検証対象の 4 タイプ */
export type ClaimType = 'factual' | 'attribution' | 'spiritual' | 'logical';

/** 検証結果の判定ラベル */
export type Verdict = 'grounded' | 'weak' | 'unsupported' | 'flagged';

/** 重大度。score 算出時の重み付けに使う。 */
export type Severity = 'none' | 'low' | 'medium' | 'high' | 'critical';

/** RAG 検索結果（F2 が返すチャンク） */
export interface RetrievedChunk {
  id: string;
  content: string;
  similarity: number;
  source?: string;
}

/** F2 担当の RAG retrieve 関数シグネチャ */
export type RetrieveChunksFn = (
  query: string,
  topK: number
) => Promise<RetrievedChunk[]>;

/** 論理矛盾 LLM judge のシグネチャ */
export type ContradictionJudgeFn = (
  a: string,
  b: string
) => Promise<{ contradiction: boolean; reason: string }>;

/** 個別クレームの検証結果 */
export interface ClaimResult {
  type: ClaimType;
  claim: string;
  verdict: Verdict;
  /** 0..1 範囲の類似度／確信度 */
  similarity: number;
  severity: Severity;
  evidence: RetrievedChunk[];
  reason: string;
}

/** 集計結果 */
export interface HallucinationResult {
  /** 0..100 のハルシネーション安全性スコア（高いほど安全） */
  hallucination_score: number;
  results: ClaimResult[];
  summary: {
    total: number;
    grounded: number;
    weak: number;
    unsupported: number;
    flagged: number;
    critical_hits: number;
  };
}

/** validateHallucination の入力ペイロード */
export interface ClaimsPayload {
  factualClaims: string[];
  attributionClaims: string[];
  spiritualClaims: string[];
  logicalPairs: Array<[string, string]>;
}

/** 外部 DI（テスト時に Mock 可） */
export interface HallucinationDeps {
  retrieveTopK?: RetrieveChunksFn;
  judgeContradiction?: ContradictionJudgeFn;
}
