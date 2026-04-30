'use client';

/**
 * BatchHideButton
 * ----------------
 * 既存ソース記事を一括で非表示にするための UI コンポーネント。
 *
 * - ソフト撤回方式（noindex 化のみ。FTP の個別 HTML は削除しない）
 * - 誤実行防止のため確認文字列「HIDE_ALL_SOURCE」入力を必須とする
 * - dry-run で対象件数を事前確認可能
 *
 * バックエンド: POST /api/articles/batch-hide-source
 *   request:  { confirm: 'HIDE_ALL_SOURCE', dry_run?: boolean }
 *   response: { hidden: number, ids: string[], hub_rebuild_status: string }
 */

import { useState } from 'react';
import { EyeOff } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BatchHideResult {
  hidden: number;
  ids: string[];
  hub_rebuild_status: string;
  /** dry_run 時のみ true */
  dry_run?: boolean;
  /** バックエンドが追加メッセージを返すケースに備えた任意フィールド */
  message?: string;
  error?: string;
}

interface Props {
  /** 一覧側で集計した「公開中の既存ソース記事」候補数。モーダル本文の N に表示 */
  candidatesCount?: number;
  /** API 完了後のコールバック（一覧再フェッチ等に利用） */
  onCompleted?: (result: BatchHideResult) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function BatchHideButton({ candidatesCount, onCompleted }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyMode, setBusyMode] = useState<'dry' | 'real' | null>(null);
  const [result, setResult] = useState<BatchHideResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const confirmed = confirmText.trim() === 'HIDE_ALL_SOURCE';

  // モーダルを閉じて状態リセット
  const handleClose = () => {
    if (busy) return;
    setOpen(false);
    setConfirmText('');
    setResult(null);
    setErrorMsg(null);
  };

