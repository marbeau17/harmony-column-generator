// ============================================================================
// src/lib/jobs/zero-gen-job-store.ts
//
// ゼロ生成ジョブの進捗状態ストア (P5-22 — Supabase 共有ストアへ移行)
//
// 旧設計: os.tmpdir() (Vercel `/tmp`) に書き出し
//   問題: Vercel function instance 間で /tmp は共有されないため
//        async POST instance ≠ SSE GET instance だと "job not found" 404
//
// 新設計: Supabase テーブル `generation_jobs` を真実のソースに
//   - すべての instance から共通参照可能
//   - 同一 process 内 in-memory cache (TTL 60s) を併用して I/O を最小化
//   - service role で UPSERT/SELECT (RLS 影響なし)
//
// マイグレ: supabase/migrations/20260502020000_generation_jobs.sql
// ============================================================================

import { createServiceRoleClient } from '@/lib/supabase/server';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

export type JobStage =
  | 'queued'
  | 'stage1'
  | 'stage2'
  | 'hallucination'
  | 'finalizing'
  | 'done'
  | 'failed';

export interface JobState {
  stage: JobStage;
  progress: number;        // 0.0 - 1.0
  eta_seconds: number;
  error?: string;
  article_id?: string;
  updated_at: string;      // ISO8601
}

interface JobRow {
  id: string;
  user_id: string | null;
  stage: JobStage;
  progress: number;
  eta_seconds: number;
  error: string | null;
  article_id: string | null;
  created_at: string;
  updated_at: string;
}

// ─── 内部キャッシュ (per-process、TTL 60s) ──────────────────────────────────

const CACHE_TTL_MS = 60_000;
const memCache: Map<string, { state: JobState; cachedAt: number }> = new Map();

function cacheGet(jobId: string): JobState | null {
  const entry = memCache.get(jobId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    memCache.delete(jobId);
    return null;
  }
  return entry.state;
}

function cacheSet(jobId: string, state: JobState): void {
  memCache.set(jobId, { state, cachedAt: Date.now() });
}

function cacheDelete(jobId: string): void {
  memCache.delete(jobId);
}

// ─── 行 → JobState 変換 ────────────────────────────────────────────────────

function rowToState(row: JobRow): JobState {
  const out: JobState = {
    stage: row.stage,
    progress: typeof row.progress === 'number' ? row.progress : Number(row.progress),
    eta_seconds: row.eta_seconds,
    updated_at: row.updated_at,
  };
  if (row.error) out.error = row.error;
  if (row.article_id) out.article_id = row.article_id;
  return out;
}

// ─── 公開 API ───────────────────────────────────────────────────────────────

/**
 * 新規ジョブ状態を作成する。既存があっても 'queued' で上書き初期化 (UPSERT)。
 */
export async function createJobState(jobId: string): Promise<JobState> {
  if (!jobId) throw new Error('jobId is required');
  const supabase = await createServiceRoleClient();
  const initial = {
    id: jobId,
    stage: 'queued' as JobStage,
    progress: 0,
    eta_seconds: 0,
    error: null,
    article_id: null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('generation_jobs')
    .upsert(initial, { onConflict: 'id' });
  if (error) {
    console.warn('[zero-gen-job-store.create.failed]', {
      jobId,
      error_message: error.message,
    });
    throw new Error(`createJobState failed: ${error.message}`);
  }
  const state: JobState = {
    stage: 'queued',
    progress: 0,
    eta_seconds: 0,
    updated_at: initial.updated_at,
  };
  cacheSet(jobId, state);
  return state;
}

/**
 * ジョブ状態を部分更新 (UPDATE)。updated_at は自動更新。
 * 行が無い場合は INSERT で作成 (UPSERT)。
 */
export async function updateJobState(
  jobId: string,
  partial: Partial<Omit<JobState, 'updated_at'>>,
): Promise<JobState> {
  if (!jobId) throw new Error('jobId is required');
  const supabase = await createServiceRoleClient();

  const updateFields: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (partial.stage !== undefined) updateFields.stage = partial.stage;
  if (partial.progress !== undefined) {
    let p = partial.progress;
    if (typeof p === 'number' && Number.isNaN(p)) p = 0;
    if (typeof p === 'number') p = Math.max(0, Math.min(1, p));
    updateFields.progress = p;
  }
  if (partial.eta_seconds !== undefined) {
    updateFields.eta_seconds = Math.max(0, partial.eta_seconds);
  }
  if (partial.error !== undefined) updateFields.error = partial.error;
  if (partial.article_id !== undefined) updateFields.article_id = partial.article_id;

  // UPSERT — 行が無ければ id だけで INSERT (defaults で初期化)
  const upsertPayload = {
    id: jobId,
    ...updateFields,
  };
  const { data, error } = await supabase
    .from('generation_jobs')
    .upsert(upsertPayload, { onConflict: 'id' })
    .select()
    .single();

  if (error || !data) {
    console.warn('[zero-gen-job-store.update.failed]', {
      jobId,
      error_message: error?.message ?? 'no data returned',
    });
    throw new Error(`updateJobState failed: ${error?.message ?? 'no data'}`);
  }

  const state = rowToState(data as JobRow);
  cacheSet(jobId, state);
  return state;
}

/**
 * 現在の状態を取得。memCache hit なら即返、miss なら Supabase から SELECT。
 */
export async function getJobState(jobId: string): Promise<JobState | null> {
  if (!jobId) return null;
  const cached = cacheGet(jobId);
  if (cached) return cached;
  const supabase = await createServiceRoleClient();
  const { data, error } = await supabase
    .from('generation_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (error) {
    console.warn('[zero-gen-job-store.get.failed]', {
      jobId,
      error_message: error.message,
    });
    return null;
  }
  if (!data) return null;
  const state = rowToState(data as JobRow);
  cacheSet(jobId, state);
  return state;
}

/**
 * 行を削除。Supabase + memCache 両方からクリア。
 */
export async function clearJobState(jobId: string): Promise<void> {
  if (!jobId) return;
  cacheDelete(jobId);
  const supabase = await createServiceRoleClient();
  const { error } = await supabase
    .from('generation_jobs')
    .delete()
    .eq('id', jobId);
  if (error) {
    console.warn('[zero-gen-job-store.clear.failed]', {
      jobId,
      error_message: error.message,
    });
  }
}

/**
 * テスト用: in-memory キャッシュをクリア (Supabase 行は触らない)
 */
export function __resetMemStoreForTests(): void {
  memCache.clear();
}
