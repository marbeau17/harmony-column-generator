// ============================================================================
// src/components/articles/GenerationProgressBanner.tsx
// グローバル進捗バナー (P5-20 案B)
//
// /dashboard 配下のレイアウトに常駐し、進行中の生成があればバナーを表示。
// done/failed への遷移を検知して toast で通知。
// ============================================================================
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Loader2, CheckCircle2, XCircle, X } from 'lucide-react';
import {
  useGenerationJob,
  type GenerationJobStage,
} from '@/hooks/useGenerationJob';
import { useGenerationJobs } from '@/hooks/useGenerationJobs';

const STAGE_LABEL: Record<GenerationJobStage, string> = {
  queued: '待機中…',
  stage1: 'Stage 1: 構成生成中',
  stage2: 'Stage 2: 本文生成中',
  hallucination: 'Stage 3: ハルシネーション検証中',
  done: '生成完了',
  failed: '生成失敗',
};

const STAGE_BADGE: Record<GenerationJobStage, string> = {
  queued: '⏳ 待機',
  stage1: '🚧 構成中',
  stage2: '✏️ 本文中',
  hallucination: '🧪 検証中',
  done: '✅ 完了',
  failed: '❌ 失敗',
};

export default function GenerationProgressBanner() {
  const { job, clearJob } = useGenerationJob();
  const { jobs: batchJobs, summary, removeJob, clearAll } = useGenerationJobs();
  const lastStageRef = useRef<GenerationJobStage | null>(null);
  const lastBatchSummaryRef = useRef<{ done: number; failed: number; total: number }>({
    done: 0,
    failed: 0,
    total: 0,
  });
  const [batchDetailsOpen, setBatchDetailsOpen] = useState(false);

  // ─── done/failed への遷移を検知して toast (single) ────────────────────
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

  // ─── batch jobs の done/failed 遷移を検知して toast ─────────────────
  useEffect(() => {
    if (batchJobs.length === 0) return;
    const prev = lastBatchSummaryRef.current;
    // 個別 done 通知 (前回より done が増えたら)
    if (summary.done > prev.done) {
      const delta = summary.done - prev.done;
      toast.success(`✅ ${delta} 件完了 (${summary.done}/${summary.total})`, {
        duration: 5000,
      });
    }
    if (summary.failed > prev.failed) {
      const delta = summary.failed - prev.failed;
      toast.error(`❌ ${delta} 件失敗 (累計 ${summary.failed})`, { duration: 6000 });
    }
    // 全完了通知
    if (
      summary.all_terminal &&
      !(prev.done + prev.failed === prev.total && prev.total > 0)
    ) {
      toast.success(
        `🎉 バッチ生成完了 (成功 ${summary.done} / 失敗 ${summary.failed} / 全 ${summary.total})`,
        { duration: 10000 },
      );
    }
    lastBatchSummaryRef.current = {
      done: summary.done,
      failed: summary.failed,
      total: summary.total,
    };
  }, [summary.done, summary.failed, summary.total, summary.all_terminal, batchJobs.length]);

  // ─── 集計バッチ表示 (jobs > 0 を優先) ──────────────────────────────
  if (batchJobs.length > 0) {
    const isAllDone = summary.all_terminal;
    const bgClass = isAllDone
      ? summary.failed > 0
        ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40'
        : 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/40'
      : 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40';
    return (
      <div className={`border-b ${bgClass} px-4 py-2`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {isAllDone ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 dark:text-green-300" />
            ) : (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-700 dark:text-amber-200" />
            )}
            <span className="text-xs font-medium">
              📚 バッチ生成: {summary.done}/{summary.total} 完了
              {summary.in_progress > 0 && ` ・進行中 ${summary.in_progress}`}
              {summary.queued > 0 && ` ・待機 ${summary.queued}`}
              {summary.failed > 0 && ` ・失敗 ${summary.failed}`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setBatchDetailsOpen(!batchDetailsOpen)}
              className="rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
            >
              {batchDetailsOpen ? '詳細を閉じる' : '詳細▼'}
            </button>
            {isAllDone && (
              <button
                onClick={clearAll}
                className="rounded p-1 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                aria-label="バナーを閉じる"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        {batchDetailsOpen && (
          <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-gray-200 bg-white text-xs dark:border-gray-700 dark:bg-gray-800">
            {batchJobs.map((j, idx) => (
              <div
                key={j.job_id}
                className="flex items-center justify-between gap-2 px-2 py-1 border-b border-gray-100 last:border-0 dark:border-gray-700"
              >
                <span className="font-mono text-[10px] text-gray-500">
                  #{idx + 1}
                </span>
                <span className="flex-1 min-w-0 truncate text-gray-700 dark:text-gray-200">
                  {STAGE_BADGE[j.stage]} {j.error ? `: ${j.error.slice(0, 30)}` : ''}
                </span>
                {j.article_id && j.stage === 'done' && (
                  <Link
                    href={`/dashboard/articles/${j.article_id}/edit`}
                    onClick={() => removeJob(j.job_id)}
                    className="text-[10px] text-blue-600 hover:underline dark:text-blue-300"
                  >
                    開く
                  </Link>
                )}
                {(j.stage === 'done' || j.stage === 'failed') && (
                  <button
                    onClick={() => removeJob(j.job_id)}
                    className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                    aria-label="この行を削除"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

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
