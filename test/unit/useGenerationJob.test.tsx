// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useGenerationJob } from '@/hooks/useGenerationJob';

const STORAGE_KEY = 'blogauto.activeGenerationJob';

describe('useGenerationJob', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('初期状態は null', () => {
    const { result } = renderHook(() => useGenerationJob());
    expect(result.current.job).toBeNull();
  });

  it('startJob で localStorage に保存される', () => {
    const { result } = renderHook(() => useGenerationJob());
    act(() => {
      result.current.startJob('11111111-1111-1111-1111-111111111111');
    });
    expect(result.current.job?.job_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(result.current.job?.stage).toBe('queued');
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.job_id).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('clearJob で localStorage が消去される', () => {
    const { result } = renderHook(() => useGenerationJob());
    act(() => {
      result.current.startJob('22222222-2222-2222-2222-222222222222');
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();
    act(() => {
      result.current.clearJob();
    });
    expect(result.current.job).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('localStorage に既存 job があればマウント時に復元される', () => {
    const existing = {
      job_id: '33333333-3333-3333-3333-333333333333',
      stage: 'stage2',
      progress: 0.4,
      eta_seconds: 50,
      startedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    const { result } = renderHook(() => useGenerationJob());
    expect(result.current.job?.job_id).toBe(existing.job_id);
    expect(result.current.job?.stage).toBe('stage2');
  });

  it('60 分以上経過した古い job は復元されず破棄', () => {
    const old = {
      job_id: '44444444-4444-4444-4444-444444444444',
      stage: 'stage2',
      progress: 0.4,
      eta_seconds: 50,
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 時間前
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(old));
    const { result } = renderHook(() => useGenerationJob());
    expect(result.current.job).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('破損した JSON は復元されず破棄', () => {
    localStorage.setItem(STORAGE_KEY, '{invalid json');
    const { result } = renderHook(() => useGenerationJob());
    expect(result.current.job).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('done 状態の job は復元される（バナー表示用）', () => {
    const done = {
      job_id: '55555555-5555-5555-5555-555555555555',
      stage: 'done',
      progress: 1,
      eta_seconds: 0,
      article_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      startedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(done));
    const { result } = renderHook(() => useGenerationJob());
    expect(result.current.job?.stage).toBe('done');
    expect(result.current.job?.article_id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });
});
