// ============================================================================
// src/app/(dashboard)/dashboard/articles/new-from-scratch/page.tsx
// AI ゼロ生成（spec §11.1, §11.2）
// 2 カラム: 左 60% フォーム / 右 40% プレビュー
// 入力: theme / persona / keywords (Tag Chip 最大8) / intent (Radio Card 4) / target_length
// 「生成」→ POST /api/articles/zero-generate → Stepper 表示 → 完了で結果＆遷移リンク
// dark: 対応 + react-hot-toast でエラー通知
// ============================================================================
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Sparkles, X, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';

import GenerationStepper, { type GenerationStage } from '@/components/articles/GenerationStepper';
import IntentRadioCard, { type IntentType } from '@/components/articles/IntentRadioCard';

// ─── Option definitions（記事作成ページと同じ枠を踏襲） ────────────────────

const THEME_CATEGORIES = [
  { value: 'soul_mission',    label: '魂と使命' },
  { value: 'relationships',   label: '人間関係' },
  { value: 'grief_care',      label: 'グリーフケア' },
  { value: 'self_growth',     label: '自己成長' },
  { value: 'healing',         label: '癒しと浄化' },
  { value: 'daily_awareness', label: '日常の気づき' },
  { value: 'spiritual_intro', label: 'スピリチュアル入門' },
] as const;

const PERSONA_TYPES = [
  { value: 'spiritual_beginner',      label: 'スピリチュアル初心者' },
  { value: 'self_growth_seeker',      label: '自己成長を求める人' },
  { value: 'grief_sufferer',          label: '喪失体験に苦しむ人' },
  { value: 'meditation_practitioner', label: '瞑想実践者' },
  { value: 'energy_worker',           label: 'エネルギーワーカー' },
  { value: 'life_purpose_seeker',     label: '人生の目的を探す人' },
  { value: 'holistic_health_seeker',  label: 'ホリスティック健康志向の人' },
] as const;

const MAX_KEYWORDS = 8;
const MIN_LENGTH = 800;
const MAX_LENGTH = 5000;

// ─── 結果型 ────────────────────────────────────────────────────────────────

