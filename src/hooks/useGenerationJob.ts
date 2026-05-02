// ============================================================================
// src/hooks/useGenerationJob.ts
// 非同期記事生成ジョブの状態管理フック (P5-20 案B)
//
// 役割:
//   - localStorage で job_id を永続化 (タブ閉じても復帰可能)
//   - SSE で /api/articles/zero-generate/{job_id}/progress を購読
//   - 完了/失敗時に終端状態を保持 + コールバック起動
//
// 利用例:
//   const { job, startJob, clearJob } = useGenerationJob();
//   // 生成 API から job_id を受け取ったら startJob(jobId)
//   // job?.stage で進捗、job?.article_id で完了記事 ID を取得
// ============================================================================
'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

export type GenerationJobStage =
  | 'queued'
  | 'stage1'
  | 'stage2'
  | 'hallucination'
  | 'done'
  | 'failed';

export interface GenerationJobState {
  job_id: string;
  stage: GenerationJobStage;
  progress: number;
  eta_seconds: number;
  error?: string;
  article_id?: string;
  startedAt: string;
}

const STORAGE_KEY = 'blogauto.activeGenerationJob';
const TERMINAL_STAGES: GenerationJobStage[] = ['done', 'failed'];

export function useGenerationJob() {
  const [job, setJob] = useState<GenerationJobState | null>(null);
  const esRef = useRef<EventSource | null>(null);

  // ─── 初期化: localStorage から復元 ─────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as GenerationJobState;
      if (!parsed.job_id) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      // 完了/失敗状態でも 60 分以内なら表示しておく (ユーザが「閉じる」するまで)
      const ageMs = Date.now() - new Date(parsed.startedAt).getTime();
      if (ageMs > 60 * 60 * 1000) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      setJob(parsed);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  // ─── SSE 購読 (非終端状態のみ) ────────────────────────────────────────
  useEffect(() => {
    if (!job?.job_id) return;
    if (TERMINAL_STAGES.includes(job.stage)) return;
    // SSR / jsdom / 古いブラウザ等で EventSource 未定義の場合はスキップ
    if (typeof EventSource === 'undefined') return;

    const url = `/api/articles/zero-generate/${job.job_id}/progress`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data) as Partial<GenerationJobState>;
        setJob((prev) => {
          if (!prev) return prev;
          const updated: GenerationJobState = {
            ...prev,
            stage: (data.stage as GenerationJobStage) ?? prev.stage,
            progress: data.progress ?? prev.progress,
            eta_seconds: data.eta_seconds ?? prev.eta_seconds,
            error: data.error,
            article_id: data.article_id,
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
          if (TERMINAL_STAGES.includes(updated.stage)) {
            es.close();
          }
          return updated;
        });
      } catch {
        // パース失敗は無視
      }
    });
    es.addEventListener('error', () => {
      es.close();
    });
    return () => {
      es.close();
      esRef.current = null;
    };
    // job_id と非終端遷移の両方を依存に
  }, [job?.job_id, job?.stage]);

  // ─── 開始 ─────────────────────────────────────────────────────────────
  const startJob = useCallback((jobId: string) => {
    const newJob: GenerationJobState = {
      job_id: jobId,
      stage: 'queued',
      progress: 0,
      eta_seconds: 90,
      startedAt: new Date().toISOString(),
    };
    setJob(newJob);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newJob));
    }
  }, []);

  // ─── 閉じる (UI からの dismiss) ────────────────────────────────────
  const clearJob = useCallback(() => {
    setJob(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  return { job, startJob, clearJob };
}
