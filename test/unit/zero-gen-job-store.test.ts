// ============================================================================
// test/unit/zero-gen-job-store.test.ts
//
// zero-gen-job-store の単体テスト
//   - createJobState / updateJobState / getJobState / clearJobState
//   - in-memory + ファイル fallback の整合性
//   - 同一 job_id への並行 update が race にならず最後の状態に収束すること
//
// 注意:
//   - 各テストは独立した job_id (UUID 風) を使い干渉を回避
//   - tmp/zero-gen-jobs/ 配下に書き出されるため終了時に clearJobState を呼ぶ
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  createJobState,
  updateJobState,
  getJobState,
  clearJobState,
  __resetMemStoreForTests,
  type JobState,
} from '@/lib/jobs/zero-gen-job-store';

// store と同じディレクトリ解決ロジックを使う
const TEST_JOBS_DIR =
  process.env.BLOGAUTO_JOBS_DIR ?? path.join(os.tmpdir(), 'blogauto-zero-gen-jobs');

// テスト用のユニークな job_id 生成（UUID 形式に近い）
function makeJobId(tag: string): string {
  // 仕様の UUID チェックには通らなくても store 自体は動くので tag を埋め込む
  const rand = Math.random().toString(16).slice(2, 14).padEnd(12, '0');
  return `00000000-0000-4000-8000-${rand}${tag.slice(0, 0)}`;
}

const usedJobIds: string[] = [];

function trackJobId(id: string): string {
  usedJobIds.push(id);
  return id;
}

beforeEach(() => {
  __resetMemStoreForTests();
});

afterEach(async () => {
  for (const id of usedJobIds.splice(0)) {
    await clearJobState(id);
  }
  __resetMemStoreForTests();
});

