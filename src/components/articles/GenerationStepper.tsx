// ============================================================================
// src/components/articles/GenerationStepper.tsx
// 4 ステップ Stepper — stage1 / stage2 / hallucination / 完成
// 経過秒・推定残り秒・現在ステージの脈動アニメ表示
// dark: クラスでダークモード対応（global CLAUDE.md ルール準拠）
// ============================================================================
'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, ListTree, PenLine, ShieldCheck, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type GenerationStage = 'idle' | 'stage1' | 'stage2' | 'hallucination' | 'done' | 'error';

interface StepDef {
  key: Exclude<GenerationStage, 'idle' | 'error'>;
  label: string;
  description: string;
  icon: LucideIcon;
  /** 推定所要秒（合計から進捗予測に使用） */
  etaSec: number;
}

const STEPS: readonly StepDef[] = [
  { key: 'stage1',        label: 'アウトライン',     description: '構成・見出しを設計',          icon: ListTree,    etaSec: 35 },
  { key: 'stage2',        label: '本文生成',         description: '本文と画像プロンプトを生成', icon: PenLine,     etaSec: 90 },
  { key: 'hallucination', label: 'ハルシネーション検証', description: '事実・引用・整合性を確認', icon: ShieldCheck, etaSec: 25 },
  { key: 'done',          label: '完成',             description: 'すべての処理が完了',           icon: Sparkles,    etaSec: 0 },
] as const;

const TOTAL_ETA = STEPS.reduce((sum, s) => sum + s.etaSec, 0);

interface Props {
  stage: GenerationStage;
  /** 生成開始 epoch ms（経過秒計算用）。null なら 0 起点 */
  startedAt?: number | null;
  /** エラーメッセージ。指定時は赤系で表示 */
  errorMessage?: string | null;
}

function formatSec(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0秒';
  if (sec < 60) return `${Math.round(sec)}秒`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}分${s.toString().padStart(2, '0')}秒`;
}

function stageIndex(stage: GenerationStage): number {
  switch (stage) {
    case 'stage1': return 0;
    case 'stage2': return 1;
    case 'hallucination': return 2;
    case 'done': return 3;
    default: return -1;
  }
}

export default function GenerationStepper({ stage, startedAt, errorMessage }: Props) {
  const [now, setNow] = useState<number>(() => Date.now());

  // 1秒ごとに経過秒を更新（生成中のみ）
  useEffect(() => {
    if (stage === 'idle' || stage === 'done' || stage === 'error') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [stage]);

  const elapsedSec = startedAt ? Math.max(0, (now - startedAt) / 1000) : 0;

  // 残り秒の推定: 完了済みステップの etaSec を引き、現ステップの残り部分も近似
  const currentIdx = stageIndex(stage);
  let consumedEta = 0;
  for (let i = 0; i < currentIdx; i += 1) {
    consumedEta += STEPS[i].etaSec;
  }
  const remainingEta = Math.max(0, TOTAL_ETA - consumedEta - Math.max(0, elapsedSec - consumedEta));
  const showProgress = stage !== 'idle' && stage !== 'error';

  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm
        dark:border-gray-700 dark:bg-gray-900 sm:p-5"
    >
      {/* ヘッダー: 経過 / 残り */}
      {showProgress && (
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-gray-600 dark:text-gray-300">
            経過 <span className="tabular-nums text-gray-900 dark:text-gray-100">{formatSec(elapsedSec)}</span>
          </span>
          {stage !== 'done' && (
            <span className="font-medium text-gray-600 dark:text-gray-300">
              推定残り <span className="tabular-nums text-gray-900 dark:text-gray-100">{formatSec(remainingEta)}</span>
            </span>
          )}
          {stage === 'done' && (
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">完了</span>
          )}
        </div>
      )}

      {/* ステップリスト */}
      <ol className="relative space-y-3">
        {STEPS.map((step, idx) => {
          const isActive = idx === currentIdx && stage !== 'done';
          const isComplete = idx < currentIdx || stage === 'done';
          const isError = stage === 'error' && idx === Math.max(0, currentIdx);
          const Icon = step.icon;
          return (
            <li key={step.key} className="flex items-start gap-3">
              <span
                aria-hidden
                className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors
                  ${
                    isError
                      ? 'border-red-400 bg-red-50 text-red-600 dark:border-red-500 dark:bg-red-950 dark:text-red-300'
                      : isComplete
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-600 dark:border-emerald-400 dark:bg-emerald-950 dark:text-emerald-300'
                      : isActive
                      ? 'border-brand-500 bg-brand-50 text-brand-600 dark:border-brand-400 dark:bg-brand-900/40 dark:text-brand-200'
                      : 'border-gray-300 bg-white text-gray-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-500'
                  }`}
              >
                {isComplete ? (
                  <Check className="h-4 w-4" />
                ) : isActive ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute inset-0 -z-0 animate-ping rounded-full bg-brand-400/40 dark:bg-brand-300/30"
                  />
                )}
              </span>
              <div className="flex-1 pt-0.5">
                <div
                  className={`text-sm font-semibold
                    ${
                      isError
                        ? 'text-red-700 dark:text-red-200'
                        : isComplete
                        ? 'text-emerald-700 dark:text-emerald-200'
                        : isActive
                        ? 'text-brand-700 dark:text-brand-100'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}
                >
                  {step.label}
                  {isActive && (
                    <span className="ml-2 text-xs font-normal text-brand-500 dark:text-brand-300">
                      実行中…
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{step.description}</div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* エラー表示 */}
      {stage === 'error' && errorMessage && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700
            dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {errorMessage}
        </div>
      )}
    </div>
  );
}
