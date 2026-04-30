'use client';

/**
 * RegenerationControls
 * - 文 / 章 / 全体 の3段階で記事再生成をトリガーする UI コンポーネント
 * - POST /api/articles/[id]/regenerate-segment にスコープ別ペイロードを送信
 * - 注意: 対象 API ルートは本タスク範囲外（次サイクル）。UI のみを準備する
 */

import { useState } from 'react';
import toast from 'react-hot-toast';

export type RegenerationScope = 'sentence' | 'chapter' | 'full';

interface Props {
  articleId: string;
  selectedSentenceIdx?: number;
  selectedChapterIdx?: number;
  onRegenerated?: () => void;
}

interface RegeneratePayload {
  scope: RegenerationScope;
  target_idx?: number;
}

interface RegenerateResponse {
  ok?: boolean;
  error?: string;
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:opacity-60 disabled:cursor-wait';

const VARIANT = {
  sentence:
    'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100 dark:bg-sky-900/30 dark:text-sky-100 dark:border-sky-700 dark:hover:bg-sky-900/50',
  chapter:
    'bg-indigo-50 text-indigo-800 border-indigo-200 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-100 dark:border-indigo-700 dark:hover:bg-indigo-900/50',
  full:
    'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-100 dark:border-amber-700 dark:hover:bg-amber-900/50',
} as const;

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export default function RegenerationControls({
  articleId,
  selectedSentenceIdx,
  selectedChapterIdx,
  onRegenerated,
}: Props) {
  const [busyScope, setBusyScope] = useState<RegenerationScope | null>(null);

  const sentenceDisabled = busyScope !== null || typeof selectedSentenceIdx !== 'number';
  const chapterDisabled = busyScope !== null || typeof selectedChapterIdx !== 'number';
  const fullDisabled = busyScope !== null;

  async function trigger(scope: RegenerationScope, targetIdx?: number) {
    if (scope === 'full') {
      const ok = window.confirm(
        '記事全体を再生成します。現在の本文は履歴に保存されますが、生成内容は変わります。よろしいですか？',
      );
      if (!ok) return;
    }

    setBusyScope(scope);
    const payload: RegeneratePayload = { scope };
    if (typeof targetIdx === 'number') payload.target_idx = targetIdx;

    try {
      const res = await fetch(`/api/articles/${articleId}/regenerate-segment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as RegenerateResponse;
      if (!res.ok) {
        toast.error(`再生成に失敗しました: ${json.error ?? res.status}`);
        return;
      }
      const label =
        scope === 'sentence' ? '選択した文' : scope === 'chapter' ? '選択した章' : '記事全体';
      toast.success(`${label}を再生成しました`);
      onRegenerated?.();
    } catch (err) {
      toast.error(`通信エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyScope(null);
    }
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white/60 p-2 dark:border-stone-700 dark:bg-stone-900/60"
      role="group"
      aria-label="再生成コントロール"
    >
      <button
        type="button"
        onClick={() => trigger('sentence', selectedSentenceIdx)}
        disabled={sentenceDisabled}
        title={
          typeof selectedSentenceIdx === 'number'
            ? `文 #${selectedSentenceIdx} を再生成`
            : '対象の文を選択してください'
        }
        className={`${BUTTON_BASE} ${VARIANT.sentence}`}
      >
        {busyScope === 'sentence' ? <Spinner /> : <span aria-hidden>✎</span>}
        文だけ再生成
      </button>

      <button
        type="button"
        onClick={() => trigger('chapter', selectedChapterIdx)}
        disabled={chapterDisabled}
        title={
          typeof selectedChapterIdx === 'number'
            ? `章 #${selectedChapterIdx} を再生成`
            : '対象の章を選択してください'
        }
        className={`${BUTTON_BASE} ${VARIANT.chapter}`}
      >
        {busyScope === 'chapter' ? <Spinner /> : <span aria-hidden>§</span>}
        章だけ再生成
      </button>

      <button
        type="button"
        onClick={() => trigger('full')}
        disabled={fullDisabled}
        className={`${BUTTON_BASE} ${VARIANT.full}`}
      >
        {busyScope === 'full' ? <Spinner /> : <span aria-hidden>⟳</span>}
        全体再生成
      </button>
    </div>
  );
}
