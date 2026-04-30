// ============================================================================
// test/unit/prompt-cache-manager.test.ts
// Generator H10: Gemini Context Cache マネージャの単体テスト
// fetch を vi.stubGlobal で stub し、key 単位の取得 / メモリヒット /
// TTL 期限切れ再作成 / invalidate を検証する。
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetPromptCacheForTesting,
  getOrCreatePromptCache,
  invalidatePromptCache,
} from '@/lib/ai/prompt-cache-manager';

const SYSTEM_PROMPT = 'あなたはスピリチュアルコラムのライターです。'.repeat(200);

function mockCacheCreateResponse(name: string, expireTime: string): unknown {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => '',
    json: async () => ({
      name,
      expireTime,
      usageMetadata: { totalTokenCount: 4096 },
    }),
  };
}

describe('prompt-cache-manager', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key-XXX';
    _resetPromptCacheForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetPromptCacheForTesting();
  });

  it('初回呼び出しで cachedContents API を 1 回叩き cacheName を返す', async () => {
    const expireTime = new Date(Date.now() + 3600 * 1000).toISOString();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockCacheCreateResponse('cachedContents/abc-1', expireTime));
    vi.stubGlobal('fetch', fetchMock);

    const name = await getOrCreatePromptCache('stage1-system', SYSTEM_PROMPT);

    expect(name).toBe('cachedContents/abc-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 呼び出し URL に cachedContents が含まれる & method=POST
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/v1beta\/cachedContents\?key=/);
    expect((init as { method: string }).method).toBe('POST');

    // body に systemInstruction と TTL（秒指定）が入っている
    const body = JSON.parse((init as { body: string }).body);
    expect(body.systemInstruction.parts[0].text).toBe(SYSTEM_PROMPT);
    expect(body.ttl).toMatch(/^\d+s$/);
  });

  it('2 回目はメモリヒットして fetch を再度叩かない', async () => {
    const expireTime = new Date(Date.now() + 3600 * 1000).toISOString();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockCacheCreateResponse('cachedContents/abc-2', expireTime));
    vi.stubGlobal('fetch', fetchMock);

    const first = await getOrCreatePromptCache('stage1-system', SYSTEM_PROMPT);
    const second = await getOrCreatePromptCache('stage1-system', SYSTEM_PROMPT);

    expect(first).toBe(second);
    expect(first).toBe('cachedContents/abc-2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('別 key は別エントリとして扱われ、それぞれ作成される', async () => {
    const expireTime = new Date(Date.now() + 3600 * 1000).toISOString();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockCacheCreateResponse('cachedContents/k1', expireTime))
      .mockResolvedValueOnce(mockCacheCreateResponse('cachedContents/k2', expireTime));
    vi.stubGlobal('fetch', fetchMock);

    const a = await getOrCreatePromptCache('stage1-system', SYSTEM_PROMPT);
    const b = await getOrCreatePromptCache('stage2-system', SYSTEM_PROMPT);

    expect(a).toBe('cachedContents/k1');
    expect(b).toBe('cachedContents/k2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('TTL 期限切れに近づくと再作成する（now を進めて検証）', async () => {
    const baseNow = 1_700_000_000_000; // 任意基準
    // 1 秒後に切れるエントリを作る → 安全マージン 30s 以下なので即再作成扱い
    const expireSoon = new Date(baseNow + 1_000).toISOString();
    const expireFar = new Date(baseNow + 3_600_000).toISOString();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockCacheCreateResponse('cachedContents/old', expireSoon))
      .mockResolvedValueOnce(mockCacheCreateResponse('cachedContents/new', expireFar));
    vi.stubGlobal('fetch', fetchMock);

    const first = await getOrCreatePromptCache('stage1-system', SYSTEM_PROMPT, {
      now: () => baseNow,
    });
    expect(first).toBe('cachedContents/old');

    // baseNow から十分時間が経過し expireSoon を過ぎたとして呼ぶ
    const second = await getOrCreatePromptCache('stage1-system', SYSTEM_PROMPT, {
      now: () => baseNow + 60_000,
    });
    expect(second).toBe('cachedContents/new');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidatePromptCache 後は再度 fetch される', async () => {
    const expireTime = new Date(Date.now() + 3600 * 1000).toISOString();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockCacheCreateResponse('cachedContents/v1', expireTime))
      .mockResolvedValueOnce(mockCacheCreateResponse('cachedContents/v2', expireTime));
    vi.stubGlobal('fetch', fetchMock);

    const v1 = await getOrCreatePromptCache('stage1-system', SYSTEM_PROMPT);
    expect(v1).toBe('cachedContents/v1');

    invalidatePromptCache('stage1-system');

    const v2 = await getOrCreatePromptCache('stage1-system', SYSTEM_PROMPT);
    expect(v2).toBe('cachedContents/v2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('空文字 key / systemPrompt は throw する', async () => {
    await expect(getOrCreatePromptCache('', SYSTEM_PROMPT)).rejects.toThrow(
      /key must be non-empty/,
    );
    await expect(getOrCreatePromptCache('k', '')).rejects.toThrow(
      /systemPrompt must be non-empty/,
    );
  });
});
