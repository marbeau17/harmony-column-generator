// ============================================================================
// src/types/hallucination.ts
// ハルシネーション検出パイプライン共通型
//   - Claim:               文単位の主張（claim-extractor 出力）
//   - Risk:                各 Claim に対するリスク評価（risk-scorer 出力）
//   - HallucinationResult: 記事全体の検出結果（aggregator 出力）
// 仕様: spec §6.2 step1〜step3
// ============================================================================

/** Claim の種別。risk-scorer のしきい値分岐に使用する。 */
export type ClaimType =
  | 'factual'      // 事実主張（年代、数値、固有名詞、統計）
  | 'attribution'  // 引用（〇〇研究者は、〇〇によると）
  | 'spiritual'    // スピリチュアル断定（波動が、過去世が）
  | 'logical'      // 論理主張（A だから B である）
  | 'experience'   // 体験談（個人の体験）
  | 'general';     // 一般論・問いかけ

/** Risk のレベル。aggregator が verdict を決める入力。 */
export type RiskLevel = 'low' | 'medium' | 'high';

/** 文単位の主張（claim-extractor の最小出力単位）。 */
export interface Claim {
  /** 本文を句点で分割したときの 0-origin インデックス。 */
  sentence_idx: number;
  /** 主張本文（HTML タグ除去済みのプレーンテキスト）。 */
  claim_text: string;
  /** Claim の種別。 */
  claim_type: ClaimType;
}

/** Claim に紐づくリスク評価（risk-scorer の出力単位）。 */
export interface Risk {
  /** 紐づく Claim の sentence_idx と一致。 */
  sentence_idx: number;
  /** 該当 Claim 本文。 */
  claim_text: string;
  /** Claim の種別。 */
  claim_type: ClaimType;
  /** リスクレベル。 */
  risk_level: RiskLevel;
  /** 0.0–1.0 のリスクスコア。 */
  risk_score: number;
  /** 判定理由（人が読む説明）。 */
  reason: string;
}

/** ハルシネーション検出全体の結果。 */
export interface HallucinationResult {
  /** 記事ID。 */
  article_id: string;
  /** 抽出された Claim 配列。 */
  claims: Claim[];
  /** Claim ごとのリスク評価。 */
  risks: Risk[];
  /** 記事単位の総合判定。 */
  verdict: 'pass' | 'review' | 'block';
  /** 判定の根拠サマリ。 */
  summary: string;
  /** 解析日時 (ISO8601)。 */
  analyzed_at: string;
}
