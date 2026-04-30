'use client';

/**
 * DiffViewer
 * - 旧 (before) / 新 (after) を 2 カラムで横並び表示するシンプルな diff ビューア
 * - 行単位の差分: 削除行 = 左カラムを赤系、追加行 = 右カラムを緑系で着色
 * - 「採用」ボタンで onAccept、「却下」ボタンで onReject を呼び出す
 * - 注意: 表示専用。本コンポーネントは記事本文に書き込みを行わない
 */

import { useMemo } from 'react';

interface Props {
  before: string;
  after: string;
  onAccept: () => void;
  onReject: () => void;
}

type LineOp = 'equal' | 'delete' | 'insert';

interface DiffRow {
  left?: { text: string; op: LineOp };
  right?: { text: string; op: LineOp };
}

/**
 * 行単位 LCS による簡易 diff
 * - HTML/プレーン文字列いずれも改行で行分割し比較する
 * - 大規模文書向けではないが、章/文サイズの差分には十分
 */
function diffLines(beforeText: string, afterText: string): DiffRow[] {
  const a = beforeText.split('\n');
  const b = afterText.split('\n');
  const n = a.length;
  const m = b.length;

  // LCS テーブル
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // バックトレースして差分行を生成
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({
        left: { text: a[i], op: 'equal' },
        right: { text: b[j], op: 'equal' },
      });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ left: { text: a[i], op: 'delete' } });
      i++;
    } else {
      rows.push({ right: { text: b[j], op: 'insert' } });
      j++;
    }
  }
  while (i < n) {
    rows.push({ left: { text: a[i], op: 'delete' } });
    i++;
  }
  while (j < m) {
    rows.push({ right: { text: b[j], op: 'insert' } });
    j++;
  }
  return rows;
}

function cellClass(op: LineOp | undefined): string {
  if (op === 'delete') {
    return 'bg-red-50 text-red-900 dark:bg-red-900/30 dark:text-red-100';
  }
  if (op === 'insert') {
    return 'bg-emerald-50 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100';
  }
  return 'bg-white text-stone-800 dark:bg-stone-900 dark:text-stone-200';
}

function Marker({ op }: { op: LineOp | undefined }) {
  if (op === 'delete') {
    return (
      <span aria-hidden className="select-none text-red-600 dark:text-red-300">
        −
      </span>
    );
  }
  if (op === 'insert') {
    return (
      <span aria-hidden className="select-none text-emerald-600 dark:text-emerald-300">
        +
      </span>
    );
  }
  return (
    <span aria-hidden className="select-none text-stone-400 dark:text-stone-500">

    </span>
  );
}

export default function DiffViewer({ before, after, onAccept, onReject }: Props) {
  const rows = useMemo(() => diffLines(before, after), [before, after]);
  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const r of rows) {
      if (r.left?.op === 'delete') removed++;
      if (r.right?.op === 'insert') added++;
    }
    return { added, removed };
  }, [rows]);

  return (
    <div className="rounded-lg border border-stone-200 bg-white shadow-sm dark:border-stone-700 dark:bg-stone-900">
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2 dark:border-stone-700">
        <div className="flex items-center gap-3 text-xs">
          <span className="font-medium text-stone-700 dark:text-stone-200">変更プレビュー</span>
          <span className="text-emerald-700 dark:text-emerald-300">+{stats.added}</span>
          <span className="text-red-700 dark:text-red-300">−{stats.removed}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReject}
            className="rounded-md border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-stone-700 transition hover:bg-stone-100 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
          >
            却下
          </button>
          <button
            type="button"
            onClick={onAccept}
            className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100 dark:hover:bg-emerald-900/60"
          >
            採用
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-stone-200 text-xs dark:divide-stone-700">
        <div className="bg-stone-50 px-3 py-1 font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
          旧 (before)
        </div>
        <div className="bg-stone-50 px-3 py-1 font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
          新 (after)
        </div>
      </div>

      <div className="max-h-[60vh] overflow-auto font-mono text-xs leading-5">
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-stone-500 dark:text-stone-400">
            差分はありません
          </div>
        ) : (
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {rows.map((row, idx) => (
              <li key={idx} className="grid grid-cols-2 divide-x divide-stone-200 dark:divide-stone-700">
                <div className={`flex gap-2 px-3 py-1 ${cellClass(row.left?.op)}`}>
                  <Marker op={row.left?.op} />
                  <span className="whitespace-pre-wrap break-all">{row.left?.text ?? ''}</span>
                </div>
                <div className={`flex gap-2 px-3 py-1 ${cellClass(row.right?.op)}`}>
                  <Marker op={row.right?.op} />
                  <span className="whitespace-pre-wrap break-all">{row.right?.text ?? ''}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
