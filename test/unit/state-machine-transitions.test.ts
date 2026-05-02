/**
 * P5-43 Step 1: 可視性ステートマシン遷移テスト
 *
 * 新規ノード `'draft'` / `'pending_review'` の遷移と、
 * 既存ノード (idle/deploying/live など) の遷移が壊れていないことを検証する。
 */
import { describe, expect, it } from 'vitest';

import {
  assertTransition,
  canTransition,
  type VisibilityState,
} from '@/lib/publish-control/state-machine';

describe('state-machine transitions (P5-43 Step 1)', () => {
  // ─── 新規ノード: draft / pending_review ──────────────────────────────────
  it('allows draft → pending_review (submit_review)', () => {
    expect(() => assertTransition('draft', 'pending_review')).not.toThrow();
    expect(canTransition('draft', 'pending_review')).toBe(true);
  });

  it('allows pending_review → idle (approve_review)', () => {
    expect(() => assertTransition('pending_review', 'idle')).not.toThrow();
    expect(canTransition('pending_review', 'idle')).toBe(true);
  });

  it('allows pending_review → draft (reject_review / 差戻し)', () => {
    expect(() => assertTransition('pending_review', 'draft')).not.toThrow();
    expect(canTransition('pending_review', 'draft')).toBe(true);
  });

  it('allows idle → pending_review (再 review)', () => {
    expect(() => assertTransition('idle', 'pending_review')).not.toThrow();
    expect(canTransition('idle', 'pending_review')).toBe(true);
  });

  // ─── 既存ノードの後方互換 ─────────────────────────────────────────────────
  it('still allows idle → deploying (既存遷移)', () => {
    expect(() => assertTransition('idle', 'deploying')).not.toThrow();
    expect(canTransition('idle', 'deploying')).toBe(true);
  });

  it('still allows deploying → live, live_hub_stale, failed', () => {
    expect(canTransition('deploying', 'live')).toBe(true);
    expect(canTransition('deploying', 'live_hub_stale')).toBe(true);
    expect(canTransition('deploying', 'failed')).toBe(true);
  });

  it('still allows live → deploying (再デプロイ)', () => {
    expect(canTransition('live', 'deploying')).toBe(true);
  });

  it('still allows failed → deploying / idle (リカバリ)', () => {
    expect(canTransition('failed', 'deploying')).toBe(true);
    expect(canTransition('failed', 'idle')).toBe(true);
  });

  // ─── 異常 (illegal) 遷移 ──────────────────────────────────────────────────
  it('rejects live → draft (illegal — 公開中はレビューに戻せない)', () => {
    expect(canTransition('live', 'draft')).toBe(false);
    expect(() => assertTransition('live', 'draft')).toThrowError(
      /illegal visibility transition: live → draft/,
    );
  });

  it('rejects draft → live (review を経由必須)', () => {
    expect(canTransition('draft', 'live')).toBe(false);
    expect(() => assertTransition('draft', 'live')).toThrow();
  });

  it('rejects pending_review → live (idle 経由必須)', () => {
    expect(canTransition('pending_review', 'live')).toBe(false);
    expect(() => assertTransition('pending_review', 'live')).toThrow();
  });

  it('rejects idle → live (deploying 経由必須)', () => {
    expect(canTransition('idle', 'live')).toBe(false);
    expect(() => assertTransition('idle', 'live')).toThrow();
  });

  it('rejects draft → idle (review を経由必須)', () => {
    expect(canTransition('draft', 'idle')).toBe(false);
    expect(() => assertTransition('draft', 'idle')).toThrow();
  });

  it('rejects deploying → draft (illegal)', () => {
    expect(canTransition('deploying', 'draft')).toBe(false);
    expect(() => assertTransition('deploying', 'draft')).toThrow();
  });

  // ─── 自己遷移は全て不許可 ─────────────────────────────────────────────────
  it('rejects self-transitions for all states', () => {
    const states: VisibilityState[] = [
      'draft',
      'pending_review',
      'idle',
      'deploying',
      'live',
      'live_hub_stale',
      'unpublished',
      'failed',
    ];
    for (const s of states) {
      expect(canTransition(s, s)).toBe(false);
    }
  });
});
