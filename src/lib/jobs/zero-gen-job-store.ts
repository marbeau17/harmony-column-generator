// ============================================================================
// src/lib/jobs/zero-gen-job-store.ts
//
// ゼロ生成ジョブの進捗状態ストア
//
// 役割:
//   - createJobState(job_id)               : 新規ジョブを 'queued' で作成
//   - updateJobState(job_id, partial)      : 状態を部分更新（マージ）
//   - getJobState(job_id)                  : 現在の状態を取得（無ければ null）
//   - clearJobState(job_id)                : メモリ + ファイルを削除
//
// 永続戦略:
//   - 同一 process 内: in-memory Map が真実の値（高速・原子的）
//   - cross-process / 再起動耐性: tmp/zero-gen-jobs/{job_id}.json に書き出し、
//     in-memory に無い場合のみファイルから読込
//
// 並行制御:
//   - 各 job_id ごとに直列キューを保持（同時に書き込まれても最後の状態に収束）
//   - getJobState は in-memory snapshot を即返し、I/O を待たない
//
// 注意:
//   - 仕様: { stage, progress (0-1), eta_seconds, error?, article_id? }
//   - stage 値: 'queued' | 'stage1' | 'stage2' | 'hallucination' | 'done' | 'failed'
//   - tmp/ ディレクトリは無ければ作る
// ============================================================================

import { promises as fs } from 'fs';
import path from 'path';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

export type JobStage =
  | 'queued'
  | 'stage1'
  | 'stage2'
  | 'hallucination'
  | 'done'
  | 'failed';

export interface JobState {
  stage: JobStage;
  progress: number;        // 0.0 - 1.0
  eta_seconds: number;     // 残り推定秒
  error?: string;
  article_id?: string;
  updated_at: string;      // ISO8601（SSE 側で diff 検出用）
}

// ─── 内部ストレージ ─────────────────────────────────────────────────────────

const memStore: Map<string, JobState> = new Map();
// job_id ごとの直列化チェーン
const writeQueue: Map<string, Promise<void>> = new Map();

function getJobsDir(): string {
  // process.cwd() 配下に固定（Next.js dev / build いずれでもプロジェクトルート）
  return path.join(process.cwd(), 'tmp', 'zero-gen-jobs');
}

function getJobFile(jobId: string): string {
  return path.join(getJobsDir(), `${jobId}.json`);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(getJobsDir(), { recursive: true });
}

async function writeFile(jobId: string, state: JobState): Promise<void> {
  await ensureDir();
  const tmp = getJobFile(jobId) + '.tmp';
  const final = getJobFile(jobId);
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  // rename は POSIX で原子的（同一 FS）
  await fs.rename(tmp, final);
}

async function readFileIfExists(jobId: string): Promise<JobState | null> {
  try {
    const raw = await fs.readFile(getJobFile(jobId), 'utf8');
    const parsed = JSON.parse(raw) as JobState;
    return parsed;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return null;
    // 破損 JSON 等は null 扱い（後続の updateJobState でリセット可能）
    return null;
  }
}

/**
 * job_id 単位で直列化された書き込みを行う。
 * 並行 update を最後の状態に収束させる（race 防止）。
 */
function enqueueWrite(jobId: string, state: JobState): Promise<void> {
  const prev = writeQueue.get(jobId) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined) // 前段失敗でも後続は走らせる
    .then(() => writeFile(jobId, state));
  writeQueue.set(jobId, next);
  // キューの掃除（自身が末尾なら削除）
  void next.finally(() => {
    if (writeQueue.get(jobId) === next) {
      writeQueue.delete(jobId);
    }
  });
  return next;
}

// ─── 公開 API ───────────────────────────────────────────────────────────────

/**
 * 新規ジョブ状態を作成する。既存があっても 'queued' で上書き初期化。
 */
export async function createJobState(jobId: string): Promise<JobState> {
  if (!jobId) throw new Error('jobId is required');
  const state: JobState = {
    stage: 'queued',
    progress: 0,
    eta_seconds: 0,
    updated_at: new Date().toISOString(),
  };
  memStore.set(jobId, state);
  await enqueueWrite(jobId, state);
  return state;
}

/**
 * ジョブ状態を部分更新（マージ）。updated_at は自動更新。
 * 既存が無ければ 'queued' を起点に作成してからマージする。
 */
export async function updateJobState(
  jobId: string,
  partial: Partial<Omit<JobState, 'updated_at'>>,
): Promise<JobState> {
  if (!jobId) throw new Error('jobId is required');

  // 現状取得（mem 優先、無ければファイル）
  let current = memStore.get(jobId);
  if (!current) {
    const fromDisk = await readFileIfExists(jobId);
    current = fromDisk ?? {
      stage: 'queued',
      progress: 0,
      eta_seconds: 0,
      updated_at: new Date().toISOString(),
    };
  }

  const merged: JobState = {
    ...current,
    ...partial,
    updated_at: new Date().toISOString(),
  };

  // progress を 0..1 にクランプ
  if (typeof merged.progress === 'number') {
    if (Number.isNaN(merged.progress)) merged.progress = 0;
    merged.progress = Math.max(0, Math.min(1, merged.progress));
  }
  if (typeof merged.eta_seconds === 'number' && merged.eta_seconds < 0) {
    merged.eta_seconds = 0;
  }

  memStore.set(jobId, merged);
  await enqueueWrite(jobId, merged);
  return merged;
}

/**
 * 現在の状態を取得。
 *   - in-memory にあれば即返す
 *   - 無ければファイルを読み、見つかれば in-memory にも復元する
 *   - 全く存在しなければ null
 */
export async function getJobState(jobId: string): Promise<JobState | null> {
  if (!jobId) return null;
  const mem = memStore.get(jobId);
  if (mem) return mem;
  const disk = await readFileIfExists(jobId);
  if (disk) memStore.set(jobId, disk);
  return disk;
}

/**
 * メモリとファイルの両方からジョブ状態を削除する。
 */
export async function clearJobState(jobId: string): Promise<void> {
  if (!jobId) return;
  memStore.delete(jobId);
  // 書き込みキューが残っていれば完了を待つ（直後の rm との競合回避）
  const pending = writeQueue.get(jobId);
  if (pending) {
    try {
      await pending;
    } catch {
      // ignore
    }
  }
  try {
    await fs.unlink(getJobFile(jobId));
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      // 想定外のエラーは投げ直さない（クリーンアップは best-effort）
    }
  }
}

/**
 * テスト用: in-memory ストアを完全クリア（ファイルは触らない）
 */
export function __resetMemStoreForTests(): void {
  memStore.clear();
  writeQueue.clear();
}
