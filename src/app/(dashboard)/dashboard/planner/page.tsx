// ============================================================================
// src/app/(dashboard)/dashboard/planner/page.tsx
// AIコンテンツプランナー — プラン生成・管理・キュー処理
// ============================================================================
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Pencil,
  Play,
  PlayCircle,
  Loader2,
  RefreshCw,
  AlertCircle,
  RotateCcw,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

type PlanStatus = 'proposed' | 'approved' | 'generating' | 'completed';

interface ContentPlan {
  id: string;
  theme: string;
  keyword: string;
  sub_keywords: string[];
  persona: string;
  perspective_type: string;
  source_article_ids: string[];
  predicted_seo_score: number;
  proposal_reason: string;
  status: PlanStatus;
}

type QueueStep = 'pending' | 'outline' | 'body' | 'images' | 'seo_check' | 'completed' | 'failed';

interface QueueItem {
  id: string;
  plan_id: string;
  plan_name: string;
  current_step: QueueStep;
  error_message?: string;
}

// Generation progress tracking
type GenerateStep = 'idle' | 'keywords' | 'plans' | 'done' | 'error';

interface GenerateProgress {
  step: GenerateStep;
  currentStepLabel: string;
  stepsCompleted: number;
  totalSteps: number;
  detail?: string;
  errorMessage?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<PlanStatus, string> = {
  proposed: '提案中',
  approved: '承認済',
  generating: '生成中',
  completed: '完了',
};

const STATUS_STYLES: Record<PlanStatus, string> = {
  proposed: 'bg-amber-100 text-amber-700',
  approved: 'bg-sky-100 text-sky-700',
  generating: 'bg-violet-100 text-violet-700 animate-pulse',
  completed: 'bg-emerald-100 text-emerald-700',
};

const THEME_COLORS: Record<string, string> = {
  soul_mission:    'bg-purple-100 text-purple-700',
  relationships:   'bg-pink-100 text-pink-700',
  grief_care:      'bg-blue-100 text-blue-700',
  self_growth:     'bg-emerald-100 text-emerald-700',
  healing:         'bg-teal-100 text-teal-700',
  daily_awareness: 'bg-amber-100 text-amber-700',
  spiritual_intro: 'bg-indigo-100 text-indigo-700',
};

const THEME_LABELS: Record<string, string> = {
  soul_mission:    '魂と使命',
  relationships:   '人間関係',
  grief_care:      'グリーフケア',
  self_growth:     '自己成長',
  healing:         '癒しと浄化',
  daily_awareness: '日常の気づき',
  spiritual_intro: 'スピリチュアル入門',
};

const PERSPECTIVE_LABELS: Record<string, string> = {
  experience_to_lesson:  '体験談 → 教訓',
  personal_to_universal: '個人 → 普遍',
  concept_to_practice:   '概念 → 実践',
  case_to_work:          '事例 → ワーク',
  past_to_modern:        '過去 → 現代',
  deep_to_intro:         '深掘り → 入門',
};

const QUEUE_STEPS: QueueStep[] = ['pending', 'outline', 'body', 'images', 'seo_check', 'completed'];

const QUEUE_STEP_LABELS: Record<QueueStep, string> = {
  pending:   '待機中',
  outline:   '構成案生成',
  body:      '本文生成',
  images:    '画像生成',
  seo_check: 'SEOチェック',
  completed: '完了',
  failed:    '失敗',
};

const FILTER_OPTIONS: { value: PlanStatus | 'all'; label: string }[] = [
  { value: 'all',        label: '全て' },
  { value: 'proposed',   label: '提案中' },
  { value: 'approved',   label: '承認済' },
  { value: 'generating', label: '生成中' },
  { value: 'completed',  label: '完了' },
];

const INITIAL_PROGRESS: GenerateProgress = {
  step: 'idle',
  currentStepLabel: '',
  stepsCompleted: 0,
  totalSteps: 3,
};

// ─── Helper: SEO Score Ring ─────────────────────────────────────────────────

function SeoScoreRing({ score }: { score: number }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color =
    score >= 80 ? 'text-emerald-500' : score >= 60 ? 'text-amber-500' : 'text-red-400';

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="48" height="48" className="-rotate-90">
        <circle
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          className="text-gray-100"
        />
        <circle
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={color}
        />
      </svg>
      <span className={`absolute text-xs font-bold ${color}`}>{score}</span>
    </div>
  );
}

// ─── Helper: Progress Bar ───────────────────────────────────────────────────

