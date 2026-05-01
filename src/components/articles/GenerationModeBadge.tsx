/**
 * GenerationModeBadge — 記事の生成モードを視覚的に示すバッジ
 * --------------------------------------------------------------
 * ユーザ要件「rewrite or created newly from scratch or not」を
 * 一目で識別できるよう、3 パターンのバッジ表示を提供する共通コンポーネント。
 *
 *   - mode='zero'   → 紫系 + ✨ アイコン + 「ゼロ生成」（新規作成）
 *   - mode='source' → 水色 + 📚 アイコン + 「リライト」（既存記事翻案）
 *   - その他/null   → グレー + ❓ アイコン + 「不明」
 *
 * Tailwind の `dark:` バリアントでダークモード対応済み。
 * `size` で 'sm' / 'md' を切替、`showLabel=false` でアイコンのみ表示が可能。
 *
 * Props:
 *   mode      : 'zero' | 'source' | string | null | undefined
 *   size      : 'sm' | 'md'  (default: 'md')
 *   showLabel : boolean      (default: true)
 */

import * as React from 'react';

export type GenerationModeBadgeProps = {
  mode: string | null | undefined;
  size?: 'sm' | 'md';
  showLabel?: boolean;
};

type BadgeVariant = {
  icon: string;
  label: string;
  tooltip: string;
  /** 背景・文字・ボーダー（light/dark 両対応） */
  colorClasses: string;
};

/**
 * mode 値からバリアント定義を解決する。未知値・null・undefined は "unknown" に倒す。
 */
function resolveVariant(mode: string | null | undefined): BadgeVariant {
  if (mode === 'zero') {
    return {
      icon: '✨',
      label: 'ゼロ生成',
      tooltip: 'ゼロから AI 生成された記事',
      colorClasses:
        'bg-violet-100 text-violet-800 border border-violet-200 ' +
        'dark:bg-violet-900/40 dark:text-violet-200 dark:border-violet-700',
    };
  }
  if (mode === 'source') {
    return {
      icon: '📚',
      label: 'リライト',
      tooltip: '既存記事をベースに翻案された記事',
      colorClasses:
        'bg-sky-100 text-sky-800 border border-sky-200 ' +
        'dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-700',
    };
  }
  return {
    icon: '❓',
    label: '不明',
    tooltip: '生成モードが特定できない記事',
    colorClasses:
      'bg-gray-100 text-gray-700 border border-gray-200 ' +
      'dark:bg-gray-800/60 dark:text-gray-300 dark:border-gray-700',
  };
}

/**
 * size 値から padding / フォント Tailwind class を解決する。
 */
function resolveSizeClasses(size: 'sm' | 'md'): string {
  if (size === 'sm') {
    return 'px-2 py-0.5 text-xs';
  }
  return 'px-3 py-1 text-sm';
}

export default function GenerationModeBadge(
  props: GenerationModeBadgeProps,
): JSX.Element {
  const { mode, size = 'md', showLabel = true } = props;
  const variant = resolveVariant(mode);
  const sizeClasses = resolveSizeClasses(size);

  return (
    <span
      role="status"
      title={variant.tooltip}
      data-mode={mode ?? 'unknown'}
      data-testid="generation-mode-badge"
      className={
        'inline-flex items-center gap-1 rounded-full font-medium ' +
        'whitespace-nowrap select-none ' +
        sizeClasses +
        ' ' +
        variant.colorClasses
      }
    >
      <span aria-hidden="true">{variant.icon}</span>
      {showLabel ? (
        <span data-testid="generation-mode-badge-label">{variant.label}</span>
      ) : (
        // showLabel=false 時はスクリーンリーダ向けに不可視テキストを残す
        <span className="sr-only">{variant.label}</span>
      )}
    </span>
  );
}
