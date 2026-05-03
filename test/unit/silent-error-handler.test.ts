import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * P5-62: silent-error-handler の単体テスト。
 *
 * logAndIgnore() は fire-and-forget な promise chain の catch に渡す
 * 標準 handler を返す。Error / 非 Error / extra meta / await 後の状態を
 * それぞれ logger.warn の呼び出し内容で検証する。
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

import { logAndIgnore } from '@/lib/utils/silent-error-handler';
import { logger } from '@/lib/logger';

describe('logAndIgnore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Error インスタンスの message を warn として記録する', () => {
    const handler = logAndIgnore('unit_test_error');
    handler(new Error('boom'));

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('utility', 'silent_caught', {
      context: 'unit_test_error',
      message: 'boom',
    });
  });

  it('非 Error 値を String() で文字列化して記録する', () => {
    const handler = logAndIgnore('unit_test_string');
    handler('plain string failure');

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('utility', 'silent_caught', {
      context: 'unit_test_string',
      message: 'plain string failure',
    });
  });

  it('extra meta を details にマージする', () => {
    const handler = logAndIgnore('unit_test_extra', { jobId: 'j-1', retry: 2 });
    handler(new Error('with extra'));

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('utility', 'silent_caught', {
      context: 'unit_test_extra',
      message: 'with extra',
      jobId: 'j-1',
      retry: 2,
    });
  });

  it('rejected promise の .catch に渡しても再 throw せず handler が解決する', async () => {
    const handler = logAndIgnore('unit_test_chain');
    const result = await Promise.reject(new Error('async fail')).catch(handler);

    // logAndIgnore は値を返さない (undefined) → 握り潰された証跡
    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('utility', 'silent_caught', {
      context: 'unit_test_chain',
      message: 'async fail',
    });
  });
});
