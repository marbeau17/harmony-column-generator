'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import SourceArticlePicker from '@/components/articles/SourceArticlePicker';

// ─── Option definitions ─────────────────────────────────────────────────────

const THEME_CATEGORIES = [
  { value: 'soul_mission',     label: '魂と使命' },
  { value: 'relationships',    label: '人間関係' },
  { value: 'grief_care',       label: 'グリーフケア' },
  { value: 'self_growth',      label: '自己成長' },
  { value: 'healing',          label: '癒しと浄化' },
  { value: 'daily_awareness',  label: '日常の気づき' },
  { value: 'spiritual_intro',  label: 'スピリチュアル入門' },
] as const;

const PERSONA_TYPES = [
  { value: 'spiritual_beginner',    label: 'スピリチュアル初心者' },
  { value: 'self_growth_seeker',    label: '自己成長を求める人' },
  { value: 'grief_sufferer',        label: '喪失体験に苦しむ人' },
  { value: 'meditation_practitioner', label: '瞑想実践者' },
  { value: 'energy_worker',         label: 'エネルギーワーカー' },
  { value: 'life_purpose_seeker',   label: '人生の目的を探す人' },
  { value: 'holistic_health_seeker', label: 'ホリスティック健康志向の人' },
] as const;

const PERSPECTIVE_TYPES = [
  { value: 'experience_to_lesson',   label: '体験談 → 教訓' },
  { value: 'personal_to_universal',  label: '個人 → 普遍' },
  { value: 'concept_to_practice',    label: '概念 → 実践' },
  { value: 'case_to_work',           label: '事例 → ワーク' },
  { value: 'past_to_modern',         label: '過去 → 現代' },
  { value: 'deep_to_intro',          label: '深掘り → 入門' },
] as const;

// ─── Component ──────────────────────────────────────────────────────────────

export default function NewArticlePage() {
  const router = useRouter();

  // Form state
  const [theme, setTheme] = useState('');
  const [persona, setPersona] = useState('');
  const [keyword, setKeyword] = useState('');
  const [perspectiveType, setPerspectiveType] = useState('');
  const [targetWordCount, setTargetWordCount] = useState(2000);
  const [sourceArticleId, setSourceArticleId] = useState<string | null>(null);

  // Source article
  const [sourceArticleTitle, setSourceArticleTitle] = useState('');

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validation
    if (!theme) { setError('テーマカテゴリを選択してください'); return; }
    if (!persona) { setError('ターゲットペルソナを選択してください'); return; }
    if (!keyword.trim()) { setError('メインキーワードを入力してください'); return; }
    if (!perspectiveType) { setError('視点変換タイプを選択してください'); return; }

    setSubmitting(true);

    try {
      const res = await fetch('/api/ai/generate-outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme,
          targetPersona: persona,
          keyword: keyword.trim(),
          perspectiveType,
          targetWordCount,
          sourceArticleId: sourceArticleId ?? undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `アウトライン生成に失敗しました (${res.status})`);
      }

      const json = await res.json();
      const articleId = json.articleId ?? json.id;

      if (!articleId) {
        throw new Error('記事IDが取得できませんでした');
      }

      router.push(`/dashboard/articles/${articleId}/outline`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'アウトライン生成に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-brand-800">新規記事作成</h1>
        <p className="mt-1 text-sm text-brand-500">
          記事のテーマと方向性を設定して、AIにアウトラインを生成させます。
        </p>
      </div>

      {/* Form card */}
      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-xl border border-brand-200 bg-white p-6 shadow-sm"
      >
        {/* Theme category */}
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-brand-700">
            テーマカテゴリ <span className="text-red-500">*</span>
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {THEME_CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setTheme(cat.value)}
                className={`rounded-lg border px-3 py-2 text-sm transition
                  ${
                    theme === cat.value
                      ? 'border-brand-500 bg-brand-500 text-white'
                      : 'border-brand-200 bg-white text-brand-700 hover:border-brand-400 hover:bg-brand-50'
                  }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Persona */}
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-brand-700">
            ターゲットペルソナ <span className="text-red-500">*</span>
          </legend>
          <div className="space-y-2">
            {PERSONA_TYPES.map((p) => (
              <label
                key={p.value}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-2.5
                  text-sm transition
                  ${
                    persona === p.value
                      ? 'border-brand-500 bg-brand-50'
                      : 'border-brand-100 bg-white hover:border-brand-300'
                  }`}
              >
                <input
                  type="radio"
                  name="persona"
                  value={p.value}
                  checked={persona === p.value}
                  onChange={() => setPersona(p.value)}
                  className="h-4 w-4 accent-brand-500"
                />
                <span className="text-brand-700">{p.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Main keyword */}
        <div>
          <label
            htmlFor="keyword"
            className="mb-1 block text-sm font-medium text-brand-700"
          >
            メインキーワード <span className="text-red-500">*</span>
          </label>
          <input
            id="keyword"
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="例: チャクラ 瞑想 初心者"
            className="w-full rounded-lg border border-brand-200 px-4 py-2.5 text-sm
              transition focus:border-brand-500 focus:outline-none focus:ring-2
              focus:ring-brand-500/20"
          />
        </div>

        {/* Perspective type */}
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-brand-700">
            視点変換タイプ <span className="text-red-500">*</span>
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PERSPECTIVE_TYPES.map((pt) => (
              <button
                key={pt.value}
                type="button"
                onClick={() => setPerspectiveType(pt.value)}
                className={`rounded-lg border px-3 py-2 text-sm transition
                  ${
                    perspectiveType === pt.value
                      ? 'border-brand-500 bg-brand-500 text-white'
                      : 'border-brand-200 bg-white text-brand-700 hover:border-brand-400 hover:bg-brand-50'
                  }`}
              >
                {pt.label}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Target word count */}
        <div>
          <label
            htmlFor="wordCount"
            className="mb-1 block text-sm font-medium text-brand-700"
          >
            目標文字数: <span className="font-bold text-brand-800">{targetWordCount.toLocaleString()}</span> 文字
          </label>
          <input
            id="wordCount"
            type="range"
            min={500}
            max={5000}
            step={100}
            value={targetWordCount}
            onChange={(e) => setTargetWordCount(Number(e.target.value))}
            className="w-full accent-brand-500"
          />
          <div className="flex justify-between text-xs text-brand-400">
            <span>500</span>
            <span>5,000</span>
          </div>
        </div>

        {/* 元記事（オプション） */}
        <div>
          <label className="mb-2 block text-sm font-semibold text-brand-700">
            元記事（オプション）
          </label>
          <SourceArticlePicker
            selectedSource={sourceArticleId ? { id: sourceArticleId, title: sourceArticleTitle } : null}
            onSelect={(source) => {
              setSourceArticleId(source.id);
              setSourceArticleTitle(source.title);
            }}
            onClear={() => {
              setSourceArticleId(null);
              setSourceArticleTitle('');
            }}
            currentTheme={theme}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg
            bg-brand-500 px-6 py-3 text-sm font-medium text-white
            transition hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed
            focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          <Sparkles className="h-4 w-4" />
          {submitting ? 'アウトライン生成中...' : 'アウトライン生成'}
        </button>
      </form>
    </div>
  );
}
