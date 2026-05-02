/**
 * P5-43 Step 1: VisibilityState type guard ユニットテスト
 *
 * 全 8 状態 (draft / pending_review / idle / deploying / live /
 * live_hub_stale / unpublished / failed) の検証と、
 * 不正値に対する fallback 挙動を確認する。
 */
import { describe, it, expect } from 'vitest';
import type { VisibilityState } from '@/lib/publish-control/state-machine';
import {
  isVisibilityState,
  asVisibilityState,
  ALL_STATES,
} from '@/lib/publish-control/type-guards';

describe('isVisibilityState', () => {
  it('全 8 状態を網羅していること', () => {
    expect(ALL_STATES).toHaveLength(8);
  });

  it.each<VisibilityState>([
    'draft',
    'pending_review',
    'idle',
    'deploying',
    'live',
    'live_hub_stale',
    'unpublished',
    'failed',
  ])('%s は valid な VisibilityState として true を返す', (state) => {
    expect(isVisibilityState(state)).toBe(true);
  });

  it('null は false', () => {
    expect(isVisibilityState(null)).toBe(false);
  });

  it('undefined は false', () => {
    expect(isVisibilityState(undefined)).toBe(false);
  });

  it('数値 (0) は false', () => {
    expect(isVisibilityState(0)).toBe(false);
  });

  it('数値 (42) は false', () => {
    expect(isVisibilityState(42)).toBe(false);
  });

  it('真偽値は false', () => {
    expect(isVisibilityState(true)).toBe(false);
    expect(isVisibilityState(false)).toBe(false);
  });

  it('オブジェクトは false', () => {
    expect(isVisibilityState({ state: 'draft' })).toBe(false);
  });

  it('配列は false', () => {
    expect(isVisibilityState(['draft'])).toBe(false);
  });

  it('空文字列は false', () => {
    expect(isVisibilityState('')).toBe(false);
  });

  it('未知の文字列 ("DRAFT" 大文字) は false', () => {
    expect(isVisibilityState('DRAFT')).toBe(false);
  });

  it('未知の文字列 ("published") は false', () => {
    expect(isVisibilityState('published')).toBe(false);
  });

  it('前後空白付きの "draft " は false (厳格一致)', () => {
    expect(isVisibilityState('draft ')).toBe(false);
  });
});

describe('asVisibilityState', () => {
  it('valid な値はそのまま返す', () => {
    expect(asVisibilityState('live')).toBe('live');
    expect(asVisibilityState('pending_review')).toBe('pending_review');
  });

  it('invalid な値はデフォルト fallback ("draft") を返す', () => {
    expect(asVisibilityState(null)).toBe('draft');
    expect(asVisibilityState(undefined)).toBe('draft');
    expect(asVisibilityState('unknown_state')).toBe('draft');
    expect(asVisibilityState(123)).toBe('draft');
  });

  it('明示的な fallback を指定できる', () => {
    expect(asVisibilityState(null, 'idle')).toBe('idle');
    expect(asVisibilityState('bogus', 'failed')).toBe('failed');
    expect(asVisibilityState(undefined, 'pending_review')).toBe('pending_review');
  });

  it('fallback 自体は valid 値として保持される', () => {
    const result = asVisibilityState({}, 'unpublished');
    expect(isVisibilityState(result)).toBe(true);
    expect(result).toBe('unpublished');
  });
});
