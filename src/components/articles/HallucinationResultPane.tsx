'use client';

/**
 * HallucinationResultPane
 * ハルシネーション検出結果の表示ペイン。
 *
 * - 上部: スコアバッジ（critical / high / medium / low の件数）
 * - 中央: 本文プレビュー（HTML を dangerouslySetInnerHTML で描画）+ 該当文ハイライト
 * - 右側: Claim List（risk 順、各 claim カードに「該当文へスクロール」ボタン）
 *
 * 注意:
 * - 既存記事 HTML を一切書き換えない（DB write 禁止、render 専用）。
 * - ハイライトは htmlBody 内に既に付与されている `data-claim-idx="N"` 属性を
 *   利用して、style 注入で動的に色付けする（DOM mutation は避ける）。
 * - dark: 必須、TailwindCSS。
 */

import { useMemo, useRef } from 'react';
import type { HallucinationResult, RiskLevel } from '@/types/hallucination';
import ClaimCard, { type ClaimResult, type DisplayRiskLevel } from './ClaimCard';

interface Props {
  articleId: string;
  htmlBody: string;
  result: HallucinationResult;
}

/** risk_level 順位（critical→high→medium→low）。 */
const RISK_ORDER: Record<DisplayRiskLevel, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** バッジ色（カウンター用）。 */
const COUNT_BADGE: Record<DisplayRiskLevel, string> = {
  critical: 'bg-red-600 text-white dark:bg-red-500',
  high: 'bg-orange-500 text-white dark:bg-orange-400 dark:text-orange-950',
  medium: 'bg-yellow-400 text-yellow-950 dark:bg-yellow-300 dark:text-yellow-950',
  low: 'bg-stone-400 text-white dark:bg-stone-600 dark:text-stone-100',
};

const COUNT_LABEL: Record<DisplayRiskLevel, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/** verdict バッジの装飾。 */
const VERDICT_CLS: Record<HallucinationResult['verdict'], string> = {
  pass: 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-700',
  review:
    'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-700',
  block: 'bg-red-100 text-red-900 border-red-300 dark:bg-red-900/40 dark:text-red-100 dark:border-red-700',
};

const VERDICT_LABEL: Record<HallucinationResult['verdict'], string> = {
  pass: '合格',
  review: '要レビュー',
  block: 'ブロック',
};

/**
 * Risk 配列を表示用 ClaimResult にマージ。
 * `Risk.risk_level` は型定義上 'low' | 'medium' | 'high' のみだが、
 * 実体側で 'critical' が来てもそのまま透過する。
 */
function buildClaimResultMap(result: HallucinationResult): Map<number, ClaimResult> {
  const map = new Map<number, ClaimResult>();
  for (const r of result.risks) {
    map.set(r.sentence_idx, {
      risk_level: (r.risk_level as unknown as DisplayRiskLevel) ?? 'low',
      risk_score: r.risk_score,
      reason: r.reason,
    });
  }
  return map;
}