function GenerateProgressBar({ progress }: { progress: GenerateProgress }) {
  if (progress.step === 'idle') return null;

  const pct = Math.round((progress.stepsCompleted / progress.totalSteps) * 100);
  const isError = progress.step === 'error';
  const isDone = progress.step === 'done';

  return (
    <div className="rounded-xl bg-white shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">
          {isError ? 'エラーが発生しました' : isDone ? 'プラン生成完了' : 'プラン生成中...'}
        </h3>
        <span className="text-xs text-gray-500">
          {progress.stepsCompleted}/{progress.totalSteps} ステップ完了
        </span>
      </div>

      {/* Progress bar */}
      <div className="relative h-3 w-full rounded-full bg-gray-100 overflow-hidden mb-3">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out ${
            isError
              ? 'bg-red-400'
              : isDone
                ? 'bg-emerald-400'
                : 'bg-brand-400'
          }`}
          style={{ width: `${isDone ? 100 : pct}%` }}
        />
      </div>

      {/* Step indicators */}
      <div className="flex flex-col gap-1.5 mb-2 sm:flex-row sm:justify-between sm:gap-0">
        {['キーワードリサーチ', 'プラン生成', '元記事選定・保存'].map((label, i) => {
          const done = progress.stepsCompleted > i;
          const active = progress.stepsCompleted === i && !isError && !isDone;
          return (
            <div key={label} className="flex items-center gap-1.5">
              {done ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              ) : active ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-500" />
              ) : (
                <div className="h-3.5 w-3.5 rounded-full border-2 border-gray-200" />
              )}
              <span
                className={`text-[11px] ${
                  done
                    ? 'text-emerald-600 font-medium'
                    : active
                      ? 'text-brand-600 font-medium'
                      : 'text-gray-400'
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Current step detail */}
      {progress.currentStepLabel && !isError && !isDone && (
        <p className="text-xs text-gray-500 flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" />
          {progress.currentStepLabel}
        </p>
      )}

      {/* Detail info */}
      {progress.detail && !isError && (
        <p className="text-xs text-gray-400 mt-1">{progress.detail}</p>
      )}

      {/* Error message */}
      {isError && progress.errorMessage && (
        <div className="flex items-start gap-2 mt-2 rounded-lg bg-red-50 p-3">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-700">{progress.errorMessage}</p>
            <p className="text-xs text-red-500 mt-1">
              コンソールに詳細ログが出力されています。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function PlannerPage() {
  // Plans
  const [plans, setPlans] = useState<ContentPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [filter, setFilter] = useState<PlanStatus | 'all'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Generate progress (step-split)
  const [progress, setProgress] = useState<GenerateProgress>(INITIAL_PROGRESS);
  const [lastGenerateCount, setLastGenerateCount] = useState(5);

  // Generate dialog
  const [showCountDialog, setShowCountDialog] = useState(false);

  // Queue
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const [queueAllCompleted, setQueueAllCompleted] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const queueSectionRef = useRef<HTMLDivElement | null>(null);
  const queueStartBtnRef = useRef<HTMLButtonElement | null>(null);
  const [highlightQueueBtn, setHighlightQueueBtn] = useState(false);

  const isGenerating = progress.step === 'keywords' || progress.step === 'plans';

  // ── ページ離脱防止（生成中） ────────────────────────────────────
  useEffect(() => {
    if (!isGenerating) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isGenerating]);

  // ── Fetch plans ─────────────────────────────────────────────────
  const fetchPlans = useCallback(async () => {
    try {
      setPlansError(null);
      const res = await fetch('/api/plans');
      if (!res.ok) throw new Error('プランの取得に失敗しました');
      const json = await res.json();
      // API は { data: [...], meta: {...} } を返す
      setPlans(json.data ?? []);
    } catch (err) {
      console.error('[planner] fetchPlans failed:', err);
      setPlansError(err instanceof Error ? err.message : 'プランの取得に失敗しました');
    } finally {
      setPlansLoading(false);
    }
  }, []);

  // ── Fetch queue ─────────────────────────────────────────────────
  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/queue');
      if (res.ok) {
        const data = await res.json();
        const items: QueueItem[] = data.items ?? data.data ?? [];
        setQueueItems(items);
        // Stop polling only if NOT actively running queue processing
        if (!queueRunning) {
          const hasActive = items.some(
            (i: QueueItem) =>
              i.current_step !== 'completed' &&
              i.current_step !== 'pending' &&
              i.current_step !== 'failed',
          );
          if (!hasActive && pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }
        // Detect all-completed state
        if (
          items.length > 0 &&
          items.every((i: QueueItem) => i.current_step === 'completed')
        ) {
          setQueueAllCompleted(true);
        } else {
          setQueueAllCompleted(false);
        }
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchPlans();
    fetchQueue();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Generate plans (step-split) ─────────────────────────────────
  const handleGenerate = async (count: number) => {
    setShowCountDialog(false);
    setLastGenerateCount(count);

    // Reset progress
    setProgress({
      step: 'keywords',
      currentStepLabel: 'AIがキーワードリサーチ中...',
      stepsCompleted: 0,
      totalSteps: 3,
    });

    try {
      // ── Step 1: Keyword Research ──
      console.log('[planner] Step 1: Starting keyword research...');
      const step1Res = await fetch('/api/plans/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count }),
      });

      if (!step1Res.ok) {
        const err = await step1Res.json().catch(() => ({}));
        console.error('[planner] Step 1 failed:', err);
        throw new Error(err.error ?? err.detail ?? 'キーワードリサーチに失敗しました');
      }

      const step1Data = await step1Res.json();
      console.log('[planner] Step 1 complete:', {
        keywordCount: step1Data.keywords?.length ?? 0,
        keywords: step1Data.keywords?.map((k: { keyword: string }) => k.keyword),
      });

      setProgress({
        step: 'plans',
        currentStepLabel: 'プランを生成中...',
        stepsCompleted: 1,
        totalSteps: 3,
        detail: `${step1Data.keywords?.length ?? 0}件のキーワードを取得済み`,
      });

      // ── Step 2: Plan Generation + Source Selection + DB Save ──
      console.log('[planner] Step 2: Generating plans from keywords...');
      const step2Res = await fetch('/api/plans/generate-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: step1Data.keywords,
          count,
        }),
      });

      if (!step2Res.ok) {
        const err = await step2Res.json().catch(() => ({}));
        console.error('[planner] Step 2 failed:', err);
        throw new Error(err.error ?? err.detail ?? 'プラン生成に失敗しました');
      }

      const step2Data = await step2Res.json();
      console.log('[planner] Step 2 complete:', {
        planCount: step2Data.count ?? 0,
        batchId: step2Data.batchId,
      });

      // ── Done ──
      setProgress({
        step: 'done',
        currentStepLabel: '',
        stepsCompleted: 3,
        totalSteps: 3,
        detail: `${step2Data.count ?? 0}件のプランを生成しました`,
      });

      // Refresh plans list
      await fetchPlans();

      // Auto-clear done state after 5 seconds
      setTimeout(() => {
        setProgress(INITIAL_PROGRESS);
      }, 5000);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'プラン生成に失敗しました';
      console.error('[planner] Generation failed:', errorMessage);
      setProgress((prev) => ({
        ...prev,
        step: 'error',
        errorMessage,
      }));
    }
  };

  // ── Retry after error ──────────────────────────────────────────
  const handleRetry = () => {
    handleGenerate(lastGenerateCount);
  };

  // ── Approve / Reject ───────────────────────────────────────────
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const handleApprove = async (id: string, reject = false) => {
    try {
      setActionMessage(reject ? '却下中...' : '承認中...');
      const res = await fetch(`/api/plans/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reject ? { reject: true } : { approve: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error('[planner] approve/reject failed:', data.error);
        setActionMessage(`エラー: ${data.error || '処理に失敗しました'}`);
        setTimeout(() => setActionMessage(null), 5000);
        return;
      }
      setActionMessage(reject ? '却下しました' : '承認しました！記事の自動生成を開始します...');
      await fetchPlans();
      await fetchQueue();
      if (!reject) {
        // 承認後、自動的にキュー処理を開始
        setTimeout(() => {
          queueSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          handleStartQueue(); // 自動開始
        }, 500);
      }
      setTimeout(() => setActionMessage(null), 5000);
    } catch (err) {
      console.error('[planner] approve/reject error:', err);
      setActionMessage('通信エラーが発生しました');
      setTimeout(() => setActionMessage(null), 5000);
    }
  };

  // Requirement 2: bulk approve with count feedback
  const handleBulkApprove = async () => {
    const ids = Array.from(selectedIds);
    const count = ids.length;
    setActionMessage(`${count}件を承認中...`);
    await Promise.all(ids.map((id) => handleApprove(id)));
    setSelectedIds(new Set());
    await fetchPlans();
    await fetchQueue();
    setActionMessage(`${count}件を承認しました！記事の自動生成を開始します...`);
    setTimeout(() => {
      queueSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      handleStartQueue(); // 自動開始
    }, 500);
    setTimeout(() => setActionMessage(null), 5000);
  };

  // ── Queue processing (loops until all items completed/failed) ──
  // Guard: useRef で多重起動を防止（React state は非同期なのでガードに不向き）
  const queueLockRef = useRef(false);

  // Batch generation state
  const [batchState, setBatchState] = useState<{
    status: 'idle' | 'preparing' | 'running' | 'completed';
    items: { queueId: string; articleId: string; keyword: string; title: string; status: 'waiting' | 'processing' | 'completed' | 'failed'; currentStep: string; errorMessage?: string; published?: boolean }[];
    completedCount: number;
    failedCount: number;
  } | null>(null);
  const batchCancelRef = useRef(false);

  const handleStartQueue = async () => {
    // 既にループ実行中なら二重起動しない
    if (queueLockRef.current) {
      console.log('[queue] Already running — skipping duplicate invocation');
      return;
    }
    queueLockRef.current = true;
    setQueueRunning(true);
    setQueueAllCompleted(false);

    // Start polling for UI updates
    if (!pollingRef.current) {
      pollingRef.current = setInterval(() => {
        fetchQueue();
        fetchPlans();
      }, 3000);
    }

    // Process queue items one step at a time until nothing left
    let maxIterations = 100;
    let iteration = 0;
    console.log('[queue] Starting queue processing loop');

    while (maxIterations-- > 0) {
      iteration++;
      console.log(`[queue] Iteration ${iteration}: calling /api/queue/process`);

      try {
        const res = await fetch('/api/queue/process', { method: 'POST' });
        const data = await res.json().catch(() => ({}));

        console.log(`[queue] Response: status=${res.status}`, data);

        // Conflict: another request claimed the item — just retry immediately
        if (data.conflict) {
          console.log('[queue] Claim conflict — retrying next item');
          continue;
        }

        // No more items to process
        if (res.status === 404 || data.processed === false || data.message?.includes('処理対象')) {
          console.log('[queue] No more items to process. Done.');
          break;
        }

        if (!res.ok) {
          console.error(`[queue] Process error (status ${res.status}):`, data.error, data.detail);
          // Don't break - try next iteration (the failed item gets error_message set and will be skipped)
        } else {
          console.log(`[queue] Step completed: ${data.previousStep} → ${data.newStep} for plan "${data.keyword || 'unknown'}"`);
          if (data.published) {
            console.log(`[queue] Article published: ${data.title}`);
            // Show a brief notification
            setActionMessage(`記事「${data.title}」を自動公開しました ✓`);
          }
        }

        // Refresh UI after each step
        await fetchQueue();
        await fetchPlans();
      } catch (err) {
        console.error('[queue] Fetch error:', err);
        break;
      }
    }

    console.log(`[queue] Loop ended after ${iteration} iterations`);

    queueLockRef.current = false;
    setQueueRunning(false);
    await fetchQueue();
    await fetchPlans();

    // Check if all completed
    const allDone = queueItems.every((q: QueueItem) => q.current_step === 'completed' || q.current_step === 'failed');
    if (allDone && queueItems.length > 0) {
      setQueueAllCompleted(true);
    }

    // Stop polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  // Requirement 5: retry a failed queue item
  const handleRetryQueueItem = async (queueItemId: string) => {
    try {
      // Reset the failed item to pending so it can be reprocessed
      await fetch(`/api/queue/${queueItemId}/retry`, { method: 'POST' });
      await fetchQueue();
      // Auto-start queue processing
      handleStartQueue();
    } catch {
      setActionMessage('リトライに失敗しました');
      setTimeout(() => setActionMessage(null), 3000);
    }
  };

  // ── Batch Generate ─────────────────────────────────────────────
  const handleBatchGenerate = async () => {
    if (queueLockRef.current) {
      console.log('[batch] Already running — skipping');
      return;
    }
    queueLockRef.current = true;
    batchCancelRef.current = false;
    console.log('[batch] Starting batch generation...');

    try {
      // Step 1: Prepare batch
      setBatchState({ status: 'preparing', items: [], completedCount: 0, failedCount: 0 });

      const prepRes = await fetch('/api/queue/batch-generate', { method: 'POST' });
      const prepData = await prepRes.json();

      if (!prepRes.ok || !prepData.batchItems?.length) {
        alert(prepData.message || prepData.error || '処理対象の記事がありません');
        setBatchState(null);
        return;
      }

      const items = prepData.batchItems.map((item: any) => ({
        ...item,
        status: 'waiting' as const,
        currentStep: 'outline',
      }));

      setBatchState({ status: 'running', items, completedCount: 0, failedCount: 0 });

      // Step 2: Process each article serially
      let completed = 0;
      let failed = 0;

      for (let i = 0; i < items.length; i++) {
        if (batchCancelRef.current) break;

        // Mark current item as processing
        setBatchState(prev => {
          if (!prev) return prev;
          const newItems = [...prev.items];
          newItems[i] = { ...newItems[i], status: 'processing' };
          return { ...prev, items: newItems };
        });

        // Process this article through all steps
        let articleDone = false;
        let stepCount = 0;
        const maxSteps = 20; // safety limit

        while (!articleDone && stepCount < maxSteps && !batchCancelRef.current) {
          stepCount++;
          console.log(`[batch] Article ${i+1}/${items.length} step ${stepCount}: calling /api/queue/process`);
          try {
            const res = await fetch('/api/queue/process', { method: 'POST' });
            const data = await res.json();
            console.log(`[batch] Response:`, { status: res.status, processed: data.processed, step: data.currentStep, conflict: data.conflict, error: data.error });

            if (data.conflict) {
              console.log('[batch] Conflict - retrying');
              continue;
            }

            if (!data.processed) {
              console.log('[batch] No items processed - checking if article is done');
              // Article might have been completed by a previous step
              // Mark as completed and move on
              completed++;
              setBatchState(prev => {
                if (!prev) return prev;
                const newItems = [...prev.items];
                newItems[i] = { ...newItems[i], status: 'completed', currentStep: 'completed' };
                return { ...prev, items: newItems, completedCount: completed };
              });
              articleDone = true;
              break;
            }

            // Update step in UI - match by articleId when possible
            const processedArticleId = data.articleId;
            if (data.currentStep) {
              // Find which batch item this step belongs to
              const matchIdx = processedArticleId
                ? items.findIndex((it: { articleId: string }) => it.articleId === processedArticleId)
                : i;

              if (matchIdx >= 0) {
                setBatchState(prev => {
                  if (!prev) return prev;
                  const newItems = [...prev.items];
                  newItems[matchIdx] = { ...newItems[matchIdx], currentStep: data.currentStep, status: 'processing' };
                  return { ...prev, items: newItems };
                });
              }
            }

            if (data.currentStep === 'completed') {
              completed++;
              const isPublished = data.published === true;
              const matchIdx2 = processedArticleId
                ? items.findIndex((it: { articleId: string }) => it.articleId === processedArticleId)
                : i;
              const targetIdx = matchIdx2 >= 0 ? matchIdx2 : i;
              setBatchState(prev => {
                if (!prev) return prev;
                const newItems = [...prev.items];
                newItems[targetIdx] = {
                  ...newItems[targetIdx],
                  status: 'completed',
                  currentStep: 'completed',
                  published: isPublished,
                  title: data.title || newItems[targetIdx].title,
                };
                return { ...prev, items: newItems, completedCount: completed };
              });
              // If the completed article is the current one, move on
              if (targetIdx === i) articleDone = true;
            }

            if (data.error || data.step === 'failed') {
              failed++;
              setBatchState(prev => {
                if (!prev) return prev;
                const newItems = [...prev.items];
                newItems[i] = { ...newItems[i], status: 'failed', errorMessage: data.error };
                return { ...prev, items: newItems, failedCount: failed };
              });
              articleDone = true;
            }
          } catch {
            failed++;
            setBatchState(prev => {
              if (!prev) return prev;
              const newItems = [...prev.items];
              newItems[i] = { ...newItems[i], status: 'failed', errorMessage: 'ネットワークエラー' };
              return { ...prev, items: newItems, failedCount: failed };
            });
            articleDone = true;
          }
        }

        // If not marked as completed/failed, check status
        if (!articleDone) {
          failed++;
          setBatchState(prev => {
            if (!prev) return prev;
            const newItems = [...prev.items];
            newItems[i] = { ...newItems[i], status: 'failed', errorMessage: 'ステップ上限超過' };
            return { ...prev, items: newItems, failedCount: failed };
          });
        }

        // Refresh queue/plans after each article
        await fetchQueue();
        await fetchPlans();
      }

      setBatchState(prev => prev ? { ...prev, status: 'completed' } : prev);
    } finally {
      queueLockRef.current = false;
    }
  };

  // ── Toggle helpers ─────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Filtered plans ─────────────────────────────────────────────
  // Requirement 7: counts per status for filter badges
  const planCounts: Record<string, number> = {
    all: plans.length,
    proposed: plans.filter((p) => p.status === 'proposed').length,
    approved: plans.filter((p) => p.status === 'approved').length,
    generating: plans.filter((p) => p.status === 'generating').length,
    completed: plans.filter((p) => p.status === 'completed').length,
  };

  // Requirement 8: helper to find queue item for a plan
  const getQueueItemForPlan = (planId: string) =>
    queueItems.find((q) => q.plan_id === planId);

  const filteredPlans =
    filter === 'all' ? plans : plans.filter((p) => p.status === filter);

  const allFilteredSelected =
    filteredPlans.length > 0 &&
    filteredPlans
      .filter((p) => p.status === 'proposed')
      .every((p) => selectedIds.has(p.id));

  const toggleSelectAll = () => {
    const proposedIds = filteredPlans
      .filter((p) => p.status === 'proposed')
      .map((p) => p.id);
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        proposedIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        proposedIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  // ── Queue progress helper ──────────────────────────────────────
  const getQueueProgress = (step: QueueStep) => {
    const idx = QUEUE_STEPS.indexOf(step);
    return Math.round((idx / (QUEUE_STEPS.length - 1)) * 100);
  };

  // ────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">AIコンテンツプランナー</h1>
          <p className="mt-1 text-sm text-gray-500">
            AIがキーワードリサーチからプラン提案まで自動で行います
          </p>
          {actionMessage && (
            <div className={`mt-2 rounded-lg px-4 py-2 text-sm font-medium ${
              actionMessage.startsWith('エラー') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
            }`}>
              {actionMessage}
            </div>
          )}
        </div>
        <button
          onClick={() => setShowCountDialog(true)}
          disabled={isGenerating}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-5 py-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-600 disabled:opacity-50 min-h-[44px] w-full sm:w-auto sm:py-2.5"
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          プランを生成
        </button>
      </div>

      {/* ── Count Dialog ─────────────────────────────────────────── */}
      {showCountDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setShowCountDialog(false)}
          />
          <div
            className="relative w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              生成するプラン数を選択
            </h3>
            <div className="flex gap-3">
              <button
                onClick={() => handleGenerate(5)}
                className="flex-1 rounded-lg border-2 border-brand-200 px-4 py-3 text-center font-medium text-brand-700 transition-colors hover:border-brand-500 hover:bg-brand-50 min-h-[44px]"
              >
                5件
              </button>
              <button
                onClick={() => handleGenerate(10)}
                className="flex-1 rounded-lg border-2 border-brand-200 px-4 py-3 text-center font-medium text-brand-700 transition-colors hover:border-brand-500 hover:bg-brand-50 min-h-[44px]"
              >
                10件
              </button>
            </div>
            <button
              onClick={() => setShowCountDialog(false)}
              className="mt-3 w-full text-center text-sm text-gray-400 hover:text-gray-600 min-h-[44px]"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* ── Generation Progress ─────────────────────────────────── */}
      {progress.step !== 'idle' && (
        <div className="space-y-3">
          <GenerateProgressBar progress={progress} />
          {progress.step === 'error' && (
            <div className="flex justify-center">
              <button
                onClick={handleRetry}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-5 py-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-600 min-h-[44px]"
              >
                <RotateCcw className="h-4 w-4" />
                再試行
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Filter + Bulk Actions ────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Requirement 7: filter buttons with count badges */}
          {FILTER_OPTIONS.map((opt) => {
            const count = planCounts[opt.value] ?? 0;
            return (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={`rounded-full px-3.5 py-2 text-xs font-medium transition-colors inline-flex items-center gap-1.5 min-h-[44px] sm:py-1.5 sm:min-h-0 ${
                  filter === opt.value
                    ? 'bg-brand-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {opt.label}
                {count > 0 && (
                  <span
                    className={`inline-flex items-center justify-center rounded-full min-w-[18px] h-[18px] px-1 text-[10px] font-bold ${
                      filter === opt.value
                        ? 'bg-white/25 text-white'
                        : 'bg-gray-200 text-gray-700'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {selectedIds.size > 0 && (
          <button
            onClick={handleBulkApprove}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-600 min-h-[44px] w-full sm:w-auto sm:py-2"
          >
            <Check className="h-4 w-4" />
            {selectedIds.size}件を一括承認
          </button>
        )}
      </div>

      {/* ── Fetch Error ─────────────────────────────────────────── */}
      {plansError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          <p>{plansError}</p>
          <button
            onClick={() => { setPlansError(null); setPlansLoading(true); fetchPlans(); }}
            className="mt-2 rounded-lg bg-red-600 px-3 py-2.5 text-xs font-medium text-white transition-colors hover:bg-red-700 min-h-[44px]"
          >
            再試行
          </button>
        </div>
      )}

      {/* ── Plan Cards ───────────────────────────────────────────── */}
      {plansLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-brand-500" />
            <p className="text-sm text-gray-400">プランを読み込み中...</p>
          </div>
        </div>
      ) : filteredPlans.length === 0 ? (
        <div className="rounded-xl bg-gradient-to-br from-brand-50 to-white px-4 py-12 text-center shadow-sm border border-brand-100 sm:px-8 sm:py-20">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-100">
            <Sparkles className="h-8 w-8 text-brand-500" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {plans.length === 0
              ? 'まずはプランを生成しましょう'
              : 'この条件に一致するプランはありません'}
          </h3>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            {plans.length === 0
              ? 'AIがキーワードリサーチからプラン提案まで自動で行います。最初のプランを生成して記事作成を始めましょう。'
              : '別のフィルタを選択するか、新しいプランを生成してください。'}
          </p>
          <button
            onClick={() => setShowCountDialog(true)}
            disabled={isGenerating}
            className="inline-flex items-center justify-center gap-2.5 rounded-xl bg-brand-500 px-6 py-4 text-base font-semibold text-white shadow-lg transition-all hover:bg-brand-600 hover:shadow-xl hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100 w-full sm:w-auto sm:px-8"
          >
            {isGenerating ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Sparkles className="h-5 w-5" />
            )}
            AIプランを生成する
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          {/* Select-all row */}
          {filteredPlans.some((p) => p.status === 'proposed') && (
            <label className="flex items-center gap-2 px-2 py-1 text-xs text-gray-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleSelectAll}
                className="rounded border-gray-300 text-brand-500 focus:ring-brand-400"
              />
              提案中を全て選択
            </label>
          )}

          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {filteredPlans.map((plan) => (
              <div
                key={plan.id}
                className="rounded-xl bg-white shadow-sm border border-gray-100 overflow-hidden flex flex-col"
              >
                {/* Card header */}
                <div className="px-5 pt-4 pb-3 flex items-start gap-3">
                  {plan.status === 'proposed' && (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(plan.id)}
                      onChange={() => toggleSelect(plan.id)}
                      className="mt-1 rounded border-gray-300 text-brand-500 focus:ring-brand-400"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    {/* Theme badge */}
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium mb-2 ${
                        THEME_COLORS[plan.theme] ?? 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {THEME_LABELS[plan.theme] ?? plan.theme}
                    </span>

                    {/* Main keyword */}
                    <h3 className="text-base font-bold text-gray-900 leading-snug mb-1.5">
                      {plan.keyword}
                    </h3>

                    {/* Sub keywords */}
                    {plan.sub_keywords && plan.sub_keywords.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {plan.sub_keywords.map((kw) => (
                          <span
                            key={kw}
                            className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600"
                          >
                            {kw}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Meta info */}
                    <div className="text-xs text-gray-500 space-y-0.5">
                      <p>
                        <span className="font-medium text-gray-600">ペルソナ:</span>{' '}
                        {plan.persona}
                      </p>
                      <p>
                        <span className="font-medium text-gray-600">視点変換:</span>{' '}
                        {PERSPECTIVE_LABELS[plan.perspective_type] ?? plan.perspective_type}
                      </p>
                    </div>
                  </div>

                  {/* SEO score + status */}
                  <div className="flex flex-col items-center gap-2 shrink-0">
                    <SeoScoreRing score={plan.predicted_seo_score} />
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        STATUS_STYLES[plan.status]
                      }`}
                    >
                      {STATUS_LABELS[plan.status]}
                    </span>
                  </div>
                </div>

                {/* Suggestion reason (collapsible) */}
                {plan.proposal_reason && (
                  <div className="px-5 pb-2">
                    <button
                      onClick={() => toggleExpand(plan.id)}
                      className="flex items-center gap-1 text-[11px] text-brand-500 hover:text-brand-700 font-medium"
                    >
                      提案理由
                      {expandedIds.has(plan.id) ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                    {expandedIds.has(plan.id) && (
                      <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                        {plan.proposal_reason}
                      </p>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                {plan.status === 'proposed' && (
                  <div className="mt-auto border-t border-gray-50 px-4 py-3 flex items-center gap-2 sm:px-5">
                    <button
                      onClick={() => handleApprove(plan.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-2.5 text-xs font-medium text-white transition-colors hover:bg-emerald-600 min-h-[44px] sm:py-1.5 sm:min-h-0"
                    >
                      <Check className="h-3.5 w-3.5" />
                      承認
                    </button>
                    <button
                      onClick={() => handleApprove(plan.id, true)}
                      className="inline-flex items-center gap-1 rounded-lg bg-red-500 px-3 py-2.5 text-xs font-medium text-white transition-colors hover:bg-red-600 min-h-[44px] sm:py-1.5 sm:min-h-0"
                    >
                      <X className="h-3.5 w-3.5" />
                      却下
                    </button>
                    <button
                      className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-2.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200 min-h-[44px] sm:py-1.5 sm:min-h-0"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      修正
                    </button>
                  </div>
                )}

                {/* Requirement 8: queue progress on approved/generating cards */}
                {(plan.status === 'approved' || plan.status === 'generating') && (() => {
                  const qi = getQueueItemForPlan(plan.id);
                  if (!qi) return null;
                  const qp = getQueueProgress(qi.current_step);
                  return (
                    <div className="mt-auto border-t border-gray-50 px-5 py-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-gray-500">キュー進行状況</span>
                        <span className="text-[11px] font-medium text-brand-600">
                          {QUEUE_STEP_LABELS[qi.current_step]}
                        </span>
                      </div>
                      <div className="relative h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
                            qi.current_step === 'completed'
                              ? 'bg-emerald-400'
                              : qi.current_step === 'failed'
                                ? 'bg-red-400'
                                : 'bg-brand-400'
                          }`}
                          style={{ width: `${qp}%` }}
                        />
                      </div>
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Generation Queue Section ─────────────────────────────── */}
      <div ref={queueSectionRef} className="rounded-xl bg-white shadow-sm border border-gray-100">
        <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-gray-900 sm:text-lg">生成キュー</h2>
            {queueRunning && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700 animate-pulse">
                <Loader2 className="h-3 w-3 animate-spin" />
                処理中...
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { fetchQueue(); fetchPlans(); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 min-h-[44px] sm:py-1.5 sm:min-h-0"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              更新
            </button>
            {/* Requirement 1: highlight queue start button after approval */}
            <button
              ref={queueStartBtnRef}
              onClick={handleStartQueue}
              disabled={queueRunning}
              className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-xs font-medium text-white transition-all disabled:opacity-50 min-h-[44px] sm:py-1.5 sm:min-h-0 ${
                highlightQueueBtn
                  ? 'bg-emerald-500 hover:bg-emerald-600 ring-2 ring-emerald-300 ring-offset-2 animate-pulse shadow-lg scale-105'
                  : 'bg-brand-500 hover:bg-brand-600'
              }`}
            >
              {queueRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              キュー処理開始
            </button>
            <button
              onClick={handleBatchGenerate}
              disabled={queueLockRef.current || batchState?.status === 'running'}
              className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 min-h-[44px] sm:py-1.5 sm:min-h-0"
            >
              <PlayCircle className="h-4 w-4" />
              一括生成
            </button>
          </div>
        </div>

        {/* Batch Progress Panel */}
        {batchState && (
          <div className="mx-4 mt-4 rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:mx-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-brand-700">
                一括生成 {batchState.status === 'running' ? '処理中...' : batchState.status === 'completed' ? '完了' : '準備中...'}
              </h3>
              {batchState.status === 'running' && (
                <button onClick={() => { batchCancelRef.current = true; }} className="text-xs text-red-500 hover:text-red-700">中止</button>
              )}
              {batchState.status === 'completed' && (
                <button onClick={() => setBatchState(null)} className="text-xs text-gray-500 hover:text-gray-700">閉じる</button>
              )}
            </div>

            {/* Progress bar */}
            <div className="mb-3">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>{batchState.completedCount}/{batchState.items.length} 記事完了</span>
                {batchState.failedCount > 0 && <span className="text-red-500">{batchState.failedCount}件失敗</span>}
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${((batchState.completedCount + batchState.failedCount) / Math.max(batchState.items.length, 1)) * 100}%` }} />
              </div>
            </div>

            {/* Item list */}
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {batchState.items.map((item) => (
                <div key={item.articleId} className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded ${item.status === 'processing' ? 'bg-blue-50' : item.status === 'completed' ? 'bg-green-50' : item.status === 'failed' ? 'bg-red-50' : ''}`}>
                  <span className="w-4 text-center">
                    {item.status === 'completed' ? '✓' : item.status === 'failed' ? '✗' : item.status === 'processing' ? '●' : '○'}
                  </span>
                  <span className="flex-1 truncate">{item.title || item.keyword}</span>
                  <span className="text-gray-400 shrink-0">
                    {item.status === 'processing' ? item.currentStep :
                     item.status === 'completed' ? (item.published ? '公開済み ✓' : '完了') :
                     item.status === 'failed' ? item.errorMessage?.slice(0, 20) : '待機中'}
                  </span>
                </div>
              ))}
            </div>

            {batchState.status === 'completed' && batchState.completedCount > 0 && (
              <p className="mt-3 text-xs text-green-600">
                {batchState.completedCount}件の記事を自動公開しました。
                <a href="/dashboard/articles?status=published" className="underline ml-1">公開済み記事を確認</a>
              </p>
            )}
          </div>
        )}

        {/* Requirement 4: queue all-completed notification */}
        {queueAllCompleted && queueItems.length > 0 && (
          <div className="mx-4 mt-4 rounded-lg bg-emerald-50 border border-emerald-200 p-4 flex flex-col gap-3 sm:mx-6 sm:flex-row sm:items-center">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-emerald-800">
                すべての記事が生成されました！
              </p>
              <p className="text-xs text-emerald-600 mt-0.5">
                {queueItems.length}件の記事が正常に生成されました。
              </p>
            </div>
            <Link
              href="/dashboard/articles"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-emerald-700 shrink-0 min-h-[44px] w-full sm:w-auto sm:py-2"
            >
              記事一覧で確認
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}

        {queueItems.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-gray-400 sm:px-6">
            キューにアイテムがありません。プランを承認するとキューに追加されます。
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {queueItems.map((item) => {
              const queueProgress = getQueueProgress(item.current_step);
              const isFailed = item.current_step === 'failed';
              return (
                <li key={item.id} className={`px-4 py-4 sm:px-6 ${isFailed ? 'bg-red-50/50' : ''}`}>
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <span className="text-sm font-medium text-gray-800 truncate">
                      {item.plan_name}
                    </span>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <span className={`text-xs ${isFailed ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                        {QUEUE_STEP_LABELS[item.current_step]}
                      </span>
                      {/* Requirement 5: retry button for failed items */}
                      {isFailed && (
                        <button
                          onClick={() => handleRetryQueueItem(item.id)}
                          className="inline-flex items-center gap-1 rounded-md bg-red-500 px-2.5 py-2 text-[11px] font-medium text-white transition-colors hover:bg-red-600 min-h-[44px] sm:py-1 sm:min-h-0"
                        >
                          <RotateCcw className="h-3 w-3" />
                          再試行
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Error message for failed items */}
                  {isFailed && item.error_message && (
                    <div className="flex items-start gap-1.5 mb-2 rounded bg-red-100 px-2.5 py-1.5">
                      <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-red-700 leading-relaxed">{item.error_message}</p>
                    </div>
                  )}
                  {/* Progress bar */}
                  <div className="relative h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
                        item.current_step === 'completed'
                          ? 'bg-emerald-400'
                          : isFailed
                            ? 'bg-red-400'
                            : 'bg-brand-400'
                      }`}
                      style={{ width: `${isFailed ? 100 : queueProgress}%` }}
                    />
                  </div>
                  {/* Step indicators */}
                  {!isFailed && (
                    <div className="flex justify-between mt-1 overflow-x-auto">
                      {QUEUE_STEPS.filter((s) => s !== 'failed').map((step) => {
                        const stepIdx = QUEUE_STEPS.indexOf(step);
                        const currentIdx = QUEUE_STEPS.indexOf(item.current_step);
                        const done = stepIdx <= currentIdx;
                        return (
                          <span
                            key={step}
                            className={`text-[10px] ${
                              done ? 'text-brand-600 font-medium' : 'text-gray-300'
                            }`}
                          >
                            {QUEUE_STEP_LABELS[step]}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
