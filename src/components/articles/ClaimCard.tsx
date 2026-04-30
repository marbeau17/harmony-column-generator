'use client';

/**
 * ClaimCard
 * ハルシネーション検出結果の個別 Claim 表示コンポーネント。
 * - risk レベルで色分け
 * - claim_type バッジ
 * - source_chunk があれば表示
 * - 「該当文へスクロール」ボタン
 *
 * 注意: DB 書込は一切行わず、render 専用。
 */

import type { Claim, ClaimType, RiskLevel } from '@/types/hallucination';

/**
 * UI 表示用に拡張したリスクレベル。
 * 仕様書では `critical` 表記が登場するため、表示側のみ critical を許容する。
 * 型定義 (src/types/hallucination.ts) の RiskLevel には影響しない。
 */
export type DisplayRiskLevel = RiskLevel | 'critical';

/**
 * ClaimResult: Claim に紐づくリスク評価結果。
 * (※ types/hallucination.ts には未定義のため、ここで UI ローカル型として定義)
 */
export interface ClaimResult {
  risk_level: DisplayRiskLevel;
  risk_score?: number;
  reason?: string;
  /** 根拠となる元記事のチャンク（あれば表示）。 */
  source_chunk?: string | null;
  /** 修正案（あれば表示）。 */
  suggestion?: string | null;
}

interface Props {
  claim: Claim & ClaimResult;
  /** カード上部の「該当文へスクロール」ボタン押下時のハンドラ。 */
  onScrollTo?: () => void;
}

/** リスクレベル別の Tailwind クラス（light/dark 両対応）。 */
const RISK_CLS: Record<DisplayRiskLevel, { wrap: string; badge: string; label: string }> = {
  critical: {
    wrap: 'border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950/40',
    badge: 'bg-red-600 text-white dark:bg-red-500',
    label: 'CRITICAL',
  },
  high: {
    wrap: 'border-orange-400 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/40',
    badge: 'bg-orange-500 text-white dark:bg-orange-400 dark:text-orange-950',
    label: 'HIGH',
  },
  medium: {
    wrap: 'border-yellow-400 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-950/40',
    badge: 'bg-yellow-400 text-yellow-950 dark:bg-yellow-300 dark:text-yellow-950',
    label: 'MEDIUM',
  },
  low: {
    wrap: 'border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900/40',
    badge: 'bg-stone-400 text-white dark:bg-stone-600 dark:text-stone-100',
    label: 'LOW',
  },
};

/** Claim 種別別の日本語ラベル。 */
const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  factual: '事実主張',
  attribution: '引用',
  spiritual: 'スピリチュアル',
  logical: '論理',
  experience: '体験談',
  general: '一般論',
};

export default function ClaimCard({ claim, onScrollTo }: Props) {
  const risk = RISK_CLS[claim.risk_level] ?? RISK_CLS.low;
  const typeLabel = CLAIM_TYPE_LABEL[claim.claim_type] ?? claim.claim_type;

  return (
    <article
      className={`rounded-md border p-3 text-sm shadow-sm ${risk.wrap}`}
      data-claim-idx={claim.sentence_idx}
      data-risk-level={claim.risk_level}
    >
      {/* ヘッダ: risk バッジ + type バッジ + score */}
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold tracking-wider ${risk.badge}`}
        >
          {risk.label}
        </span>
        <span className="inline-flex items-center rounded border border-stone-300 bg-white px-2 py-0.5 text-xs text-stone-700 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200">
          {typeLabel}
        </span>
        {typeof claim.risk_score === 'number' && (
          <span className="text-xs text-stone-500 dark:text-stone-400">
            score: {claim.risk_score.toFixed(2)}
          </span>
        )}
        <span className="ml-auto text-xs text-stone-500 dark:text-stone-400">
          #{claim.sentence_idx}
        </span>
      </header>

      {/* claim text 本体 */}
      <p className="mb-2 whitespace-pre-wrap text-stone-900 dark:text-stone-100">
        {claim.claim_text}
      </p>

      {/* reason (任意) */}
      {claim.reason && (
        <p className="mb-2 text-xs leading-relaxed text-stone-600 dark:text-stone-300">
          <span className="font-semibold">理由:</span> {claim.reason}
        </p>
      )}

      {/* source_chunk (任意) */}
      {claim.source_chunk && (
        <details className="mb-2 rounded border border-stone-200 bg-white/60 p-2 text-xs dark:border-stone-700 dark:bg-stone-900/50">
          <summary className="cursor-pointer text-stone-700 dark:text-stone-200">
            元記事の該当箇所
          </summary>
          <p className="mt-1 whitespace-pre-wrap text-stone-700 dark:text-stone-300">
            {claim.source_chunk}
          </p>
        </details>
      )}

      {/* suggestion (任意・修正案) */}
      {claim.suggestion && (
        <details className="mb-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs dark:border-emerald-800 dark:bg-emerald-950/40">
          <summary className="cursor-pointer text-emerald-800 dark:text-emerald-200">
            修正案を表示
          </summary>
          <p className="mt-1 whitespace-pre-wrap text-emerald-900 dark:text-emerald-100">
            {claim.suggestion}
          </p>
        </details>
      )}

      {/* 操作ボタン */}
      <div className="flex flex-wrap gap-2">
        {onScrollTo && (
          <button
            type="button"
            onClick={onScrollTo}
            className="rounded border border-stone-300 bg-white px-2 py-1 text-xs text-stone-800 transition hover:bg-stone-100 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:hover:bg-stone-700"
          >
            該当文へスクロール
          </button>
        )}
      </div>
    </article>
  );
}
