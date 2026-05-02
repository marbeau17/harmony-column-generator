// ============================================================================
// src/app/(dashboard)/dashboard/articles/batch-zero-generate/page.tsx
// バッチ・ゼロ生成 (P5-21) フォーム — 1〜10 件をまとめて投入
// ============================================================================
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Sparkles, Plus, Trash2, Loader2 } from 'lucide-react';
import IntentRadioCard, { type IntentType } from '@/components/articles/IntentRadioCard';
import { useGenerationJobs } from '@/hooks/useGenerationJobs';

interface ThemeOption {
  id: string;
  name: string;
}
interface PersonaOption {
  id: string;
  name: string;
  age_range: string | null;
  description: string | null;
  search_patterns: string[];
  tone_guide: string | null;
}

interface JobRow {
  /** ローカル識別用 (送信時は除外) */
  uid: number;
  theme_id: string;
  persona_id: string;
  keywords: string[];
  keywordDraft: string;
  intent: IntentType | '';
  target_length: number;
}

const MAX_ROWS = 10;
const MAX_KEYWORDS_PER_ROW = 8;
const TARGET_DEFAULT = 2000;
const TARGET_MIN = 800;
const TARGET_MAX = 5000;
const COST_PER_ARTICLE_USD = 0.18;

let rowUid = 1;
const newRow = (): JobRow => ({
  uid: rowUid++,
  theme_id: '',
  persona_id: '',
  keywords: [],
  keywordDraft: '',
  intent: '',
  target_length: TARGET_DEFAULT,
});

