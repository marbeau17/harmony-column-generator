// ============================================================================
// src/components/articles/ArticleStatusStepper.tsx
// 記事ステータス表示の共通コンポーネント
// ----------------------------------------------------------------------------
// generation_mode='zero' のときは zero-gen 4 段階 (下書き/本文生成/画像生成/
// 仕上げ完了/公開済み) を、それ以外は legacy 7 段階タイムライン
// (draft → outline_pending → outline_approved → body_generating →
//  body_review → editing → published) を描画する。
//
// 既存ファイル (src/app/(dashboard)/dashboard/articles/[id]/page.tsx) の
// inline 実装をそのまま新規コンポーネントとして抽出した。今回は新規作成のみで
// 差し替えは別タスク。
// ============================================================================

'use client';

import React from 'react';

import type { ArticleStatus } from '@/types/article';

// ─── ラベル定義 ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ArticleStatus, string> = {
  draft: '下書き',
  outline_pending: 'アウトライン確認待ち',
  outline_approved: 'アウトライン承認済み',
  body_generating: '本文生成中',
  body_review: '本文レビュー',
  editing: '編集中',
  published: '公開済み',
};

const STATUS_ORDER: ArticleStatus[] = [
  'draft',
  'outline_pending',
  'outline_approved',
  'body_generating',
  'body_review',
  'editing',
  'published',
];

// ─── Props ─────────────────────────────────────────────────────────────────────

export interface ArticleStatusStepperProps {
  /** 記事の現在ステータス。ArticleStatus 値以外は legacy ブランチで未該当扱い */
  status: string;
  /** 'zero' / 'source' / null。'zero' のときだけ zero-gen ブランチに分岐 */
  generationMode: string | null;
  /** Stage2 本文 HTML が存在するか */
  hasStage2: boolean;
  /** Stage3 仕上げ HTML が存在するか */
  hasStage3: boolean;
  /** 生成済み画像枚数 */
  imageCount: number;
}

// ─── Zero-gen 4 段階表示 ────────────────────────────────────────────────────────

function ZeroGenStatusStepper({
  status,
  hasStage2,
  hasStage3,
  imageCount,
}: {
  status: string;
  hasStage2: boolean;
  hasStage3: boolean;
  imageCount: number;
}) {
  const isFullyReady = hasStage2 && hasStage3 && imageCount >= 1;
  const stages = [
    { key: 'draft', label: '下書き', done: true },
    { key: 'generated', label: '本文生成', done: hasStage2 },
    { key: 'images', label: '画像生成', done: imageCount >= 1 },
    {
      key: 'finalized',
      label: '仕上げ完了',
      done: isFullyReady && status !== 'body_generating',
    },
    { key: 'published', label: '公開済み', done: status === 'published' },
  ];

  return (
    <div
      data-testid="article-status-stepper-zero"
      className="flex flex-wrap items-center gap-3"
    >
      {stages.map((s, i) => (
        <div
          key={s.key}
          data-stage-key={s.key}
          data-stage-done={s.done ? 'true' : 'false'}
          className="flex items-center gap-2"
        >
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
              s.done
                ? 'bg-brand-500 text-white'
                : 'bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
            }`}
          >
            {s.done ? '✓' : i + 1}
          </span>
          <span
            className={`text-xs ${
              s.done
                ? 'font-medium text-gray-700 dark:text-gray-200'
                : 'text-gray-400'
            }`}
          >
            {s.label}
          </span>
          {i < stages.length - 1 && (
            <span className="text-gray-300 dark:text-gray-600">—</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Legacy 7 段階タイムライン表示 ──────────────────────────────────────────────

function LegacyStatusTimeline({ status }: { status: string }) {
  const currentIndex = STATUS_ORDER.indexOf(status as ArticleStatus);

  return (
    <div
      data-testid="article-status-stepper-legacy"
      className="flex items-center gap-1 overflow-x-auto py-2"
    >
      {STATUS_ORDER.map((s, idx) => {
        const isCompleted = idx < currentIndex;
        const isCurrent = idx === currentIndex;

        return (
          <div
            key={s}
            data-stage-key={s}
            data-stage-done={isCompleted ? 'true' : 'false'}
            data-stage-current={isCurrent ? 'true' : 'false'}
            className="flex items-center"
          >
            {idx > 0 && (
              <div
                className={`h-0.5 w-6 ${
                  isCompleted ? 'bg-brand-500' : 'bg-slate-200'
                }`}
              />
            )}
            <div className="flex flex-col items-center">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                  isCurrent
                    ? 'bg-brand-500 text-white ring-4 ring-brand-100'
                    : isCompleted
                      ? 'bg-brand-500 text-white'
                      : 'bg-slate-200 text-slate-400'
                }`}
              >
                {isCompleted ? (
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  idx + 1
                )}
              </div>
              <span
                className={`mt-1 max-w-[70px] text-center text-[10px] leading-tight ${
                  isCurrent
                    ? 'font-bold text-brand-700'
                    : isCompleted
                      ? 'text-brand-500'
                      : 'text-slate-400'
                }`}
              >
                {STATUS_LABELS[s]}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Public Component ──────────────────────────────────────────────────────────

/**
 * 記事ステータスを統一的に描画する共通コンポーネント。
 *
 * - generationMode === 'zero' → zero-gen 4 段階表示 (Stage1〜Stage4)
 * - それ以外                  → legacy 7 段階タイムライン
 */
export default function ArticleStatusStepper({
  status,
  generationMode,
  hasStage2,
  hasStage3,
  imageCount,
}: ArticleStatusStepperProps) {
  if (generationMode === 'zero') {
    return (
      <ZeroGenStatusStepper
        status={status}
        hasStage2={hasStage2}
        hasStage3={hasStage3}
        imageCount={imageCount}
      />
    );
  }

  return <LegacyStatusTimeline status={status} />;
}
