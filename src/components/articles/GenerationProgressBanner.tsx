// ============================================================================
// src/components/articles/GenerationProgressBanner.tsx
// グローバル進捗バナー (P5-20 案B)
//
// /dashboard 配下のレイアウトに常駐し、進行中の生成があればバナーを表示。
// done/failed への遷移を検知して toast で通知。
// ============================================================================
'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Loader2, CheckCircle2, XCircle, X } from 'lucide-react';
import {
  useGenerationJob,
  type GenerationJobStage,
} from '@/hooks/useGenerationJob';

const STAGE_LABEL: Record<GenerationJobStage, string> = {
  queued: '待機中…',
  stage1: 'Stage 1: 構成生成中',
  stage2: 'Stage 2: 本文生成中',
  hallucination: 'Stage 3: ハルシネーション検証中',
  done: '生成完了',
  failed: '生成失敗',
};

export default function GenerationProgressBanner() {
  const { job, clearJob } = useGenerationJob();
  const lastStageRef = useRef<GenerationJobStage | null>(null);

  // ─── done/failed への遷移を検知して toast ─────────────────────────────
  useEffect(() => {
    if (!job) return;
    const last = lastStageRef.current;
    if (job.stage === 'done' && last !== 'done' && job.article_id) {
      toast.success('🎉 記事生成が完了しました', { duration: 8000 });
    } else if (job.stage === 'failed' && last !== 'failed') {
      toast.error(`❌ 生成失敗: ${job.error ?? '不明なエラー'}`, { duration: 10000 });
    }
    lastStageRef.current = job.stage;
  }, [job?.stage, job?.article_id, job?.error]);

  if (!job) return null;

  if (job.stage === 'failed') {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-2 dark:border-red-800 dark:bg-red-950/40">
        <div className="flex items-center gap-2 min-w-0">
          <XCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-300" />
          <span className="text-xs font-medium text-red-800 dark:text-red-100 truncate">
            ❌ 生成失敗: {job.error ?? '不明なエラー'}
          </span>
        </div>
        <button
          onClick={clearJob}
          className="rounded p-1 text-red-600 hover:bg-red-100 dark:text-red-300 dark:hover:bg-red-900/40"
          aria-label="バナーを閉じる"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (job.stage === 'done') {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-green-200 bg-green-50 px-4 py-2 dark:border-green-800 dark:bg-green-950/40">
        <div className="flex items-center gap-2 min-w-0">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 dark:text-green-300" />
          <span className="text-xs font-medium text-green-800 dark:text-green-100">
            ✅ 記事生成完了
          </span>
        </div>
        <div className="flex items-center gap-2">
          {job.article_id && (
            <Link
              href={`/dashboard/articles/${job.article_id}/edit`}
              onClick={clearJob}
              className="rounded-md border border-green-300 bg-white px-2.5 py-1 text-xs font-semibold text-green-800 hover:bg-green-100 dark:border-green-700 dark:bg-gray-800 dark:text-green-100 dark:hover:bg-green-900/40"
            >
              記事を開く
            </Link>
          )}
          <button
            onClick={clearJob}
            className="rounded p-1 text-green-700 hover:bg-green-100 dark:text-green-300 dark:hover:bg-green-900/40"
            aria-label="バナーを閉じる"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // 進行中
  const pct = Math.round((job.progress ?? 0) * 100);
  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-800 dark:bg-amber-950/40">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-700 dark:text-amber-200" />
      <span className="shrink-0 text-xs font-medium text-amber-900 dark:text-amber-100">
        📝 {STAGE_LABEL[job.stage]} ({pct}%)
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-amber-200/60 dark:bg-amber-900/40">
        <div
          className="h-full bg-amber-500 transition-all duration-700 dark:bg-amber-400"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-[10px] tabular-nums text-amber-800 dark:text-amber-200">
        残り ~{job.eta_seconds}s
      </span>
    </div>
  );
}