interface ZeroGenerateResult {
  articleId?: string;
  id?: string;
  slug?: string;
  title?: string;
  meta_description?: string;
  excerpt?: string;
  preview_html?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function NewFromScratchPage() {
  // ── Form state ────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState<string>('');
  const [persona, setPersona] = useState<string>('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState<string>('');
  const [intent, setIntent] = useState<IntentType | ''>('');
  const [targetLength, setTargetLength] = useState<number>(2000);

  // ── Generation state ──────────────────────────────────────────────────────
  const [stage, setStage] = useState<GenerationStage>('idle');
  const [stageError, setStageError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [result, setResult] = useState<ZeroGenerateResult | null>(null);

  const generating = stage !== 'idle' && stage !== 'done' && stage !== 'error';
  const stageTimers = useRef<number[]>([]);

  // ── ページ離脱防止（生成中） ─────────────────────────────────────────────
  useEffect(() => {
    if (!generating) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [generating]);

  // ── Stage timer cleanup ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stageTimers.current.forEach((id) => window.clearTimeout(id));
      stageTimers.current = [];
    };
  }, []);

  // ── Keyword chip handlers ─────────────────────────────────────────────────
  const addKeyword = useCallback(
    (raw: string) => {
      const trimmed = raw.trim().replace(/[、,]+$/u, '').trim();
      if (!trimmed) return;
      setKeywords((prev) => {
        if (prev.length >= MAX_KEYWORDS) {
          toast.error(`キーワードは最大 ${MAX_KEYWORDS} 個までです`);
          return prev;
        }
        if (prev.includes(trimmed)) {
          toast.error('同じキーワードは追加できません');
          return prev;
        }
        return [...prev, trimmed];
      });
    },
    [],
  );

  const removeKeyword = useCallback((kw: string) => {
    setKeywords((prev) => prev.filter((k) => k !== kw));
  }, []);

  const handleKeywordKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '、') {
      e.preventDefault();
      if (keywordDraft.trim()) {
        addKeyword(keywordDraft);
        setKeywordDraft('');
      }
    } else if (e.key === 'Backspace' && !keywordDraft && keywords.length > 0) {
      // 空欄で Backspace 連打 → 末尾チップ削除
      removeKeyword(keywords[keywords.length - 1]);
    }
  };

  // ── プレビュー生成（フォーム値をライブ反映） ─────────────────────────────
  const previewMeta = useMemo(() => {
    const themeLabel = THEME_CATEGORIES.find((t) => t.value === theme)?.label ?? '未選択';
    const personaLabel = PERSONA_TYPES.find((p) => p.value === persona)?.label ?? '未選択';
    const intentLabel = (() => {
      switch (intent) {
        case 'info': return '情報提供';
        case 'empathy': return '共感';
        case 'solve': return '課題解決';
        case 'introspect': return '内省促進';
        default: return '未選択';
      }
    })();
    return { themeLabel, personaLabel, intentLabel };
  }, [theme, persona, intent]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (generating) return;

    // 簡易バリデーション
    if (!theme) { toast.error('テーマを選択してください'); return; }
    if (!persona) { toast.error('ペルソナを選択してください'); return; }
    if (keywords.length === 0) { toast.error('キーワードを 1 つ以上追加してください'); return; }
    if (!intent) { toast.error('意図タイプを選択してください'); return; }
    if (!Number.isFinite(targetLength) || targetLength < MIN_LENGTH || targetLength > MAX_LENGTH) {
      toast.error(`目標文字数は ${MIN_LENGTH}〜${MAX_LENGTH} の範囲で指定してください`);
      return;
    }

    // タイマー & 状態リセット
    stageTimers.current.forEach((id) => window.clearTimeout(id));
    stageTimers.current = [];
    setResult(null);
    setStageError(null);
    setStartedAt(Date.now());
    setStage('stage1');

    // バックエンド完了前に視覚的に進めるための擬似ステージ進行
    // （バックエンドが進捗ストリーミングに対応するまでの暫定 UX）
    stageTimers.current.push(
      window.setTimeout(() => setStage((s) => (s === 'stage1' ? 'stage2' : s)), 30_000),
      window.setTimeout(() => setStage((s) => (s === 'stage2' ? 'hallucination' : s)), 110_000),
    );

    try {
      const res = await fetch('/api/articles/zero-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme,
          persona,
          keywords,
          intent,
          target_length: targetLength,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body && typeof body.error === 'string' && body.error) ||
            `生成に失敗しました (HTTP ${res.status})`,
        );
      }

      const json = (await res.json()) as ZeroGenerateResult;
      // タイマーキャンセル → 完了へ
      stageTimers.current.forEach((id) => window.clearTimeout(id));
      stageTimers.current = [];
      setResult(json);
      setStage('done');
      toast.success('記事生成が完了しました');
    } catch (err) {
      stageTimers.current.forEach((id) => window.clearTimeout(id));
      stageTimers.current = [];
      const message = err instanceof Error ? err.message : '生成に失敗しました';
      setStageError(message);
      setStage('error');
      toast.error(message);
    }
  };

  const handleReset = () => {
    if (generating) return;
    setStage('idle');
    setStageError(null);
    setStartedAt(null);
    setResult(null);
  };

  const resultArticleId = result?.articleId ?? result?.id ?? null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* ヘッダー */}
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-xl font-bold text-brand-800 dark:text-brand-50 sm:text-2xl">
          <Sparkles className="h-5 w-5 text-brand-500 dark:text-brand-300" />
          AI ゼロ生成
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          テーマ・ペルソナ・キーワード・意図のみから、AI が記事を一気通貫で生成します。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* ── 左 60% フォーム ─────────────────────────────────────────── */}
        <form
          onSubmit={handleSubmit}
          className="space-y-5 lg:col-span-3"
          aria-label="ゼロ生成フォーム"
        >
          <div
            className="space-y-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm
              dark:border-gray-700 dark:bg-gray-900 sm:p-6"
          >
            {/* テーマ */}
            <div>
              <label
                htmlFor="theme"
                className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-100"
              >
                テーマ <span className="text-red-500">*</span>
              </label>
              <select
                id="theme"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                disabled={generating}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm
                  text-gray-900 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20
                  disabled:cursor-not-allowed disabled:opacity-50
                  dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="">選択してください</option>
                {THEME_CATEGORIES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* ペルソナ */}
            <div>
              <label
                htmlFor="persona"
                className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-100"
              >
                ペルソナ <span className="text-red-500">*</span>
              </label>
              <select
                id="persona"
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                disabled={generating}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm
                  text-gray-900 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20
                  disabled:cursor-not-allowed disabled:opacity-50
                  dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="">選択してください</option>
                {PERSONA_TYPES.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            {/* キーワード Tag Chip */}
            <div>
              <label
                htmlFor="keywords"
                className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-100"
              >
                キーワード <span className="text-red-500">*</span>
                <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                  最大 {MAX_KEYWORDS} 個 / Enter または , で追加
                </span>
              </label>
              <div
                className={`flex min-h-[44px] flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5 transition
                  focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20
                  ${
                    generating
                      ? 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800'
                      : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800'
                  }`}
              >
                {keywords.map((kw) => (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-1 text-xs font-medium text-brand-800
                      dark:bg-brand-900/40 dark:text-brand-100"
                  >
                    {kw}
                    <button
                      type="button"
                      onClick={() => removeKeyword(kw)}
                      disabled={generating}
                      className="rounded-full p-0.5 transition hover:bg-brand-200 disabled:opacity-50 dark:hover:bg-brand-800"
                      aria-label={`${kw} を削除`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <input
                  id="keywords"
                  type="text"
                  value={keywordDraft}
                  onChange={(e) => setKeywordDraft(e.target.value)}
                  onKeyDown={handleKeywordKeyDown}
                  onBlur={() => {
                    if (keywordDraft.trim()) {
                      addKeyword(keywordDraft);
                      setKeywordDraft('');
                    }
                  }}
                  disabled={generating || keywords.length >= MAX_KEYWORDS}
                  placeholder={
                    keywords.length >= MAX_KEYWORDS
                      ? '上限に達しました'
                      : keywords.length === 0
                      ? '例: チャクラ, 瞑想, 初心者'
                      : '追加…'
                  }
                  className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-1 text-sm
                    text-gray-900 placeholder:text-gray-400 focus:outline-none
                    disabled:cursor-not-allowed disabled:opacity-50
                    dark:text-gray-100 dark:placeholder:text-gray-500"
                />
              </div>
            </div>

            {/* 意図 Radio Card */}
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-800 dark:text-gray-100">
                意図 <span className="text-red-500">*</span>
              </label>
              <IntentRadioCard
                value={intent}
                onChange={(v) => setIntent(v)}
                disabled={generating}
              />
            </div>

            {/* 目標文字数 */}
            <div>
              <label
                htmlFor="targetLength"
                className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-100"
              >
                目標文字数
                <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                  {MIN_LENGTH.toLocaleString()}〜{MAX_LENGTH.toLocaleString()} 文字
                </span>
              </label>
              <input
                id="targetLength"
                type="number"
                min={MIN_LENGTH}
                max={MAX_LENGTH}
                step={100}
                value={targetLength}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) setTargetLength(n);
                }}
                disabled={generating}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm
                  text-gray-900 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20
                  disabled:cursor-not-allowed disabled:opacity-50
                  dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>

            {/* 送信ボタン */}
            <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-end">
              {(stage === 'done' || stage === 'error') && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="inline-flex items-center justify-center rounded-lg border border-gray-300
                    bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50
                    dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  リセット
                </button>
              )}
              <button
                type="submit"
                disabled={generating}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5
                  text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 active:bg-brand-700
                  focus:outline-none focus:ring-2 focus:ring-brand-500/40
                  disabled:cursor-not-allowed disabled:opacity-50
                  dark:bg-brand-500 dark:hover:bg-brand-400"
              >
                {generating ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {generating ? '生成中…' : '生成'}
              </button>
            </div>
          </div>
        </form>

        {/* ── 右 40% プレビュー ─────────────────────────────────────────── */}
        <aside className="space-y-4 lg:col-span-2" aria-label="プレビュー">
          {/* 入力サマリ */}
          <div
            className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm
              dark:border-gray-700 dark:bg-gray-900 sm:p-5"
          >
            <h2 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-100">
              入力プレビュー
            </h2>
            <dl className="space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">テーマ</dt>
                <dd className="text-right text-gray-900 dark:text-gray-100">
                  {previewMeta.themeLabel}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">ペルソナ</dt>
                <dd className="text-right text-gray-900 dark:text-gray-100">
                  {previewMeta.personaLabel}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">意図</dt>
                <dd className="text-right text-gray-900 dark:text-gray-100">
                  {previewMeta.intentLabel}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">目標文字数</dt>
                <dd className="text-right tabular-nums text-gray-900 dark:text-gray-100">
                  {targetLength.toLocaleString()} 文字
                </dd>
              </div>
              <div className="border-t border-gray-100 pt-2 dark:border-gray-800">
                <dt className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                  キーワード（{keywords.length} / {MAX_KEYWORDS}）
                </dt>
                <dd className="flex flex-wrap gap-1.5">
                  {keywords.length === 0 ? (
                    <span className="text-xs text-gray-400 dark:text-gray-500">未入力</span>
                  ) : (
                    keywords.map((kw) => (
                      <span
                        key={kw}
                        className="inline-flex items-center rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-800
                          dark:bg-brand-900/40 dark:text-brand-100"
                      >
                        {kw}
                      </span>
                    ))
                  )}
                </dd>
              </div>
            </dl>
          </div>

          {/* Stepper（生成中 / 完了 / エラー時のみ表示） */}
          {stage !== 'idle' && (
            <GenerationStepper
              stage={stage}
              startedAt={startedAt}
              errorMessage={stageError}
            />
          )}

          {/* 結果 */}
          {stage === 'done' && result && (
            <div
              className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm
                dark:border-emerald-900 dark:bg-emerald-950/40 sm:p-5"
            >
              <h2 className="text-sm font-semibold text-emerald-800 dark:text-emerald-100">
                生成結果
              </h2>
              {result.title && (
                <div>
                  <div className="text-xs font-medium text-emerald-700/80 dark:text-emerald-200/80">
                    タイトル
                  </div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-50">
                    {result.title}
                  </div>
                </div>
              )}
              {(result.meta_description || result.excerpt) && (
                <div>
                  <div className="text-xs font-medium text-emerald-700/80 dark:text-emerald-200/80">
                    抜粋
                  </div>
                  <p className="line-clamp-4 text-sm text-gray-700 dark:text-gray-200">
                    {result.meta_description ?? result.excerpt}
                  </p>
                </div>
              )}
              {resultArticleId ? (
                <Link
                  href={`/dashboard/articles/${resultArticleId}`}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2
                    text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700
                    focus:outline-none focus:ring-2 focus:ring-emerald-500/40
                    dark:bg-emerald-500 dark:hover:bg-emerald-400"
                >
                  記事ページへ
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <p className="text-xs text-emerald-700/80 dark:text-emerald-200/80">
                  記事 ID が返却されませんでした。記事一覧から該当記事を確認してください。
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
