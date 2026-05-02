/**
 * VisibilityState ランタイム型ガード
 *
 * P5-43 Step 1: state-machine.ts で additive 拡張された 8 状態
 * (draft / pending_review / idle / deploying / live / live_hub_stale /
 *  unpublished / failed) を unknown 値から安全に検証するためのユーティリティ。
 *
 * - DB / API レスポンス / フォーム入力など、コンパイル時に型保証されない
 *   境界で `unknown` → `VisibilityState` を絞り込む用途で使用する。
 * - state-machine.ts は編集せず、純粋に追加で値レベルの定数と guard を提供する。
 */
import type { VisibilityState } from './state-machine';

const ALL_STATES: readonly VisibilityState[] = [
  'draft',
  'pending_review',
  'idle',
  'deploying',
  'live',
  'live_hub_stale',
  'unpublished',
  'failed',
];

export function isVisibilityState(value: unknown): value is VisibilityState {
  return typeof value === 'string' && (ALL_STATES as readonly string[]).includes(value);
}

export function asVisibilityState(
  value: unknown,
  fallback: VisibilityState = 'draft',
): VisibilityState {
  return isVisibilityState(value) ? value : fallback;
}

export { ALL_STATES };
