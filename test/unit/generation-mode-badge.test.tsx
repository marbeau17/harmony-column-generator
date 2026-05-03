// @vitest-environment jsdom

/**
 * GenerationModeBadge 単体テスト (K5)
 * -----------------------------------
 * P5-55: ラベル文言刷新（新規作成 / 書き換え / 未設定）+ zero に
 *        「ハブ掲載」サブラベルを追加した仕様に合わせて pin を更新。
 *
 * - mode='zero'   → 「新規作成」+ ✨ + サブラベル「ハブ掲載」 + 紫系 class
 * - mode='source' → 「書き換え」+ 📚 + 水色 class
 * - mode=null     → 「未設定」+ ⚪ + グレー class
 * - size='sm'     → small classes (px-2 py-0.5 text-xs) 適用
 * - size='md'     → medium classes (px-3 py-1 text-sm) 適用
 * - showLabel=false → 可視ラベル非表示（sr-only のみ。zero ではサブラベルも sr-only に同梱）
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
  it("mode='zero' のとき「新規作成」+「ハブ掲載」が表示され、紫系 class と tooltip が付く", () => {
    render(<GenerationModeBadge mode="zero" />);
    const badge = screen.getByTestId('generation-mode-badge');

    expect(badge).toHaveTextContent('新規作成');
    expect(badge).toHaveTextContent('✨');
    // P5-55: サブラベル「ハブ掲載」が表示される
    expect(badge).toHaveTextContent('ハブ掲載');
    expect(
      screen.getByTestId('generation-mode-badge-sublabel'),
    ).toHaveTextContent('ハブ掲載');
    expect(badge).toHaveAttribute(
      'title',
      'ゼロから AI 生成された新規記事（ハブページ掲載対象）',
    );
    expect(badge).toHaveAttribute('data-mode', 'zero');
    // 紫系（violet）class が含まれる
    expect(badge.className).toContain('violet');
    // dark: 対応 class が含まれる（要件: dark: 必須）
    expect(badge.className).toContain('dark:');
  });

  it("mode='source' のとき「書き換え」が表示され、水色 class と tooltip が付く", () => {
    render(<GenerationModeBadge mode="source" />);
    const badge = screen.getByTestId('generation-mode-badge');

    expect(badge).toHaveTextContent('書き換え');
    expect(badge).toHaveTextContent('📚');
    expect(badge).toHaveAttribute(
      'title',
      '既存記事をベースに視点変換した書き換え記事',
    );
    expect(badge).toHaveAttribute('data-mode', 'source');
    // source にはサブラベルは付かない
    expect(
      screen.queryByTestId('generation-mode-badge-sublabel'),
    ).not.toBeInTheDocument();
    // 水色（sky）class が含まれる
    expect(badge.className).toContain('sky');
    expect(badge.className).toContain('dark:');
  });

  it('mode=null のとき「未設定」が表示され、グレー class が付く', () => {
    render(<GenerationModeBadge mode={null} />);
    const badge = screen.getByTestId('generation-mode-badge');

    expect(badge).toHaveTextContent('未設定');
    expect(badge).toHaveTextContent('⚪');
    expect(badge).toHaveAttribute('data-mode', 'unknown');
    expect(badge.className).toContain('gray');
    expect(badge.className).toContain('dark:');
  });

  it('mode=undefined のとき「未設定」表示にフォールバックする', () => {
    render(<GenerationModeBadge mode={undefined} />);
    const badge = screen.getByTestId('generation-mode-badge');
    expect(badge).toHaveTextContent('未設定');
    expect(badge).toHaveAttribute('data-mode', 'unknown');
  });

  it('未知の mode 文字列でも「未設定」表示にフォールバックする', () => {
    render(<GenerationModeBadge mode="something-else" />);
    const badge = screen.getByTestId('generation-mode-badge');
    expect(badge).toHaveTextContent('未設定');
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

    // 可視ラベル要素・サブラベル要素は存在しない
    expect(
      screen.queryByTestId('generation-mode-badge-label'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('generation-mode-badge-sublabel'),
    ).not.toBeInTheDocument();

    // ただしアイコンは表示される
    expect(badge).toHaveTextContent('✨');

    // sr-only のラベルは含まれている（screen reader 向け）
    // P5-55: zero ではサブラベル「ハブ掲載」も sr-only に同梱
    const srOnly = badge.querySelector('.sr-only');
    expect(srOnly).not.toBeNull();
    expect(srOnly?.textContent).toBe('新規作成（ハブ掲載）');
  });

  it('showLabel=true（デフォルト）のとき可視ラベルが表示される', () => {
    render(<GenerationModeBadge mode="source" />);
    expect(screen.getByTestId('generation-mode-badge-label')).toHaveTextContent(
      '書き換え',
    );
  });
});
