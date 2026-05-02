import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * P5-43 Step 2: assertStateParity() の単体テスト。
 *
 * reviewed_at（レビュー済みフラグ）と visibility_state（公開状態列）の整合性を
 * シャドー期間中にログ警告するだけのヘルパー。動作ブロックはしない。
 *
 * logger.warn の呼び出しを spy して、不整合時のみ警告が出ることを確認する。
 */

// logger を spy 可能なモックに差し替える
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    timed: vi.fn(),
  },
}));

import { assertStateParity } from '@/lib/publish-control/runtime-parity';
import { logger } from '@/lib/logger';

describe('assertStateParity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('一致: reviewed_at あり + visibility_state=live → ok=true', () => {
    const result = assertStateParity({
      id: 'a-1',
      reviewed_at: '2026-05-01T00:00:00Z',
      visibility_state: 'live',
    });
    expect(result.ok).toBe(true);
    expect(result.mismatch).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('一致: reviewed_at あり + visibility_state=live_hub_stale → ok=true', () => {
    const result = assertStateParity({
      id: 'a-2',
      reviewed_at: '2026-05-01T00:00:00Z',
      visibility_state: 'live_hub_stale',
    });
    expect(result.ok).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('一致: reviewed_at=null + visibility_state=null → ok=true (どちらも未公開)', () => {
    const result = assertStateParity({
      id: 'a-3',
      reviewed_at: null,
      visibility_state: null,
    });
    expect(result.ok).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('一致: reviewed_at=null + visibility_state=idle → ok=true (どちらも未公開)', () => {
    const result = assertStateParity({
      id: 'a-4',
      reviewed_at: null,
      visibility_state: 'idle',
    });
    expect(result.ok).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('不一致: reviewed_at あり + visibility_state=idle → ok=false, mismatch 文字列を返し warn', () => {
    const result = assertStateParity({
      id: 'a-5',
      reviewed_at: '2026-05-01T00:00:00Z',
      visibility_state: 'idle',
    });
    expect(result.ok).toBe(false);
    expect(result.mismatch).toBe('reviewed=true != publiclyVisible=false');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'deploy',
      'state-parity-mismatch',
      expect.objectContaining({
        articleId: 'a-5',
        reviewed_at: '2026-05-01T00:00:00Z',
        visibility_state: 'idle',
      }),
    );
  });

  it('不一致: reviewed_at=null + visibility_state=live → ok=false, mismatch 文字列を返し warn', () => {
    const result = assertStateParity({
      id: 'a-6',
      reviewed_at: null,
      visibility_state: 'live',
    });
    expect(result.ok).toBe(false);
    expect(result.mismatch).toBe('reviewed=false != publiclyVisible=true');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'deploy',
      'state-parity-mismatch',
      expect.objectContaining({
        articleId: 'a-6',
        reviewed_at: null,
        visibility_state: 'live',
      }),
    );
  });

  it('不一致: reviewed_at=null + visibility_state=live_hub_stale → ok=false', () => {
    const result = assertStateParity({
      id: 'a-7',
      reviewed_at: null,
      visibility_state: 'live_hub_stale',
    });
    expect(result.ok).toBe(false);
    expect(result.mismatch).toBe('reviewed=false != publiclyVisible=true');
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
