// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useGenerationJobs } from '@/hooks/useGenerationJobs';

const STORAGE_KEY = 'blogauto.activeGenerationJobs';

describe('useGenerationJobs', () => {
  beforeEach(() => localStorage.clear());

  it('初期状態は空配列', () => {
    const { result } = renderHook(() => useGenerationJobs());
    expect(result.current.jobs).toEqual([]);
    expect(result.current.summary.total).toBe(0);
  });

  it('startBatch で複数 job が登録される', () => {
    const { result } = renderHook(() => useGenerationJobs());
    act(() => {
      result.current.startBatch([
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
      ]);
    });
    expect(result.current.jobs).toHaveLength(2);
    expect(result.current.summary.total).toBe(2);
    expect(result.current.summary.queued).toBe(2);
    expect(result.current.summary.all_terminal).toBe(false);
  });

  it('removeJob で 1 件削除', () => {
    const { result } = renderHook(() => useGenerationJobs());
    act(() => {
      result.current.startBatch(['aaaa1111-1111-1111-1111-111111111111', 'bbbb2222-2222-2222-2222-222222222222']);
    });
    act(() => {
      result.current.removeJob('aaaa1111-1111-1111-1111-111111111111');
    });
    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.jobs[0].job_id).toBe('bbbb2222-2222-2222-2222-222222222222');
  });

  it('clearAll で全削除', () => {
    const { result } = renderHook(() => useGenerationJobs());
    act(() => {
      result.current.startBatch(['cccc1111-1111-1111-1111-111111111111', 'dddd2222-2222-2222-2222-222222222222']);
    });
    act(() => {
      result.current.clearAll();
    });
    expect(result.current.jobs).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('localStorage の job が 60 分以内なら復元', () => {
    const fresh = [
      {
        job_id: '99999999-9999-4999-8999-999999999999',
        stage: 'stage1',
        progress: 0.2,
        eta_seconds: 70,
        startedAt: new Date().toISOString(),
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    const { result } = renderHook(() => useGenerationJobs());
    expect(result.current.jobs).toHaveLength(1);
  });

  it('60 分超過 job は破棄', () => {
    const stale = [
      {
        job_id: '88888888-8888-4888-8888-888888888888',
        stage: 'stage1',
        progress: 0.2,
        eta_seconds: 70,
        startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stale));
    const { result } = renderHook(() => useGenerationJobs());
    expect(result.current.jobs).toEqual([]);
  });

  it('破損 JSON は破棄', () => {
    localStorage.setItem(STORAGE_KEY, 'invalid {');
    const { result } = renderHook(() => useGenerationJobs());
    expect(result.current.jobs).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('summary の集計が正しい', () => {
    const mixed = [
      { job_id: 'a-1', stage: 'queued', progress: 0, eta_seconds: 90, startedAt: new Date().toISOString() },
      { job_id: 'a-2', stage: 'stage2', progress: 0.5, eta_seconds: 50, startedAt: new Date().toISOString() },
      { job_id: 'a-3', stage: 'done', progress: 1, eta_seconds: 0, article_id: 'art-1', startedAt: new Date().toISOString() },
      { job_id: 'a-4', stage: 'failed', progress: 1, eta_seconds: 0, error: 'oops', startedAt: new Date().toISOString() },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mixed));
    const { result } = renderHook(() => useGenerationJobs());
    expect(result.current.summary).toMatchObject({
      total: 4,
      queued: 1,
      in_progress: 1,
      done: 1,
      failed: 1,
      all_terminal: false,
    });
  });

  it('全 job が終端なら all_terminal=true', () => {
    const terminal = [
      { job_id: 'b-1', stage: 'done', progress: 1, eta_seconds: 0, article_id: 'x', startedAt: new Date().toISOString() },
      { job_id: 'b-2', stage: 'failed', progress: 1, eta_seconds: 0, error: 'oops', startedAt: new Date().toISOString() },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(terminal));
    const { result } = renderHook(() => useGenerationJobs());
    expect(result.current.summary.all_terminal).toBe(true);
  });
});
