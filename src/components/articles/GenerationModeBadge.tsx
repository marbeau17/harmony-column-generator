/**
 * GenerationModeBadge — 記事の生成モードを視覚的に示すバッジ
 * --------------------------------------------------------------
 * P5-55: ユーザ要件「新規作成 vs 書き換え わかるように」を反映し、
 *        ラベル文言・アイコンを刷新。zero 記事はハブ掲載対象なので
 *        サブラベル「ハブ掲載」を併記して用途を直感化する。
 *
 *   - mode='zero'   → 紫系  + ✨ + 「新規作成」 + サブラベル「ハブ掲載」
 *   - mode='source' → 水色  + 📚 + 「書き換え」
 *   - その他/null   → グレー + ⚪ + 「未設定」
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
  /** P5-55: zero モードのみ「ハブ掲載」サブラベルを併記 */
  sublabel?: string;
  tooltip: string;
  /** 背景・文字・ボーダー（light/dark 両対応） */
  colorClasses: string;
  /** P5-55: サブラベル用の控えめな配色（バリアント色に同調） */
  sublabelClasses?: string;
};

/**
 * mode 値からバリアント定義を解決する。未知値・null・undefined は "unknown" に倒す。
 */
function resolveVariant(mode: string | null | undefined): BadgeVariant {
  if (mode === 'zero') {
    // P5-55: 「新規作成」+ ハブ掲載サブラベル（紫系統一）
    return {
      icon: '✨',
      label: '新規作成',
      sublabel: 'ハブ掲載',
      tooltip: 'ゼロから AI 生成された新規記事（ハブページ掲載対象）',
      colorClasses:
        'bg-violet-100 text-violet-800 border border-violet-200 ' +
        'dark:bg-violet-900/40 dark:text-violet-200 dark:border-violet-700',
      sublabelClasses:
        'bg-violet-200/70 text-violet-900 ' +
        'dark:bg-violet-800/60 dark:text-violet-100',
    };
  }
  if (mode === 'source') {
    // P5-55: 「リライト」→「書き換え」へ平易化
    return {
      icon: '📚',
      label: '書き換え',
      tooltip: '既存記事をベースに視点変換した書き換え記事',
      colorClasses:
        'bg-sky-100 text-sky-800 border border-sky-200 ' +
        'dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-700',
    };
  }
  // P5-55: 未知 / null / undefined は「未設定」+ ⚪ アイコン（グレー）
  return {
    icon: '⚪',
    label: '未設定',
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

/**
 * P5-55: サブラベル（例: 「ハブ掲載」）の padding / font-size を size に応じて返す。
 */
function resolveSublabelSizeClasses(size: 'sm' | 'md'): string {
  if (size === 'sm') {
    return 'ml-1 px-1.5 py-0 text-[10px]';
  }
  return 'ml-1.5 px-2 py-0 text-xs';
}

export default function GenerationModeBadge(
  props: GenerationModeBadgeProps,
): JSX.Element {
  const { mode, size = 'md', showLabel = true } = props;
  const variant = resolveVariant(mode);
  const sizeClasses = resolveSizeClasses(size);
  // P5-55: サブラベル表示は showLabel=true かつ variant.sublabel が定義されている場合のみ
  const sublabelSizeClasses = resolveSublabelSizeClasses(size);

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
        <>
          <span data-testid="generation-mode-badge-label">{variant.label}</span>
          {variant.sublabel ? (
            <span
              data-testid="generation-mode-badge-sublabel"
              className={
                'inline-flex items-center rounded-full font-semibold ' +
                sublabelSizeClasses +
                ' ' +
                (variant.sublabelClasses ?? '')
              }
            >
              {variant.sublabel}
            </span>
          ) : null}
        </>
      ) : (
        // showLabel=false 時はスクリーンリーダ向けに不可視テキストを残す
        <span className="sr-only">
          {variant.label}
          {variant.sublabel ? `（${variant.sublabel}）` : ''}
        </span>
      )}
    </span>
  );
}
