'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';

export type PublishButtonState = 'live' | 'hidden' | 'deploying' | 'hub_stale' | 'failed';

interface Props {
  articleId: string;
  articleTitle: string;
  initialState: PublishButtonState;
  onChanged?: (next: PublishButtonState) => void;
}

// Tailwind クラス定義（dark mode 対応）
const LABEL: Record<PublishButtonState, { icon: string; text: string; cls: string }> = {
  live: {
    icon: '●',
    text: '公開中',
    cls: 'bg-emerald-50 text-emerald-900 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-700',
  },
  hidden: {
    icon: '○',
    text: '非公開',
    // 小林ブランド色（cream + primary）を維持しつつ dark 時は stone 系で視認性確保
    cls: 'bg-brand-50 text-brand-700 border-brand-500 dark:bg-stone-800 dark:text-stone-200 dark:border-stone-600',
  },
  deploying: {
    icon: '⟳',
    text: '更新中…',
    cls: 'bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-700',
  },
  hub_stale: {
    icon: '⚠',
    text: 'ハブ同期待ち',
    cls: 'bg-orange-50 text-orange-900 border-orange-300 dark:bg-orange-900/40 dark:text-orange-100 dark:border-orange-700',
  },
  failed: {
    icon: '⚠',
    text: '失敗',
    cls: 'bg-red-50 text-red-900 border-red-300 dark:bg-red-900/40 dark:text-red-100 dark:border-red-700',
  },
};

// P5-39: Crockford's base32 (I/L/O/U 除外) で 26 文字 ULID を生成。
// バックエンド検証 isValidRequestId は /^[0-9A-HJKMNP-TV-Z]{26}$/i なので、
// タイムスタンプ部も同じ alphabet でエンコードしないと 400 を返してしまう。
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function encodeCrockford(num: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    s = CROCKFORD[num % 32] + s;
    num = Math.floor(num / 32);
  }
  return s;
}
function ulid(): string {
  const t = encodeCrockford(Date.now(), 10);
  const r = Array.from({ length: 16 }, () =>
    CROCKFORD.charAt(Math.floor(Math.random() * 32)),
  ).join('');
  return (t + r).slice(0, 26);
}

export default function PublishButton({ articleId, articleTitle, initialState, onChanged }: Props) {
  const [state, setState] = useState<PublishButtonState>(initialState);
  const [busy, setBusy] = useState(false);

  const visible = state === 'live' || state === 'hub_stale';
  const target = !visible;
  const ctaLabel = target ? '公開する' : '非公開にする';
  const danger = !target;

  async function doToggle() {
    const confirmMsg = target
      ? `「${articleTitle}」をハブページに公開します。よろしいですか？`
      : `「${articleTitle}」をハブページから非表示にします。関連記事のブロックも更新されます。よろしいですか？`;
    if (!window.confirm(confirmMsg)) return;

    setBusy(true);
    setState('deploying');
    try {
      const res = await fetch(`/api/articles/${articleId}/visibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visible: target, requestId: ulid() }),
      });
      const json = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
      if (!res.ok && res.status !== 207) {
        setState('failed');
        toast.error(`公開状態の更新に失敗しました: ${json.error ?? res.status}`);
        return;
      }
      const next: PublishButtonState = res.status === 207 ? 'hub_stale' : target ? 'live' : 'hidden';
      setState(next);
      onChanged?.(next);
      if (next === 'hub_stale') {
        toast(`公開状態は更新されましたがハブ再生成が遅延しています`, { icon: '⚠️' });
      } else {
        toast.success(target ? `${articleTitle} を公開しました` : `${articleTitle} を非表示にしました`);
      }
    } catch (err) {
      setState('failed');
      toast.error(`通信エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const style = LABEL[state];
  return (
    <div className="flex items-center gap-2">
      <span
        aria-label={`現在の状態: ${style.text}`}
        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium tabular-nums ${style.cls}`}
      >
        <span aria-hidden className={state === 'deploying' ? 'animate-spin inline-block' : 'inline-block'}>
          {style.icon}
        </span>
        {style.text}
      </span>
      <button
        type="button"
        onClick={doToggle}
        disabled={busy}
        className={`rounded-md px-3 py-1 text-xs font-medium transition border disabled:opacity-60 disabled:cursor-wait ${
          danger
            ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-100 dark:border-red-700 dark:hover:bg-red-900/50'
            : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-100 dark:border-emerald-700 dark:hover:bg-emerald-900/50'
        }`}
      >
        {busy ? '処理中…' : ctaLabel}
      </button>
    </div>
  );
}
