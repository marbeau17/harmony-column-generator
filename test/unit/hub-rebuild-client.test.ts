import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatHubRebuildResult, rebuildHub } from '@/lib/deploy/hub-rebuild-client';
import type { HubDeployResponse } from '@/types/hub-deploy';

/**
 * Build a minimal Response-like object. We do not import node-fetch types —
 * the client only touches `.ok`, `.status`, `.statusText`, and `.json()`.
 */
function mockResponse(opts: {
  ok: boolean;
  status: number;
  statusText?: string;
  body: unknown;
  bodyThrows?: boolean;
}): unknown {
  return {
    ok: opts.ok,
    status: opts.status,
    statusText: opts.statusText ?? '',
    json: async () => {
      if (opts.bodyThrows) throw new Error('invalid json');
      return opts.body;
    },
  };
}

describe('rebuildHub', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns success envelope when fetch responds 200 with success body', async () => {
    const serverBody = {
      success: true,
      pages: 2,
      articles: 12,
      uploaded: 8,
      durationMs: 0, // client passes server body through verbatim
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200, body: serverBody })),
    );

    const result = await rebuildHub();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.pages).toBe(2);
      expect(result.articles).toBe(12);
      expect(result.uploaded).toBe(8);
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns failure envelope when fetch responds 200 with success:false (stage ftp)', async () => {
    const serverBody = {
      success: false,
      error: 'FTP error',
      stage: 'ftp',
      detail: 'connection refused',
      durationMs: 0,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(mockResponse({ ok: true, status: 200, body: serverBody })),
    );

    const result = await rebuildHub();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.stage).toBe('ftp');
      expect(result.error).toBe('FTP error');
      expect(result.detail).toBe('connection refused');
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns failure envelope with stage:"unknown" when fetch responds 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        mockResponse({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          body: { error: 'boom' },
        }),
      ),
    );

    const result = await rebuildHub();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.stage).toBe('unknown');
      expect(result.error).toMatch(/HTTP 500/);
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns failure envelope with stage:"unknown" when fetch throws (network error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );

    const result = await rebuildHub();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.stage).toBe('unknown');
      expect(result.detail ?? '').toContain('Failed to fetch');
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('formatHubRebuildResult', () => {
  it('formats a success result as "ハブ再生成: OK (…ページ, …記事, …ms)"', () => {
    const r: HubDeployResponse = {
      success: true,
      pages: 2,
      articles: 12,
      uploaded: 8,
      durationMs: 137,
    };
    expect(formatHubRebuildResult(r)).toMatch(/^ハブ再生成: OK \(2ページ, 12記事, \d+ms\)$/);
  });

  it('formats a failure with detail as "ハブ再生成: FAIL [stage] error — detail"', () => {
    const r: HubDeployResponse = {
      success: false,
      error: 'FTP error',
      stage: 'ftp',
      detail: 'connection refused',
      durationMs: 42,
    };
    expect(formatHubRebuildResult(r)).toMatch(
      /^ハブ再生成: FAIL \[ftp\] FTP error — connection refused$/,
    );
  });

  it('formats a failure without detail as "ハブ再生成: FAIL [stage] error"', () => {
    const r: HubDeployResponse = {
      success: false,
      error: 'HTTP 500',
      stage: 'unknown',
      durationMs: 10,
    };
    expect(formatHubRebuildResult(r)).toMatch(/^ハブ再生成: FAIL \[unknown\] HTTP 500$/);
  });
});
