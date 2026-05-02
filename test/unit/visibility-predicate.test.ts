// ============================================================================
// test/unit/visibility-predicate.test.ts
// P5-43: 公開可視性 predicate の網羅テスト
//
// 全 8 状態 + null/undefined を全 predicate に通し、期待値を検証する。
// ============================================================================

import { describe, expect, it } from 'vitest';
import {
  isPubliclyVisible,
  isInReview,
  isDeployable,
  isDraft,
  PUBLICLY_VISIBLE_STATES,
  DEPLOYABLE_STATES,
} from '../../src/lib/publish-control/visibility-predicate';

// 検証対象の全 8 状態 (state-machine.ts の VisibilityState + draft / pending_review)
const ALL_STATES = [
  'draft',
  'pending_review',
  'idle',
  'deploying',
  'live',
  'live_hub_stale',
  'unpublished',
  'failed',
] as const;

type AnyState = (typeof ALL_STATES)[number];

const wrap = (s: AnyState | null | undefined) => ({ visibility_state: s });

// ---------------------------------------------------------------------------
// isPubliclyVisible
// ---------------------------------------------------------------------------
describe('isPubliclyVisible', () => {
  it.each([
    ['draft', false],
    ['pending_review', false],
    ['idle', false],
    ['deploying', false],
    ['live', true],
    ['live_hub_stale', true],
    ['unpublished', false],
    ['failed', false],
  ] as const)('state=%s → %s', (state, expected) => {
    expect(isPubliclyVisible(wrap(state))).toBe(expected);
  });

  it('null は false', () => {
    expect(isPubliclyVisible({ visibility_state: null })).toBe(false);
  });

  it('undefined は false', () => {
    expect(isPubliclyVisible({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isInReview
// ---------------------------------------------------------------------------
describe('isInReview', () => {
  it.each([
    ['draft', false],
    ['pending_review', true],
    ['idle', false],
    ['deploying', false],
    ['live', false],
    ['live_hub_stale', false],
    ['unpublished', false],
    ['failed', false],
  ] as const)('state=%s → %s', (state, expected) => {
    expect(isInReview(wrap(state))).toBe(expected);
  });

  it('null は false', () => {
    expect(isInReview({ visibility_state: null })).toBe(false);
  });

  it('undefined は false', () => {
    expect(isInReview({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isDeployable
// ---------------------------------------------------------------------------
describe('isDeployable', () => {
  it.each([
    ['draft', false],
    ['pending_review', false],
    ['idle', true],
    ['deploying', false],
    ['live', false],
    ['live_hub_stale', true],
    ['unpublished', true],
    ['failed', true],
  ] as const)('state=%s → %s', (state, expected) => {
    expect(isDeployable(wrap(state))).toBe(expected);
  });

  it('null は false', () => {
    expect(isDeployable({ visibility_state: null })).toBe(false);
  });

  it('undefined は false', () => {
    expect(isDeployable({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isDraft
// ---------------------------------------------------------------------------
describe('isDraft', () => {
  it.each([
    ['draft', true],
    ['pending_review', false],
    ['idle', false],
    ['deploying', false],
    ['live', false],
    ['live_hub_stale', false],
    ['unpublished', false],
    ['failed', false],
  ] as const)('state=%s → %s', (state, expected) => {
    expect(isDraft(wrap(state))).toBe(expected);
  });

  it('null は true (未設定はドラフト扱い)', () => {
    expect(isDraft({ visibility_state: null })).toBe(true);
  });

  it('undefined は true (未設定はドラフト扱い)', () => {
    expect(isDraft({})).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 定数リスト
// ---------------------------------------------------------------------------
describe('PUBLICLY_VISIBLE_STATES / DEPLOYABLE_STATES', () => {
  it('PUBLICLY_VISIBLE_STATES は live と live_hub_stale を含む', () => {
    expect(PUBLICLY_VISIBLE_STATES).toEqual(['live', 'live_hub_stale']);
  });

  it('DEPLOYABLE_STATES は idle / failed / live_hub_stale / unpublished を含む', () => {
    expect(DEPLOYABLE_STATES).toEqual(['idle', 'failed', 'live_hub_stale', 'unpublished']);
  });

  it('両定数は predicate の真値集合と一致する', () => {
    const visibleByPred = ALL_STATES.filter((s) => isPubliclyVisible(wrap(s)));
    expect([...visibleByPred].sort()).toEqual([...PUBLICLY_VISIBLE_STATES].sort());

    const deployableByPred = ALL_STATES.filter((s) => isDeployable(wrap(s)));
    expect([...deployableByPred].sort()).toEqual([...DEPLOYABLE_STATES].sort());
  });
});
