// ============================================================================
// src/types/hallucination.ts
// ハルシネーション検出パイプライン共通型
//   - Claim:               文単位の主張（claim-extractor 出力）
//   - Risk:                各 Claim に対するリスク評価（risk-scorer 出力）
//   - HallucinationResult: 記事全体の検出結果（aggregator 出力）
// 仕様: spec v2.1 §6.2 step1〜step3 / §2.1（claim_type 6値・risk 4段階）
// ============================================================================

/**
 * Claim の種別（spec v2.1 で 6 値に確定）。risk-scorer のしきい値分岐に使用する。
 *
 *  - factual     : 事実主張（年代、数値、固有名詞、統計）
 *  - attribution : 引用（〇〇研究者は、〇〇によると）
 *  - spiritual   : スピリチュアル断定（波動が、過去世が）
 *  - logical     : 論理主張（A だから B である）
 *  - experience  : 体験談（個人の体験）
 *  - general     : 一般論・問いかけ
 */
export type ClaimType =
  | 'factual'
  | 'attribution'
  | 'spiritual'
  | 'logical'
  | 'experience'
  | 'general';

/**
 * Claim 種別の集合（ランタイム参照用 / バリデーション用）。
 * extractor 等で使う `ReadonlySet<ClaimType>` の生成元としても利用できる。
 */
export const CLAIM_TYPES: readonly ClaimType[] = [
  'factual',
  'attribution',
  'spiritual',
  'logical',
  'experience',
  'general',
] as const;

/**
 * Risk のレベル（spec v2.1 で `critical` を追加・4段階に確定）。
 * aggregator が verdict を決める入力。UI 側もこの 4 値で揃える。
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** RiskLevel の配列（ランタイム参照用 / 反復処理用）。 */
export const RISK_LEVELS: readonly RiskLevel[] = [
  'low',
  'medium',
  'high',
  'critical',
] as const;

/**
 * RiskLevel ごとのスコア減点重み（spec v2.1 §6.4）。
 *   score = 100 − Σ(risk_weight)
 *   risk_weight = { low:3, medium:7, high:15, critical:25 }
 *
 * 中央定義として共有し、UI / scorer / aggregator で重複定義しないこと。
 */
export interface ClaimRiskWeight {
  low: 3;
  medium: 7;
  high: 15;
  critical: 25;
}

/**
 * spec v2.1 §6.4 に準拠した RiskLevel 別重みの定数。
 * `Record<RiskLevel, number>` ではなく `ClaimRiskWeight` リテラル型でロックする。
 */
export const RISK_WEIGHT: ClaimRiskWeight = {
  low: 3,
  medium: 7,
  high: 15,
  critical: 25,
};

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
  /** リスクレベル（critical を含む 4 段階）。 */
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
