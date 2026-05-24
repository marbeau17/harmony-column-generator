/**
 * Gemini API key fallback (GEMINI_API_KEY → GEMINI_API_KEY1 → ...) pin
 *
 * 2026-05-24 本番事故 — primary key が monthly spending cap (429 RESOURCE_EXHAUSTED)
 * に到達して全 generateContent が失敗 (記事生成不能)。
 * gemini-client にフォールバックチェーンを追加し、quota 系 429 を踏んだら
 * 同 invocation 内で次の key (GEMINI_API_KEY1/2/3) に自動切替する。
 *
 * 本テストは以下を pin:
 *  (1) primary 200 → fallback には触らない
 *  (2) primary 429 RESOURCE_EXHAUSTED → fallback に switch して 200
 *  (3) primary 429 + fallback 429 → 全部 exhausted で最終 throw
 *  (4) 429 でも RESOURCE_EXHAUSTED じゃない (rate limit 系) → fallback せず通常 retry
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callGemini, resetGeminiApiKeyState } from '@/lib/ai/gemini-client';

const ORIG_FETCH = globalThis.fetch;

function makeResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const OK_BODY = {
  candidates: [
    {
      content: { parts: [{ text: 'ok' }] },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: {
    promptTokenCount: 10,
    candidatesTokenCount: 5,
    totalTokenCount: 15,
  },
};

const QUOTA_BODY = {
  error: {
    code: 429,
    message:
      'Your project has exceeded its monthly spending cap. Please go to AI Studio at https://ai.studio/spend to manage your project spend cap.',
    status: 'RESOURCE_EXHAUSTED',
  },
};

describe('callGemini API key fallback chain', () => {
  beforeEach(() => {
    resetGeminiApiKeyState();
    process.env.GEMINI_API_KEY = 'AIzaPRIMARY';
    process.env.GEMINI_API_KEY1 = 'AIzaFALLBACK1';
  });

  afterEach(() => {
    globalThis.fetch = ORIG_FETCH;
    delete process.env.GEMINI_API_KEY1;
  });

  it('(1) primary 200 → fallback には触らない', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      return makeResponse(200, OK_BODY);
    }) as unknown as typeof fetch;

    await callGemini({
      systemInstruction: 's',
      messages: [{ role: 'user', parts: [{ text: 'u' }] }],
    });

    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('key=AIzaPRIMARY');
  });

  it('(2b) primary 403 CONSUMER_SUSPENDED → fallback に switch して 200', async () => {
    // 2026-05-24 本番事故: KEY1 の GCP project が suspended で 403 を返した
    const SUSPENDED_BODY = {
      error: {
        code: 403,
        message: "Permission denied: Consumer 'api_key:AIzaXXX' has been suspended.",
        status: 'PERMISSION_DENIED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason: 'CONSUMER_SUSPENDED',
            domain: 'googleapis.com',
          },
        ],
      },
    };
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      if (calls.length === 1) return makeResponse(403, SUSPENDED_BODY);
      return makeResponse(200, OK_BODY);
    }) as unknown as typeof fetch;

    const res = await callGemini({
      systemInstruction: 's',
      messages: [{ role: 'user', parts: [{ text: 'u' }] }],
    });

    expect(calls.length).toBe(2);
    expect(calls[0]).toContain('key=AIzaPRIMARY');
    expect(calls[1]).toContain('key=AIzaFALLBACK1');
    expect(res.text).toBe('ok');
  });

  it('(2) primary 429 RESOURCE_EXHAUSTED → fallback に switch して 200', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      if (calls.length === 1) return makeResponse(429, QUOTA_BODY);
      return makeResponse(200, OK_BODY);
    }) as unknown as typeof fetch;

    const res = await callGemini({
      systemInstruction: 's',
      messages: [{ role: 'user', parts: [{ text: 'u' }] }],
    });

    expect(calls.length).toBe(2);
    expect(calls[0]).toContain('key=AIzaPRIMARY');
    expect(calls[1]).toContain('key=AIzaFALLBACK1');
    expect(res.text).toBe('ok');
  });

  it('(3) primary 429 + fallback 429 → 全 exhausted で最終 throw', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      return makeResponse(429, QUOTA_BODY);
    }) as unknown as typeof fetch;

    await expect(
      callGemini({
        systemInstruction: 's',
        messages: [{ role: 'user', parts: [{ text: 'u' }] }],
      }),
    ).rejects.toThrow(/Gemini API error 429/);

    // primary + fallback = 2 keys = 2 fetch calls (それぞれ違う key で 1 回ずつ)
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain('key=AIzaPRIMARY');
    expect(calls[1]).toContain('key=AIzaFALLBACK1');
  });

  it('(4) 429 でも RESOURCE_EXHAUSTED 以外 (rate limit) → fallback せず通常 retry', async () => {
    // rate-limit error body — RESOURCE_EXHAUSTED や spending cap を含まない
    const RATE_LIMIT_BODY = {
      error: {
        code: 429,
        message: 'Quota exceeded for quota metric "Requests per minute"',
        status: 'TOO_MANY_REQUESTS',
      },
    };
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      return makeResponse(429, RATE_LIMIT_BODY);
    }) as unknown as typeof fetch;

    await expect(
      callGemini({
        systemInstruction: 's',
        messages: [{ role: 'user', parts: [{ text: 'u' }] }],
      }),
    ).rejects.toThrow();

    // 通常 retry: maxRetries=1 → 2 attempt 両方 primary key を使用 (key switch しない)
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain('key=AIzaPRIMARY');
    expect(calls[1]).toContain('key=AIzaPRIMARY');
  });

  it('GEMINI_API_KEY1 未設定 + quota cap → fail fast (1 call, retry無意味)', async () => {
    delete process.env.GEMINI_API_KEY1;
    resetGeminiApiKeyState();

    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url));
      return makeResponse(429, QUOTA_BODY);
    }) as unknown as typeof fetch;

    await expect(
      callGemini({
        systemInstruction: 's',
        messages: [{ role: 'user', parts: [{ text: 'u' }] }],
      }),
    ).rejects.toThrow(/all keys exhausted/);

    // 1 key で quota cap → all_keys_exhausted で即 throw (delay-retry しても無駄)
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('key=AIzaPRIMARY');
  });
});
