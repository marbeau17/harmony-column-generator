// ============================================================================
// src/app/(dashboard)/dashboard/planner/page.tsx
// AIコンテンツプランナー — プラン生成・管理・キュー処理
// ============================================================================
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Pencil,
  Play,
  Loader2,
  RefreshCw,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

type PlanStatus = 'proposed' | 'approved' | 'generating' | 'completed';

interface ContentPlan {
  id: string;
  theme: string;
  main_keyword: string;
  sub_keywords: string[];
  persona: string;
  perspective_type: string;
  source_titles: string[];
  predicted_seo_score: number;
  suggestion_reason: string;
  status: PlanStatus;
}

type QueueStep = 'pending' | 'outline' | 'body' | 'images' | 'seo_check' | 'completed';

interface QueueItem {
  id: string;
  plan_id: string;
  plan_name: string;
  current_step: QueueStep;
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
};

const FILTER_OPTIONS: { value: PlanStatus | 'all'; label: string }[] = [
  { value: 'all',        label: '全て' },
  { value: 'proposed',   label: '提案中' },
  { value: 'approved',   label: '承認済' },
  { value: 'generating', label: '生成中' },
  { value: 'completed',  label: '完了' },
];

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

// ─── Component ──────────────────────────────────────────────────────────────

export default function PlannerPage() {
  // Plans
  const [plans, setPlans] = useState<ContentPlan[]>([]);
  const [filter, setFilter] = useState<PlanStatus | 'all'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');

  // Generate dialog
  const [showCountDialog, setShowCountDialog] = useState(false);

  // Queue
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueRunning, setQueueRunning] = useState(false);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // ── Fetch plans ─────────────────────────────────────────────────
  const fetchPlans = useCallback(async () => {
    try {
      const res = await fetch('/api/plans');
      if (res.ok) {
        const data = await res.json();
        setPlans(data.plans ?? []);
      }
    } catch {
      // silent
    }
  }, []);

  // ── Fetch queue ─────────────────────────────────────────────────
  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/queue');
      if (res.ok) {
        const data = await res.json();
        setQueueItems(data.items ?? []);
        // Stop polling if nothing is processing
        const hasActive = (data.items ?? []).some(
          (i: QueueItem) => i.current_step !== 'completed' && i.current_step !== 'pending',
        );
        if (!hasActive && pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
          setQueueRunning(false);
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

  // ── Generate plans ──────────────────────────────────────────────
  const handleGenerate = async (count: number) => {
    setShowCountDialog(false);
    setLoading(true);
    setLoadingMsg('AIがキーワードリサーチ中...');

    try {
      // Phase message
      const phaseTimer = setTimeout(() => setLoadingMsg('プランを生成中...'), 4000);

      const res = await fetch('/api/plans/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count }),
      });

      clearTimeout(phaseTimer);

      if (res.ok) {
        await fetchPlans();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? 'プラン生成に失敗しました');
      }
    } catch {
      alert('プラン生成に失敗しました');
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  };

  // ── Approve / Reject ───────────────────────────────────────────
  const handleApprove = async (id: string, reject = false) => {
    try {
      const res = await fetch(`/api/plans/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reject }),
      });
      if (res.ok) await fetchPlans();
    } catch {
      // silent
    }
  };

  const handleBulkApprove = async () => {
    const ids = Array.from(selectedIds);
    await Promise.all(ids.map((id) => handleApprove(id)));
    setSelectedIds(new Set());
    await fetchPlans();
  };

  // ── Queue processing ───────────────────────────────────────────
  const handleStartQueue = async () => {
    setQueueRunning(true);
    try {
      await fetch('/api/queue/process', { method: 'POST' });
    } catch {
      // silent
    }
    // Start polling
    if (!pollingRef.current) {
      pollingRef.current = setInterval(() => {
        fetchQueue();
        fetchPlans();
      }, 5000);
    }
    fetchQueue();
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AIコンテンツプランナー</h1>
          <p className="mt-1 text-sm text-gray-500">
            AIがキーワードリサーチからプラン提案まで自動で行います
          </p>
        </div>
        <button
          onClick={() => setShowCountDialog(true)}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
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
                className="flex-1 rounded-lg border-2 border-brand-200 px-4 py-3 text-center font-medium text-brand-700 transition-colors hover:border-brand-500 hover:bg-brand-50"
              >
                5件
              </button>
              <button
                onClick={() => handleGenerate(10)}
                className="flex-1 rounded-lg border-2 border-brand-200 px-4 py-3 text-center font-medium text-brand-700 transition-colors hover:border-brand-500 hover:bg-brand-50"
              >
                10件
              </button>
            </div>
            <button
              onClick={() => setShowCountDialog(false)}
              className="mt-3 w-full text-center text-sm text-gray-400 hover:text-gray-600"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      {/* ── Loading overlay ──────────────────────────────────────── */}
      {loading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/30">
          <div className="rounded-xl bg-white px-8 py-6 shadow-2xl text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-brand-500 mb-3" />
            <p className="text-sm font-medium text-gray-700">{loadingMsg}</p>
          </div>
        </div>
      )}

      {/* ── Filter + Bulk Actions ────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                filter === opt.value
                  ? 'bg-brand-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {selectedIds.size > 0 && (
          <button
            onClick={handleBulkApprove}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-emerald-600"
          >
            <Check className="h-4 w-4" />
            {selectedIds.size}件を一括承認
          </button>
        )}
      </div>

      {/* ── Plan Cards ───────────────────────────────────────────── */}
      {filteredPlans.length === 0 ? (
        <div className="rounded-xl bg-white px-6 py-16 text-center shadow-sm">
          <Sparkles className="mx-auto h-10 w-10 text-gray-300 mb-3" />
          <p className="text-sm text-gray-400">
            プランがありません。「プランを生成」ボタンでAIにプランを提案させましょう。
          </p>
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

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
                      {plan.main_keyword}
                    </h3>

                    {/* Sub keywords */}
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

                {/* Source titles */}
                {plan.source_titles.length > 0 && (
                  <div className="px-5 pb-2">
                    <p className="text-[11px] font-medium text-gray-400 mb-1">元記事</p>
                    <ul className="space-y-0.5">
                      {plan.source_titles.slice(0, 3).map((t, i) => (
                        <li
                          key={i}
                          className="text-xs text-gray-500 truncate"
                          title={t}
                        >
                          {t}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Suggestion reason (collapsible) */}
                {plan.suggestion_reason && (
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
                        {plan.suggestion_reason}
                      </p>
                    )}
                  </div>
                )}

                {/* Action buttons */}
                {plan.status === 'proposed' && (
                  <div className="mt-auto border-t border-gray-50 px-5 py-3 flex items-center gap-2">
                    <button
                      onClick={() => handleApprove(plan.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-600"
                    >
                      <Check className="h-3.5 w-3.5" />
                      承認
                    </button>
                    <button
                      onClick={() => handleApprove(plan.id, true)}
                      className="inline-flex items-center gap-1 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-600"
                    >
                      <X className="h-3.5 w-3.5" />
                      却下
                    </button>
                    <button
                      className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      修正
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Generation Queue Section ─────────────────────────────── */}
      <div className="rounded-xl bg-white shadow-sm border border-gray-100">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">生成キュー</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { fetchQueue(); fetchPlans(); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              更新
            </button>
            <button
              onClick={handleStartQueue}
              disabled={queueRunning}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
            >
              {queueRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              キュー処理開始
            </button>
          </div>
        </div>

        {queueItems.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-400">
            キューにアイテムがありません。プランを承認するとキューに追加されます。
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {queueItems.map((item) => {
              const progress = getQueueProgress(item.current_step);
              return (
                <li key={item.id} className="px-6 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-800 truncate">
                      {item.plan_name}
                    </span>
                    <span className="text-xs text-gray-500 shrink-0 ml-3">
                      {QUEUE_STEP_LABELS[item.current_step]}
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div className="relative h-2 w-full rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
                        item.current_step === 'completed'
                          ? 'bg-emerald-400'
                          : 'bg-brand-400'
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  {/* Step indicators */}
                  <div className="flex justify-between mt-1">
                    {QUEUE_STEPS.map((step) => {
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
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