export default function BatchZeroGeneratePage() {
  const [rows, setRows] = useState<JobRow[]>([newRow()]);
  const [themes, setThemes] = useState<ThemeOption[]>([]);
  const [personas, setPersonas] = useState<PersonaOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { startBatch, summary } = useGenerationJobs();

  // ── master fetch ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setOptionsLoading(true);
      try {
        const [tRes, pRes] = await Promise.all([
          fetch('/api/themes'),
          fetch('/api/personas'),
        ]);
        if (!tRes.ok) throw new Error('テーマ取得失敗');
        if (!pRes.ok) throw new Error('ペルソナ取得失敗');
        const tJson = (await tRes.json()) as { themes?: ThemeOption[] };
        const pJson = (await pRes.json()) as { personas?: PersonaOption[] };
        if (cancelled) return;
        setThemes(tJson.themes ?? []);
        setPersonas(pJson.personas ?? []);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        if (!cancelled) setOptionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateRow = useCallback((uid: number, patch: Partial<JobRow>) => {
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  }, []);

  const addRow = () => {
    setRows((prev) => {
      if (prev.length >= MAX_ROWS) {
        toast.error(`最大 ${MAX_ROWS} 行までです`);
        return prev;
      }
      return [...prev, newRow()];
    });
  };

  const removeRow = (uid: number) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.uid !== uid) : prev));
  };

  const addKeyword = (uid: number, raw: string) => {
    const trimmed = raw.trim().replace(/[、,]+$/u, '').trim();
    if (!trimmed) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.uid !== uid) return r;
        if (r.keywords.length >= MAX_KEYWORDS_PER_ROW) {
          toast.error(`キーワードは行あたり最大 ${MAX_KEYWORDS_PER_ROW} 個`);
          return r;
        }
        if (r.keywords.includes(trimmed)) return r;
        return { ...r, keywords: [...r.keywords, trimmed], keywordDraft: '' };
      }),
    );
  };

  // ── テンプレ: 全 7 ペルソナ × 同テーマ ────────────────────────────
  const applyAllPersonasTemplate = () => {
    if (personas.length === 0) {
      toast.error('ペルソナ未読み込み');
      return;
    }
    const baseRow = rows[0];
    if (!baseRow.theme_id) {
      toast.error('まず 1 行目のテーマを選択してください');
      return;
    }
    if (baseRow.keywords.length === 0) {
      toast.error('まず 1 行目にキーワードを 1 つ以上追加してください');
      return;
    }
    if (!baseRow.intent) {
      toast.error('まず 1 行目の意図を選択してください');
      return;
    }
    const newRows: JobRow[] = personas.slice(0, MAX_ROWS).map((p) => ({
      uid: rowUid++,
      theme_id: baseRow.theme_id,
      persona_id: p.id,
      keywords: [...baseRow.keywords],
      keywordDraft: '',
      intent: baseRow.intent,
      target_length: baseRow.target_length,
    }));
    setRows(newRows);
    toast.success(`${newRows.length} 行 (全ペルソナ) をテンプレ展開`);
  };

  // ── validation ─────────────────────────────────────────────────────
  const validateAll = (): { ok: true } | { ok: false; messages: string[] } => {
    const messages: string[] = [];
    rows.forEach((r, i) => {
      const prefix = `行 ${i + 1}`;
      if (!r.theme_id) messages.push(`${prefix}: テーマ未選択`);
      if (!r.persona_id) messages.push(`${prefix}: ペルソナ未選択`);
      if (r.keywords.length === 0) messages.push(`${prefix}: キーワード必須`);
      if (!r.intent) messages.push(`${prefix}: 意図未選択`);
      if (r.target_length < TARGET_MIN || r.target_length > TARGET_MAX) {
        messages.push(`${prefix}: 文字数は ${TARGET_MIN}〜${TARGET_MAX}`);
      }
    });
    return messages.length === 0 ? { ok: true } : { ok: false, messages };
  };

  // ── submit ─────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const v = validateAll();
      if (!v.ok) {
        for (const m of v.messages) toast.error(m);
        return;
      }
      const totalCost = COST_PER_ARTICLE_USD * rows.length;
      const ok = window.confirm(
        `${rows.length} 件のゼロ生成を一括投入します。\n\n` +
          `概算コスト: $${totalCost.toFixed(2)} (${rows.length} 件 × $${COST_PER_ARTICLE_USD})\n\n` +
          `実行しますか?`,
      );
      if (!ok) return;

      setSubmitting(true);
      try {
        const payload = {
          jobs: rows.map((r) => ({
            theme_id: r.theme_id,
            persona_id: r.persona_id,
            keywords: r.keywords,
            intent: r.intent,
            target_length: r.target_length,
          })),
        };
        const res = await fetch('/api/articles/zero-generate-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        const json = (await res.json()) as {
          batch_id: string;
          jobs: { index: number; job_id?: string; status: string; error?: string }[];
        };
        const launched = json.jobs.filter((j) => j.status === 'queued' && j.job_id);
        const failed = json.jobs.filter((j) => j.status === 'failed');
        startBatch(launched.map((j) => j.job_id!));
        if (failed.length === 0) {
          toast.success(
            `🚀 ${launched.length} 件のジョブを開始しました。バナーで進捗確認できます。`,
            { duration: 8000 },
          );
        } else {
          toast(
            `⚠️ ${launched.length} 件成功 / ${failed.length} 件起動失敗`,
            { duration: 10000, icon: '⚠️' },
          );
        }
        // フォームを初期化
        setRows([newRow()]);
      } catch (e) {
        toast.error(`バッチ投入失敗: ${(e as Error).message}`);
      } finally {
        setSubmitting(false);
      }
    },
    [rows, startBatch],
  );

  const totalCost = (rows.length * COST_PER_ARTICLE_USD).toFixed(2);
  const batchInProgress = summary.total > 0 && !summary.all_terminal;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            📚 バッチ・ゼロ生成
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            最大 {MAX_ROWS} 件のゼロ生成を一括投入。完了通知は上部バナーで確認できます。
          </p>
        </div>
        <Link
          href="/dashboard/articles/new-from-scratch"
          className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          単発生成へ →
        </Link>
      </div>

      {batchInProgress && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
          ⚠️ 別のバッチ生成が進行中です ({summary.done}/{summary.total} 完了)。完了後に再実行してください。
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
              ジョブ一覧 ({rows.length} / {MAX_ROWS})
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={applyAllPersonasTemplate}
                disabled={submitting || optionsLoading}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700"
                title="1 行目を元に全 7 ペルソナへ展開"
              >
                テンプレ: 全ペルソナ展開
              </button>
              <button
                type="button"
                onClick={addRow}
                disabled={submitting || rows.length >= MAX_ROWS}
                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100 dark:hover:bg-amber-900/50"
              >
                <Plus className="h-3 w-3" />
                行を追加
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {rows.map((r, idx) => (
              <div
                key={r.uid}
                className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    行 {idx + 1}
                  </span>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(r.uid)}
                      disabled={submitting}
                      className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-0.5 block text-xs font-medium text-gray-600 dark:text-gray-300">
                      テーマ
                    </label>
                    <select
                      value={r.theme_id}
                      onChange={(e) => updateRow(r.uid, { theme_id: e.target.value })}
                      disabled={submitting || optionsLoading}
                      className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    >
                      <option value="">選択してください</option>
                      {themes.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-0.5 block text-xs font-medium text-gray-600 dark:text-gray-300">
                      ペルソナ
                    </label>
                    <select
                      value={r.persona_id}
                      onChange={(e) => updateRow(r.uid, { persona_id: e.target.value })}
                      disabled={submitting || optionsLoading}
                      className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    >
                      <option value="">選択してください</option>
                      {personas.map((p) => {
                        const role = [
                          p.age_range,
                          (p.search_patterns ?? []).join('・'),
                          p.tone_guide,
                        ]
                          .filter(Boolean)
                          .join(' / ');
                        return (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {role ? ` — ${role}` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                <div className="mt-3">
                  <label className="mb-0.5 block text-xs font-medium text-gray-600 dark:text-gray-300">
                    キーワード ({r.keywords.length} / {MAX_KEYWORDS_PER_ROW})
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-gray-300 px-2 py-1 dark:border-gray-600">
                    {r.keywords.map((kw) => (
                      <span
                        key={kw}
                        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-100"
                      >
                        {kw}
                        <button
                          type="button"
                          onClick={() =>
                            updateRow(r.uid, {
                              keywords: r.keywords.filter((k) => k !== kw),
                            })
                          }
                          disabled={submitting}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      value={r.keywordDraft}
                      onChange={(e) => updateRow(r.uid, { keywordDraft: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',' || e.key === '、') {
                          e.preventDefault();
                          if (r.keywordDraft.trim()) addKeyword(r.uid, r.keywordDraft);
                        }
                      }}
                      onBlur={() => {
                        if (r.keywordDraft.trim()) addKeyword(r.uid, r.keywordDraft);
                      }}
                      disabled={submitting || r.keywords.length >= MAX_KEYWORDS_PER_ROW}
                      placeholder={
                        r.keywords.length === 0 ? 'Enter または , で追加' : '追加…'
                      }
                      className="min-w-[6rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-xs focus:outline-none dark:text-gray-100"
                    />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-0.5 block text-xs font-medium text-gray-600 dark:text-gray-300">
                      意図
                    </label>
                    <IntentRadioCard
                      value={r.intent}
                      onChange={(v) => updateRow(r.uid, { intent: v })}
                      disabled={submitting}
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-xs font-medium text-gray-600 dark:text-gray-300">
                      目標文字数 ({TARGET_MIN}〜{TARGET_MAX})
                    </label>
                    <input
                      type="number"
                      min={TARGET_MIN}
                      max={TARGET_MAX}
                      step={100}
                      value={r.target_length}
                      onChange={(e) =>
                        updateRow(r.uid, { target_length: Number(e.target.value) })
                      }
                      disabled={submitting}
                      className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
          <div className="text-sm">
            <span className="text-gray-600 dark:text-gray-300">概算コスト: </span>
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              ${totalCost}
            </span>
            <span className="ml-2 text-xs text-gray-500">
              ({rows.length} 件 × ${COST_PER_ARTICLE_USD})
            </span>
          </div>
          <button
            type="submit"
            disabled={submitting || optionsLoading || batchInProgress}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {submitting ? '投入中…' : `${rows.length} 件を一括生成`}
          </button>
        </div>
      </form>
    </div>
  );
}