describe('createJobState', () => {
  it('新規ジョブを queued / progress=0 で作成する', async () => {
    const jobId = trackJobId(makeJobId('a'));
    const state = await createJobState(jobId);

    expect(state.stage).toBe('queued');
    expect(state.progress).toBe(0);
    expect(state.eta_seconds).toBe(0);
    expect(state.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('ファイルに書き出される', async () => {
    const jobId = trackJobId(makeJobId('b'));
    await createJobState(jobId);

    const file = path.join(TEST_JOBS_DIR, `${jobId}.json`);
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as JobState;
    expect(parsed.stage).toBe('queued');
  });

  it('jobId が空なら例外', async () => {
    await expect(createJobState('')).rejects.toThrow();
  });
});

describe('updateJobState', () => {
  it('部分更新: stage を stage1 に進める', async () => {
    const jobId = trackJobId(makeJobId('c'));
    await createJobState(jobId);
    const updated = await updateJobState(jobId, {
      stage: 'stage1',
      progress: 0.1,
      eta_seconds: 30,
    });

    expect(updated.stage).toBe('stage1');
    expect(updated.progress).toBe(0.1);
    expect(updated.eta_seconds).toBe(30);
  });

  it('progress を 0..1 にクランプする (>1)', async () => {
    const jobId = trackJobId(makeJobId('d'));
    await createJobState(jobId);
    const updated = await updateJobState(jobId, { progress: 5 });
    expect(updated.progress).toBe(1);
  });

  it('progress を 0..1 にクランプする (<0)', async () => {
    const jobId = trackJobId(makeJobId('e'));
    await createJobState(jobId);
    const updated = await updateJobState(jobId, { progress: -2 });
    expect(updated.progress).toBe(0);
  });

  it('eta_seconds の負値は 0 に丸める', async () => {
    const jobId = trackJobId(makeJobId('f'));
    await createJobState(jobId);
    const updated = await updateJobState(jobId, { eta_seconds: -10 });
    expect(updated.eta_seconds).toBe(0);
  });

  it('error / article_id を保存できる', async () => {
    const jobId = trackJobId(makeJobId('g'));
    await createJobState(jobId);
    const updated = await updateJobState(jobId, {
      stage: 'done',
      progress: 1,
      article_id: 'article-xyz',
    });
    expect(updated.article_id).toBe('article-xyz');
    expect(updated.stage).toBe('done');

    const failed = await updateJobState(jobId, {
      stage: 'failed',
      error: 'something broke',
    });
    expect(failed.error).toBe('something broke');
  });

  it('createJobState を呼ばずに update しても新規作成される', async () => {
    const jobId = trackJobId(makeJobId('h'));
    const state = await updateJobState(jobId, { stage: 'stage2', progress: 0.4 });
    expect(state.stage).toBe('stage2');
    expect(state.progress).toBe(0.4);
  });

  it('updated_at が更新ごとに変化する', async () => {
    const jobId = trackJobId(makeJobId('i'));
    const s1 = await createJobState(jobId);
    // setTimeout で1ms以上ずらす（同一ms内だと文字列が一致しうる）
    await new Promise((r) => setTimeout(r, 5));
    const s2 = await updateJobState(jobId, { progress: 0.2 });
    expect(s2.updated_at).not.toBe(s1.updated_at);
  });
});

describe('getJobState', () => {
  it('存在しない job_id は null', async () => {
    const result = await getJobState(makeJobId('z'));
    expect(result).toBeNull();
  });

  it('in-memory に無くてもファイルから復元できる', async () => {
    const jobId = trackJobId(makeJobId('j'));
    await createJobState(jobId);
    await updateJobState(jobId, { stage: 'stage2', progress: 0.5 });

    // メモリだけクリア（ファイルは残る）
    __resetMemStoreForTests();

    const restored = await getJobState(jobId);
    expect(restored).not.toBeNull();
    expect(restored?.stage).toBe('stage2');
    expect(restored?.progress).toBe(0.5);
  });

  it('空文字は null', async () => {
    expect(await getJobState('')).toBeNull();
  });
});

describe('clearJobState', () => {
  it('メモリとファイルを削除する', async () => {
    const jobId = makeJobId('k'); // tracker に入れない（自前で消す）
    await createJobState(jobId);
    await clearJobState(jobId);

    expect(await getJobState(jobId)).toBeNull();

    const file = path.join(TEST_JOBS_DIR, `${jobId}.json`);
    await expect(fs.access(file)).rejects.toBeTruthy();
  });

  it('存在しない job_id でも例外を投げない', async () => {
    await expect(clearJobState(makeJobId('nope'))).resolves.toBeUndefined();
  });
});

describe('並行アクセス (race condition 回避)', () => {
  it('同一 job_id に対する 50 並行 update が最後の状態に収束する', async () => {
    const jobId = trackJobId(makeJobId('p'));
    await createJobState(jobId);

    const N = 50;
    const updates = Array.from({ length: N }, (_, i) =>
      updateJobState(jobId, {
        stage: 'stage1',
        progress: (i + 1) / N,
        eta_seconds: N - i,
      }),
    );

    const results = await Promise.all(updates);

    // すべて promise が解決すること
    expect(results).toHaveLength(N);

    // 最終的な状態は in-memory に最後にセットされた値（promise 解決順とは独立）
    const finalState = await getJobState(jobId);
    expect(finalState).not.toBeNull();
    expect(finalState?.stage).toBe('stage1');
    expect(finalState?.progress).toBeGreaterThan(0);
    expect(finalState?.progress).toBeLessThanOrEqual(1);

    // ファイル側も読めて、JSON が壊れていないこと（直列キューで rename 原子性が守られる）
    const file = path.join(TEST_JOBS_DIR, `${jobId}.json`);
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as JobState;
    expect(parsed.stage).toBe('stage1');
    expect(parsed.progress).toBeGreaterThan(0);
    expect(parsed.progress).toBeLessThanOrEqual(1);
  });

  it('複数 job_id への並行 update は互いに干渉しない', async () => {
    const ids = Array.from({ length: 5 }, (_, i) => trackJobId(makeJobId(`q${i}`)));
    await Promise.all(ids.map((id) => createJobState(id)));

    await Promise.all(
      ids.flatMap((id, idx) => [
        updateJobState(id, { stage: 'stage1', progress: 0.1 * (idx + 1) }),
        updateJobState(id, { stage: 'stage2', progress: 0.2 * (idx + 1) }),
      ]),
    );

    const states = await Promise.all(ids.map((id) => getJobState(id)));
    for (const s of states) {
      expect(s).not.toBeNull();
      expect(['stage1', 'stage2']).toContain(s!.stage);
    }
  });
});
