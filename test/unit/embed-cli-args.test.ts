/**
 * test/unit/embed-cli-args.test.ts
 *
 * scripts/embed-all-source-chunks.ts の純粋ロジック
 * （CLI フラグパース / コスト見積もり / 進捗ファイル I/O）に対する単体テスト。
 *
 * 実 embedding (Gemini API 呼出) や Supabase 接続は一切行わない。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  parseArgs,
  estimateCost,
  estimateCostRough,
  loadProgress,
  saveProgress,
  EMBEDDING_USD_PER_MTOKEN,
  AVG_TOKENS_PER_CHUNK,
  DEFAULT_PROGRESS_PATH,
  type EmbedProgress,
} from '../../scripts/embed-all-source-chunks';

// ─── parseArgs ──────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('returns defaults when no flags are given', () => {
    const a = parseArgs([]);
    expect(a.limit).toBeUndefined();
    expect(a.batchSize).toBe(10);
    expect(a.progressEvery).toBe(10);
    expect(a.dryRun).toBe(false);
    expect(a.confirm).toBe(false);
    expect(a.resume).toBe(false);
    expect(a.verbose).toBe(false);
    expect(a.progressPath).toBe(DEFAULT_PROGRESS_PATH);
  });

  it('parses --limit=N as integer', () => {
    expect(parseArgs(['--limit=5']).limit).toBe(5);
    expect(parseArgs(['--limit=1499']).limit).toBe(1499);
  });

  it('throws when --limit is zero or negative', () => {
    // 0 は正規表現でマッチした上で <= 0 で reject される想定
    // ※正規表現は \d+ なので "0" はマッチする → throw
    expect(() => parseArgs(['--limit=0'])).toThrow();
  });

  it('parses --batch-size=N', () => {
    const a = parseArgs(['--batch-size=25']);
    expect(a.batchSize).toBe(25);
  });

  it('parses --progress-every=N', () => {
    const a = parseArgs(['--progress-every=50']);
    expect(a.progressEvery).toBe(50);
  });

  it('parses boolean flags', () => {
    const a = parseArgs(['--dry-run', '--confirm', '--resume', '--verbose']);
    expect(a.dryRun).toBe(true);
    expect(a.confirm).toBe(true);
    expect(a.resume).toBe(true);
    expect(a.verbose).toBe(true);
  });

  it('accepts both --dry-run and --dryRun', () => {
    expect(parseArgs(['--dryRun']).dryRun).toBe(true);
    expect(parseArgs(['--dry-run']).dryRun).toBe(true);
  });

  it('parses --progress-path=path', () => {
    const a = parseArgs(['--progress-path=tmp/custom.json']);
    expect(a.progressPath).toBe('tmp/custom.json');
  });

  it('ignores non-flag arguments', () => {
    const a = parseArgs(['node', 'script.ts', '--limit=3']);
    expect(a.limit).toBe(3);
    expect(a.batchSize).toBe(10);
  });

  it('combines multiple flags', () => {
    const a = parseArgs([
      '--limit=100',
      '--batch-size=20',
      '--dry-run',
      '--resume',
    ]);
    expect(a.limit).toBe(100);
    expect(a.batchSize).toBe(20);
    expect(a.dryRun).toBe(true);
    expect(a.resume).toBe(true);
    expect(a.confirm).toBe(false);
  });
});

// ─── estimateCost ───────────────────────────────────────────────────────────

describe('estimateCost', () => {
  it('returns zero metrics for empty input', () => {
    const r = estimateCost([]);
    expect(r.totalArticles).toBe(0);
    expect(r.totalChunks).toBe(0);
    expect(r.totalTokens).toBe(0);
    expect(r.estimatedUsd).toBe(0);
  });

  it('counts chunks for a small article', () => {
    const r = estimateCost([{ content: '短い段落です。\n\nもう一つの段落。' }]);
    expect(r.totalArticles).toBe(1);
    // 段落 2 つ → 2 chunk
    expect(r.totalChunks).toBe(2);
    expect(r.totalTokens).toBeGreaterThan(0);
    expect(r.estimatedUsd).toBeGreaterThan(0);
  });

  it('uses provided pricePerMToken', () => {
    const articles = [{ content: 'a'.repeat(1000) }];
    const cheap = estimateCost(articles, { pricePerMToken: 0 });
    expect(cheap.estimatedUsd).toBe(0);

    const expensive = estimateCost(articles, { pricePerMToken: 1 });
    // 1 USD / 1M tokens で正の値
    expect(expensive.estimatedUsd).toBeGreaterThan(0);
  });

  it('skips empty / non-string content', () => {
    const r = estimateCost([
      { content: '' },
      { content: 'real text' },
      // @ts-expect-error 不正な入力でも安全に動作
      { content: null },
    ]);
    // empty / null は skip し、'real text' のみ処理
    expect(r.totalChunks).toBe(1);
  });

  it('cost scales linearly with content size', () => {
    const small = estimateCost([{ content: 'あ'.repeat(100) }]);
    const big = estimateCost([{ content: 'あ'.repeat(1000) }]);
    expect(big.totalTokens).toBeGreaterThan(small.totalTokens);
    expect(big.estimatedUsd).toBeGreaterThan(small.estimatedUsd);
  });
});

// ─── estimateCostRough ─────────────────────────────────────────────────────

describe('estimateCostRough', () => {
  it('multiplies article count × avg chunks × tokens', () => {
    const r = estimateCostRough(1499, 5);
    expect(r.totalArticles).toBe(1499);
    expect(r.totalChunks).toBe(1499 * 5);
    expect(r.totalTokens).toBe(1499 * 5 * AVG_TOKENS_PER_CHUNK);
    expect(r.estimatedUsd).toBeCloseTo(
      (r.totalTokens / 1_000_000) * EMBEDDING_USD_PER_MTOKEN,
      6,
    );
  });

  it('honors custom pricePerMToken', () => {
    const r = estimateCostRough(100, 3, 0.1);
    const expectedTokens = 100 * 3 * AVG_TOKENS_PER_CHUNK;
    expect(r.totalTokens).toBe(expectedTokens);
    expect(r.estimatedUsd).toBeCloseTo((expectedTokens / 1_000_000) * 0.1, 6);
  });
});

// ─── progress file I/O ──────────────────────────────────────────────────────

describe('progress file I/O', () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = join(tmpdir(), `embed-progress-${Date.now()}-${Math.random()}.json`);
  });

  afterEach(async () => {
    try {
      await fs.unlink(tmpFile);
    } catch {
      // ignore
    }
  });

  it('returns null when file does not exist', async () => {
    const r = await loadProgress(tmpFile);
    expect(r).toBeNull();
  });

  it('saves and reloads a progress object', async () => {
    const prog: EmbedProgress = {
      startedAt: '2026-04-24T00:00:00.000Z',
      updatedAt: '2026-04-24T01:00:00.000Z',
      completedArticleIds: ['a-1', 'a-2', 'a-3'],
      errors: [],
    };
    await saveProgress(tmpFile, prog);
    const reloaded = await loadProgress(tmpFile);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.completedArticleIds).toEqual(['a-1', 'a-2', 'a-3']);
    expect(reloaded?.startedAt).toBe(prog.startedAt);
  });

  it('returns null when JSON is malformed', async () => {
    await fs.writeFile(tmpFile, '{not valid json', 'utf8');
    const r = await loadProgress(tmpFile);
    expect(r).toBeNull();
  });

  it('returns null when JSON shape is invalid', async () => {
    await fs.writeFile(tmpFile, JSON.stringify({ foo: 'bar' }), 'utf8');
    const r = await loadProgress(tmpFile);
    expect(r).toBeNull();
  });

  it('creates parent directory if missing', async () => {
    const nested = join(tmpdir(), `embed-${Date.now()}`, 'sub', 'progress.json');
    const prog: EmbedProgress = {
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedArticleIds: [],
      errors: [],
    };
    await saveProgress(nested, prog);
    const reloaded = await loadProgress(nested);
    expect(reloaded).not.toBeNull();
    // クリーンアップ
    await fs.unlink(nested).catch(() => undefined);
  });
});