export default function HallucinationResultPane({ articleId, htmlBody, result }: Props) {
  const previewRef = useRef<HTMLDivElement | null>(null);

  /** Claim と Risk をマージし、risk 順にソートしたリスト。 */
  const sortedClaims = useMemo(() => {
    const riskMap = buildClaimResultMap(result);
    return result.claims
      .map((c) => {
        const r = riskMap.get(c.sentence_idx);
        const merged: typeof c & ClaimResult = {
          ...c,
          risk_level: (r?.risk_level ?? 'low') as DisplayRiskLevel,
          risk_score: r?.risk_score,
          reason: r?.reason,
        };
        return merged;
      })
      .sort(
        (a, b) =>
          (RISK_ORDER[a.risk_level] ?? 99) - (RISK_ORDER[b.risk_level] ?? 99) ||
          a.sentence_idx - b.sentence_idx,
      );
  }, [result]);

  /** リスクレベル別カウント。 */
  const counts = useMemo(() => {
    const c: Record<DisplayRiskLevel, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const r of result.risks) {
      const level = (r.risk_level as unknown as DisplayRiskLevel) ?? 'low';
      if (level in c) c[level] += 1;
    }
    return c;
  }, [result]);

  /** 該当 sentence_idx の要素にスクロール。 */
  const scrollToClaim = (idx: number) => {
    const root = previewRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-claim-idx="${idx}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // ハイライト点滅（CSS アニメーションではなく一時クラスで簡易表現）
    el.classList.add('ring-2', 'ring-amber-400');
    window.setTimeout(() => {
      el.classList.remove('ring-2', 'ring-amber-400');
    }, 1500);
  };

  /**
   * data-claim-idx 属性に対応する CSS をスコープ付きで生成。
   * 該当 idx ごとに risk_level を反映するため、style タグで個別ルールを発行する。
   */
  const highlightCss = useMemo(() => {
    const riskMap = buildClaimResultMap(result);
    const scope = `#hallu-pane-${cssId(articleId)} .hallu-preview`;
    const lines: string[] = [];
    for (const [idx, r] of riskMap.entries()) {
      const color = riskBgVar(r.risk_level);
      lines.push(
        `${scope} [data-claim-idx="${idx}"]{background:${color};border-radius:2px;padding:0 2px;}`,
      );
    }
    return lines.join('\n');
  }, [result, articleId]);

  return (
    <section
      id={`hallu-pane-${cssId(articleId)}`}
      className="flex flex-col gap-4 rounded-lg border border-stone-200 bg-white p-4 text-stone-900 shadow-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
    >
      {/* スタイル: data-claim-idx ハイライト */}
      <style dangerouslySetInnerHTML={{ __html: highlightCss }} />

      {/* 上部: サマリ + スコアバッジ */}
      <header className="flex flex-wrap items-center gap-3 border-b border-stone-200 pb-3 dark:border-stone-700">
        <h2 className="text-base font-semibold">ハルシネーション検出結果</h2>
        <span
          className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold ${VERDICT_CLS[result.verdict]}`}
        >
          {VERDICT_LABEL[result.verdict]}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {(Object.keys(COUNT_LABEL) as DisplayRiskLevel[]).map((lv) => (
            <span
              key={lv}
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-bold ${COUNT_BADGE[lv]}`}
              data-count-level={lv}
            >
              <span>{COUNT_LABEL[lv]}</span>
              <span className="rounded bg-white/30 px-1 text-[11px]">{counts[lv]}</span>
            </span>
          ))}
        </div>
      </header>

      {result.summary && (
        <p className="text-sm leading-relaxed text-stone-700 dark:text-stone-300">
          {result.summary}
        </p>
      )}

      {/* 中央 + 右側 2 カラム */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* 中央: 本文プレビュー */}
        <div className="min-w-0">
          <div className="mb-2 text-xs text-stone-500 dark:text-stone-400">
            本文プレビュー（該当文を risk 別に色付け）
          </div>
          <div
            ref={previewRef}
            className="hallu-preview prose prose-stone max-w-none rounded border border-stone-200 bg-stone-50 p-4 text-sm leading-relaxed dark:prose-invert dark:border-stone-700 dark:bg-stone-950"
            // 既存 HTML をそのまま render（書き換え禁止）
            dangerouslySetInnerHTML={{ __html: htmlBody }}
          />
        </div>

        {/* 右: Claim List */}
        <aside className="min-w-0">
          <div className="mb-2 flex items-center justify-between text-xs text-stone-500 dark:text-stone-400">
            <span>Claim 一覧（risk 順）</span>
            <span>{sortedClaims.length} 件</span>
          </div>
          <div
            className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto pr-1"
            data-testid="claim-list"
          >
            {sortedClaims.length === 0 ? (
              <div className="rounded border border-dashed border-stone-300 p-4 text-center text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
                Claim はありません
              </div>
            ) : (
              sortedClaims.map((c) => (
                <ClaimCard
                  key={`${c.sentence_idx}-${c.claim_text.slice(0, 12)}`}
                  claim={c}
                  onScrollTo={() => scrollToClaim(c.sentence_idx)}
                />
              ))
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

/** id に使用できる文字へ正規化。 */
function cssId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * risk_level → ハイライト背景色 (light/dark 両対応の semi-transparent)。
 * dark mode は media query で切替（Tailwind の dark: は inline style では使えないため）。
 */
function riskBgVar(level: DisplayRiskLevel | RiskLevel): string {
  switch (level) {
    case 'critical':
      return 'rgba(239,68,68,0.30)'; // red-500 @ 30%
    case 'high':
      return 'rgba(249,115,22,0.28)'; // orange-500 @ 28%
    case 'medium':
      return 'rgba(234,179,8,0.28)'; // yellow-500 @ 28%
    case 'low':
    default:
      return 'rgba(168,162,158,0.20)'; // stone-400 @ 20%
  }
}