  // API 呼び出し（dry_run / real 共通）
  const callApi = async (dry: boolean) => {
    setBusy(true);
    setBusyMode(dry ? 'dry' : 'real');
    setErrorMsg(null);
    try {
      const res = await fetch('/api/articles/batch-hide-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirm: 'HIDE_ALL_SOURCE',
          ...(dry ? { dry_run: true } : {}),
        }),
      });

      const json = (await res.json().catch(() => ({}))) as Partial<BatchHideResult>;

      if (!res.ok) {
        setErrorMsg(json.error || `HTTP ${res.status}`);
        return;
      }

      const r: BatchHideResult = {
        hidden: json.hidden ?? 0,
        ids: json.ids ?? [],
        hub_rebuild_status: json.hub_rebuild_status ?? 'unknown',
        dry_run: dry || json.dry_run,
        message: json.message,
      };
      setResult(r);
      // 本実行のときのみ親に通知（dry-run は確認用なので通知しない）
      if (!dry) {
        onCompleted?.(r);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setBusyMode(null);
    }
  };

  return (
    <>
      {/* トリガーボタン（ツールバー内） */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-400
          bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700 transition
          hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500/20
          disabled:opacity-50 disabled:cursor-not-allowed
          dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50
          sm:w-auto sm:justify-start"
        aria-haspopup="dialog"
      >
        <EyeOff className="h-4 w-4" />
        既存ソースを一括非表示
        {typeof candidatesCount === 'number' && candidatesCount > 0 && (
          <span
            className="ml-1 inline-flex items-center justify-center rounded-full
              bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900
              dark:bg-amber-700 dark:text-amber-50"
          >
            {candidatesCount}
          </span>
        )}
      </button>

      {/* 確認モーダル */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="batch-hide-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 dark:bg-black/60"
          onClick={handleClose}
        >
          <div
            className="w-full max-w-lg rounded-xl border border-brand-200 bg-white p-6 shadow-xl
              dark:border-stone-700 dark:bg-stone-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="batch-hide-title"
              className="text-lg font-bold text-brand-800 dark:text-stone-100"
            >
              既存記事を一括非表示にしますか？
            </h2>

            <p className="mt-3 text-sm leading-relaxed text-brand-700 dark:text-stone-300">
              現在公開中の{' '}
              <span className="font-semibold text-amber-700 dark:text-amber-300 tabular-nums">
                {candidatesCount ?? '?'}
              </span>{' '}
              件の既存ソース記事を一括で非表示にします（ソフト撤回方式、FTP
              の個別記事は noindex 化、削除はしません）。
            </p>

            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-brand-500 dark:text-stone-400">
              <li>個別 HTML ファイルは残ります（履歴・キャッシュ保護のため削除しません）</li>
              <li>ハブページ一覧から外れ、検索エンジンには noindex として通知されます</li>
              <li>本実行前に「dry-run で確認」で対象件数を確認してください</li>
            </ul>

            {/* 確認文字列入力 */}
            <label className="mt-4 block text-sm font-medium text-brand-700 dark:text-stone-200">
              確認のため、下のボックスに{' '}
              <code className="rounded bg-brand-100 px-1.5 py-0.5 font-mono text-xs text-brand-800 dark:bg-stone-800 dark:text-stone-100">
                HIDE_ALL_SOURCE
              </code>{' '}
              と入力してください
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={busy}
              placeholder="HIDE_ALL_SOURCE"
              className="mt-2 w-full rounded-lg border border-brand-300 bg-white px-3 py-2
                font-mono text-sm text-brand-800 transition
                focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20
                disabled:opacity-60
                dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100"
              autoComplete="off"
              spellCheck={false}
            />

            {/* 結果 / エラー表示 */}
            {errorMsg && (
              <div
                className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700
                  dark:border-red-800 dark:bg-red-900/30 dark:text-red-200"
                role="alert"
              >
                エラー: {errorMsg}
              </div>
            )}

            {result && !errorMsg && (
              <div
                className={`mt-4 rounded-lg border px-3 py-2 text-sm
                  ${
                    result.dry_run
                      ? 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-100'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-100'
                  }`}
              >
                <div className="font-semibold">
                  {result.dry_run ? '[dry-run] 対象件数を確認しました' : '一括非表示を実行しました'}
                </div>
                <div className="mt-1 space-y-0.5 text-xs tabular-nums">
                  <div>hidden: {result.hidden}</div>
                  <div>
                    ids: {result.ids.length > 0 ? result.ids.slice(0, 5).join(', ') : '—'}
                    {result.ids.length > 5 && ` … (+${result.ids.length - 5})`}
                  </div>
                  <div>hub_rebuild_status: {result.hub_rebuild_status}</div>
                  {result.message && <div>message: {result.message}</div>}
                </div>
              </div>
            )}

            {/* アクション */}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={handleClose}
                disabled={busy}
                className="rounded-lg border border-brand-300 bg-white px-4 py-2 text-sm font-medium
                  text-brand-700 transition hover:bg-brand-50
                  disabled:opacity-50 disabled:cursor-not-allowed
                  dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => callApi(true)}
                disabled={!confirmed || busy}
                className="rounded-lg border border-sky-400 bg-sky-50 px-4 py-2 text-sm font-medium
                  text-sky-700 transition hover:bg-sky-100
                  disabled:opacity-50 disabled:cursor-not-allowed
                  dark:border-sky-600 dark:bg-sky-900/30 dark:text-sky-200 dark:hover:bg-sky-900/50"
              >
                {busyMode === 'dry' ? '確認中…' : 'dry-run で確認'}
              </button>
              <button
                type="button"
                onClick={() => callApi(false)}
                disabled={!confirmed || busy}
                className="rounded-lg border border-amber-500 bg-amber-500 px-4 py-2 text-sm font-medium
                  text-white transition hover:bg-amber-600
                  disabled:opacity-50 disabled:cursor-not-allowed
                  dark:border-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700"
              >
                {busyMode === 'real' ? '実行中…' : '実行'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
