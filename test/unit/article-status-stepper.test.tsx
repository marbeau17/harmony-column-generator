// @vitest-environment jsdom

/**
 * ArticleStatusStepper 単体テスト
 * ----------------------------------
 * - generationMode='zero' → zero-gen 4 段階表示
 *   - hasStage2 / imageCount / hasStage3 / status の組合せに応じて
 *     各 stage の done フラグ (data-stage-done) が正しく付くこと
 *   - status='published' のとき published stage が done になる
 *   - status='body_generating' のとき finalized stage は done にならない
 * - generationMode='source' / null → legacy 7 段階タイムライン表示
 *   - 各 status 値で current より前の stage が done になる
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import ArticleStatusStepper from '@/components/articles/ArticleStatusStepper';

afterEach(() => {
  cleanup();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function getZeroStage(key: string): HTMLElement {
  const root = screen.getByTestId('article-status-stepper-zero');
  const stage = root.querySelector<HTMLElement>(`[data-stage-key="${key}"]`);
  if (!stage) throw new Error(`zero stage not found: ${key}`);
  return stage;
}

function getLegacyStage(key: string): HTMLElement {
  const root = screen.getByTestId('article-status-stepper-legacy');
  const stage = root.querySelector<HTMLElement>(`[data-stage-key="${key}"]`);
  if (!stage) throw new Error(`legacy stage not found: ${key}`);
  return stage;
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('ArticleStatusStepper - zero mode', () => {
  it('生成直後 (Stage2 未生成) は draft のみ done、他はすべて未完了', () => {
    render(
      <ArticleStatusStepper
        status="draft"
        generationMode="zero"
        hasStage2={false}
        hasStage3={false}
        imageCount={0}
      />,
    );

    expect(screen.getByTestId('article-status-stepper-zero')).toBeInTheDocument();
    expect(getZeroStage('draft')).toHaveAttribute('data-stage-done', 'true');
    expect(getZeroStage('generated')).toHaveAttribute('data-stage-done', 'false');
    expect(getZeroStage('images')).toHaveAttribute('data-stage-done', 'false');
    expect(getZeroStage('finalized')).toHaveAttribute('data-stage-done', 'false');
    expect(getZeroStage('published')).toHaveAttribute('data-stage-done', 'false');
  });

  it('Stage2 のみ完了で本文生成 done、画像/仕上げは未完了', () => {
    render(
      <ArticleStatusStepper
        status="draft"
        generationMode="zero"
        hasStage2={true}
        hasStage3={false}
        imageCount={0}
      />,
    );

    expect(getZeroStage('generated')).toHaveAttribute('data-stage-done', 'true');
    expect(getZeroStage('images')).toHaveAttribute('data-stage-done', 'false');
    expect(getZeroStage('finalized')).toHaveAttribute('data-stage-done', 'false');
  });

  it('Stage2 + 画像 1 枚で images done。Stage3 未生成なので仕上げは未完', () => {
    render(
      <ArticleStatusStepper
        status="draft"
        generationMode="zero"
        hasStage2={true}
        hasStage3={false}
        imageCount={1}
      />,
    );

    expect(getZeroStage('generated')).toHaveAttribute('data-stage-done', 'true');
    expect(getZeroStage('images')).toHaveAttribute('data-stage-done', 'true');
    expect(getZeroStage('finalized')).toHaveAttribute('data-stage-done', 'false');
  });

  it('Stage2+Stage3+画像揃って status!=body_generating で finalized done', () => {
    render(
      <ArticleStatusStepper
        status="draft"
        generationMode="zero"
        hasStage2={true}
        hasStage3={true}
        imageCount={3}
      />,
    );

    expect(getZeroStage('finalized')).toHaveAttribute('data-stage-done', 'true');
    expect(getZeroStage('published')).toHaveAttribute('data-stage-done', 'false');
  });

  it("status='body_generating' のときは Stage がそろっていても finalized は未完", () => {
    render(
      <ArticleStatusStepper
        status="body_generating"
        generationMode="zero"
        hasStage2={true}
        hasStage3={true}
        imageCount={3}
      />,
    );

    expect(getZeroStage('finalized')).toHaveAttribute('data-stage-done', 'false');
  });

  it("status='published' のとき published stage が done になる", () => {
    render(
      <ArticleStatusStepper
        status="published"
        generationMode="zero"
        hasStage2={true}
        hasStage3={true}
        imageCount={3}
      />,
    );

    expect(getZeroStage('published')).toHaveAttribute('data-stage-done', 'true');
    expect(getZeroStage('finalized')).toHaveAttribute('data-stage-done', 'true');
  });
});

describe('ArticleStatusStepper - legacy mode', () => {
  it("generationMode='source' で legacy timeline を描画する", () => {
    render(
      <ArticleStatusStepper
        status="draft"
        generationMode="source"
        hasStage2={false}
        hasStage3={false}
        imageCount={0}
      />,
    );

    expect(
      screen.getByTestId('article-status-stepper-legacy'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('article-status-stepper-zero'),
    ).not.toBeInTheDocument();
  });

  it('generationMode=null でも legacy timeline を描画する', () => {
    render(
      <ArticleStatusStepper
        status="outline_pending"
        generationMode={null}
        hasStage2={false}
        hasStage3={false}
        imageCount={0}
      />,
    );

    expect(
      screen.getByTestId('article-status-stepper-legacy'),
    ).toBeInTheDocument();
  });

  it("status='body_review' で前 4 stage (draft〜body_generating) が done", () => {
    render(
      <ArticleStatusStepper
        status="body_review"
        generationMode="source"
        hasStage2={true}
        hasStage3={false}
        imageCount={0}
      />,
    );

    expect(getLegacyStage('draft')).toHaveAttribute('data-stage-done', 'true');
    expect(getLegacyStage('outline_pending')).toHaveAttribute('data-stage-done', 'true');
    expect(getLegacyStage('outline_approved')).toHaveAttribute('data-stage-done', 'true');
    expect(getLegacyStage('body_generating')).toHaveAttribute('data-stage-done', 'true');
    // current は done ではない
    expect(getLegacyStage('body_review')).toHaveAttribute('data-stage-done', 'false');
    expect(getLegacyStage('body_review')).toHaveAttribute('data-stage-current', 'true');
    // 後続も未完
    expect(getLegacyStage('editing')).toHaveAttribute('data-stage-done', 'false');
    expect(getLegacyStage('published')).toHaveAttribute('data-stage-done', 'false');
  });

  it("status='published' で全 6 stage が done、published が current", () => {
    render(
      <ArticleStatusStepper
        status="published"
        generationMode="source"
        hasStage2={true}
        hasStage3={true}
        imageCount={3}
      />,
    );

    expect(getLegacyStage('draft')).toHaveAttribute('data-stage-done', 'true');
    expect(getLegacyStage('outline_pending')).toHaveAttribute('data-stage-done', 'true');
    expect(getLegacyStage('outline_approved')).toHaveAttribute('data-stage-done', 'true');
    expect(getLegacyStage('body_generating')).toHaveAttribute('data-stage-done', 'true');
    expect(getLegacyStage('body_review')).toHaveAttribute('data-stage-done', 'true');
    expect(getLegacyStage('editing')).toHaveAttribute('data-stage-done', 'true');
    expect(getLegacyStage('published')).toHaveAttribute('data-stage-done', 'false');
    expect(getLegacyStage('published')).toHaveAttribute('data-stage-current', 'true');
  });

  it("status='draft' は他 stage がすべて未完で current のみ", () => {
    render(
      <ArticleStatusStepper
        status="draft"
        generationMode="source"
        hasStage2={false}
        hasStage3={false}
        imageCount={0}
      />,
    );

    expect(getLegacyStage('draft')).toHaveAttribute('data-stage-current', 'true');
    expect(getLegacyStage('draft')).toHaveAttribute('data-stage-done', 'false');
    expect(getLegacyStage('outline_pending')).toHaveAttribute('data-stage-done', 'false');
    expect(getLegacyStage('published')).toHaveAttribute('data-stage-done', 'false');
  });
});
