// ============================================================================
// src/hooks/useGenerationJobs.ts
// 複数の非同期生成ジョブを同時管理するフック (P5-21 案B 拡張)
//
// 既存 useGenerationJob (単一版) は後方互換のため温存。本フックは
// バッチ投入された複数 job_id を同時 SSE 購読し、集計値を提供する。
// ============================================================================
'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { GenerationJobStage, GenerationJobState } from './useGenerationJob';

const STORAGE_KEY = 'blogauto.activeGenerationJobs';
const SYNC_EVENT = 'blogauto-jobs-changed';
const TERMINAL_STAGES: GenerationJobStage[] = ['done', 'failed'];

function readJobsFromStorage(): GenerationJobState[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as GenerationJobState[];
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }
    const fresh = parsed.filter((j) => {
      if (!j.job_id) return false;
      const ageMs = Date.now() - new Date(j.startedAt).getTime();
      return ageMs <= 60 * 60 * 1000;
    });
    if (fresh.length !== parsed.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    }
    return fresh;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

export interface JobsSummary {
  total: number;
  queued: number;
  in_progress: number;
  done: number;
  failed: number;
  /** 全ジョブが終端状態か */
  all_terminal: boolean;
}

export function useGenerationJobs() {
  const [jobs, setJobs] = useState<GenerationJobState[]>([]);
  const esMapRef = useRef<Map<string, EventSource>>(new Map());

  // ─── 初期化 + 同一タブ sync (CustomEvent) ─────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => setJobs(readJobsFromStorage());
    sync();
    window.addEventListener(SYNC_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(SYNC_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  // ─── 各 job の SSE 購読 (非終端状態のみ) ────────────────────────────
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const esMap = esMapRef.current;

    // 新規 job について EventSource を開く
    for (const j of jobs) {
      if (esMap.has(j.job_id)) continue;
      if (TERMINAL_STAGES.includes(j.stage)) continue;

      const url = `/api/articles/zero-generate/${j.job_id}/progress`;
      const es = new EventSource(url);
      esMap.set(j.job_id, es);

      es.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data) as Partial<GenerationJobState>;

          // P5-23: stale job_id を検知して該当 job のみリストから除外
          if (
            data.stage === 'failed' &&
            (data.error === 'job not found' || data.error === 'progress stream error')
          ) {
            console.warn('[useGenerationJobs] stale job_id removed', {
              job_id: j.job_id,
              error: data.error,
            });
            es.close();
            esMap.delete(j.job_id);
            setJobs((prev) => {
              const filtered = prev.filter((p) => p.job_id !== j.job_id);
              if (typeof window !== 'undefined') {
                if (filtered.length === 0) {
                  localStorage.removeItem(STORAGE_KEY);
                } else {
                  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
                }
                window.dispatchEvent(new Event(SYNC_EVENT));
              }
              return filtered;
            });
            return;
          }

          setJobs((prev) => {
            const updated = prev.map((p) =>
              p.job_id === j.job_id
                ? {
                    ...p,
                    stage: (data.stage as GenerationJobStage) ?? p.stage,
                    progress: data.progress ?? p.progress,
                    eta_seconds: data.eta_seconds ?? p.eta_seconds,
                    error: data.error,
                    article_id: data.article_id,
                  }
                : p,
            );
            localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new Event(SYNC_EVENT));
            }
            return updated;
          });
          if (data.stage && TERMINAL_STAGES.includes(data.stage as GenerationJobStage)) {
            es.close();
            esMap.delete(j.job_id);
          }
        } catch {
          // ignore
        }
      });
      es.addEventListener('error', () => {
        es.close();
        esMap.delete(j.job_id);
      });
    }

    // 削除された job の EventSource を close
    const activeIds = new Set(jobs.map((j) => j.job_id));
    for (const [id, es] of esMap.entries()) {
      if (!activeIds.has(id)) {
        es.close();
        esMap.delete(id);
      }
    }

    return () => {
      // unmount 時に全 close
      for (const es of esMap.values()) es.close();
      esMap.clear();
    };
  }, [jobs]);

  // ─── 開始: 複数 job_id を一気に登録 ───────────────────────────────
  const startBatch = useCallback((jobIds: string[]) => {
    const now = new Date().toISOString();
    const newJobs: GenerationJobState[] = jobIds.map((id) => ({
      job_id: id,
      stage: 'queued',
      progress: 0,
      eta_seconds: 90,
      startedAt: now,
    }));
    setJobs((prev) => {
      const merged = [...prev, ...newJobs];
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        window.dispatchEvent(new Event(SYNC_EVENT));
      }
      return merged;
    });
  }, []);

  // ─── 単一 job 削除 ─────────────────────────────────────────────────
  const removeJob = useCallback((jobId: string) => {
    setJobs((prev) => {
      const filtered = prev.filter((j) => j.job_id !== jobId);
      if (typeof window !== 'undefined') {
        if (filtered.length === 0) localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
        window.dispatchEvent(new Event(SYNC_EVENT));
      }
      return filtered;
    });
  }, []);

  // ─── 全 job 削除 ───────────────────────────────────────────────────
  const clearAll = useCallback(() => {
    setJobs([]);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new Event(SYNC_EVENT));
    }
    for (const es of esMapRef.current.values()) es.close();
    esMapRef.current.clear();
  }, []);

  // ─── 集計値 ────────────────────────────────────────────────────────
  const summary: JobsSummary = {
    total: jobs.length,
    queued: jobs.filter((j) => j.stage === 'queued').length,
    in_progress: jobs.filter(
      (j) => j.stage === 'stage1' || j.stage === 'stage2' || j.stage === 'hallucination',
    ).length,
    done: jobs.filter((j) => j.stage === 'done').length,
    failed: jobs.filter((j) => j.stage === 'failed').length,
    all_terminal:
      jobs.length > 0 &&
      jobs.every((j) => TERMINAL_STAGES.includes(j.stage)),
  };

  return { jobs, summary, startBatch, removeJob, clearAll };
}
