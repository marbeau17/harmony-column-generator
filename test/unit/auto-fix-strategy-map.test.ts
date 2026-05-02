import { describe, it, expect } from 'vitest';
import {
  STRATEGY_MAP,
  DEFAULT_STRATEGY,
  getStrategyFor,
  isStrategyAllowed,
} from '@/lib/auto-fix/strategy-map';

describe('getStrategyFor', () => {
  it('既知の id にエントリを返す', () => {
    expect(getStrategyFor('soft_endings')).toBe(STRATEGY_MAP.soft_endings);
    expect(getStrategyFor('keyword_density')).toBe(STRATEGY_MAP.keyword_density);
  });

  it('未知の id は DEFAULT_STRATEGY', () => {
    expect(getStrategyFor('nonexistent')).toBe(DEFAULT_STRATEGY);
  });
});

describe('isStrategyAllowed', () => {
  it('語尾不足は auto-fix 許可', () => {
    expect(isStrategyAllowed('soft_endings', 'auto-fix').allowed).toBe(true);
  });

  it('語尾不足は regen-full 不許可', () => {
    const r = isStrategyAllowed('soft_endings', 'regen-full');
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/許可されていません/);
  });

  it('禁止語 (banned_book) は manual-edit のみ', () => {
    expect(isStrategyAllowed('banned_book', 'manual-edit').allowed).toBe(true);
    expect(isStrategyAllowed('banned_book', 'auto-fix').allowed).toBe(false);
    expect(isStrategyAllowed('banned_book', 'ignore-warn').allowed).toBe(false);
  });

  it('医療表現 (medical) は auto-fix 不可', () => {
    expect(isStrategyAllowed('medical', 'auto-fix').allowed).toBe(false);
    expect(isStrategyAllowed('medical', 'manual-edit').allowed).toBe(true);
  });

  it('AI 文体パターンは ignore-warn 許容、auto-fix 不可', () => {
    expect(isStrategyAllowed('ai_patterns', 'auto-fix').allowed).toBe(false);
    expect(isStrategyAllowed('ai_patterns', 'ignore-warn').allowed).toBe(true);
  });

  it('hallucination_critical は regen-chapter 必須', () => {
    expect(isStrategyAllowed('hallucination_critical', 'regen-chapter').allowed).toBe(true);
    expect(isStrategyAllowed('hallucination_critical', 'auto-fix').allowed).toBe(false);
  });

  it('未知 id は manual-edit / ignore-warn のみ許可', () => {
    expect(isStrategyAllowed('unknown_id', 'manual-edit').allowed).toBe(true);
    expect(isStrategyAllowed('unknown_id', 'ignore-warn').allowed).toBe(true);
    expect(isStrategyAllowed('unknown_id', 'auto-fix').allowed).toBe(false);
  });

  it('tone_low は regen-full まで許可', () => {
    expect(isStrategyAllowed('tone_low', 'auto-fix').allowed).toBe(true);
    expect(isStrategyAllowed('tone_low', 'regen-full').allowed).toBe(true);
    expect(isStrategyAllowed('tone_low', 'regen-chapter').allowed).toBe(false);
  });

  it('keyword_density は auto-fix と regen-chapter 両方許可', () => {
    expect(isStrategyAllowed('keyword_density', 'auto-fix').allowed).toBe(true);
    expect(isStrategyAllowed('keyword_density', 'regen-chapter').allowed).toBe(true);
  });
});
