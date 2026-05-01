// @vitest-environment jsdom

/**
 * GenerationModeBadge 単体テスト (K5)
 * -----------------------------------
 * - mode='zero'   → 「ゼロ生成」表示 + 紫系 class
 * - mode='source' → 「リライト」表示 + 水色 class
 * - mode=null     → 「不明」表示 + グレー class
 * - size='sm'     → small classes (px-2 py-0.5 text-xs) 適用
 * - size='md'     → medium classes (px-3 py-1 text-sm) 適用
 * - showLabel=false → 可視ラベル非表示（sr-only のみ）
 * - title 属性に tooltip 文言が入る（dark: クラス含むことも確認）
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import GenerationModeBadge from '@/components/articles/GenerationModeBadge';

afterEach(() => {
  cleanup();
});

describe('GenerationModeBadge', () => {
  it("mode='zero' のとき「ゼロ生成」が表示され、紫系 class と tooltip が付く", () => {
    render(<GenerationModeBadge mode="zero" />);
    const badge = screen.getByTestId('generation-mode-badge');

    expect(badge).toHaveTextContent('ゼロ生成');
    expect(badge).toHaveTextContent('✨');
    expect(badge).toHaveAttribute('title', 'ゼロから AI 生成された記事');
    expect(badge).toHaveAttribute('data-mode', 'zero');
    // 紫系（violet）class が含まれる
    expect(badge.className).toContain('violet');
    // dark: 対応 class が含まれる（要件: dark: 必須）
    expect(badge.className).toContain('dark:');
  });

  it("mode='source' のとき「リライト」が表示され、水色 class と tooltip が付く", () => {
    render(<GenerationModeBadge mode="source" />);
    const badge = screen.getByTestId('generation-mode-badge');

    expect(badge).toHaveTextContent('リライト');
    expect(badge).toHaveTextContent('📚');
    expect(badge).toHaveAttribute('title', '既存記事をベースに翻案された記事');
    expect(badge).toHaveAttribute('data-mode', 'source');
    // 水色（sky）class が含まれる
    expect(badge.className).toContain('sky');
    expect(badge.className).toContain('dark:');
  });

  it('mode=null のとき「不明」が表示され、グレー class が付く', () => {
    render(<GenerationModeBadge mode={null} />);
    const badge = screen.getByTestId('generation-mode-badge');

    expect(badge).toHaveTextContent('不明');
    expect(badge).toHaveTextContent('❓');
    expect(badge).toHaveAttribute('data-mode', 'unknown');
    expect(badge.className).toContain('gray');
    expect(badge.className).toContain('dark:');
  });

  it('mode=undefined のとき「不明」表示にフォールバックする', () => {
    render(<GenerationModeBadge mode={undefined} />);
    const badge = screen.getByTestId('generation-mode-badge');
    expect(badge).toHaveTextContent('不明');
    expect(badge).toHaveAttribute('data-mode', 'unknown');
  });

  it('未知の mode 文字列でも「不明」表示にフォールバックする', () => {
    render(<GenerationModeBadge mode="something-else" />);
    const badge = screen.getByTestId('generation-mode-badge');
    expect(badge).toHaveTextContent('不明');
  });

  it("size='sm' のとき small classes (px-2 py-0.5 text-xs) が適用される", () => {
    render(<GenerationModeBadge mode="zero" size="sm" />);
    const badge = screen.getByTestId('generation-mode-badge');
    expect(badge.className).toContain('px-2');
    expect(badge.className).toContain('py-0.5');
    expect(badge.className).toContain('text-xs');
    // md の class は付かない
    expect(badge.className).not.toContain('px-3');
    expect(badge.className).not.toContain('text-sm');
  });

  it("size='md'（デフォルト）のとき medium classes (px-3 py-1 text-sm) が適用される", () => {
    render(<GenerationModeBadge mode="zero" />);
    const badge = screen.getByTestId('generation-mode-badge');
    expect(badge.className).toContain('px-3');
    expect(badge.className).toContain('py-1');
    expect(badge.className).toContain('text-sm');
  });

  it('showLabel=false のとき可視ラベルが隠れる（sr-only のみ）', () => {
    render(<GenerationModeBadge mode="zero" showLabel={false} />);
    const badge = screen.getByTestId('generation-mode-badge');

    // 可視ラベル要素（data-testid="generation-mode-badge-label"）は存在しない
    expect(
      screen.queryByTestId('generation-mode-badge-label'),
    ).not.toBeInTheDocument();

    // ただしアイコンは表示される
    expect(badge).toHaveTextContent('✨');

    // sr-only のラベルは含まれている（screen reader 向け）
    const srOnly = badge.querySelector('.sr-only');
    expect(srOnly).not.toBeNull();
    expect(srOnly?.textContent).toBe('ゼロ生成');
  });

  it('showLabel=true（デフォルト）のとき可視ラベルが表示される', () => {
    render(<GenerationModeBadge mode="source" />);
    expect(screen.getByTestId('generation-mode-badge-label')).toHaveTextContent(
      'リライト',
    );
  });
});
