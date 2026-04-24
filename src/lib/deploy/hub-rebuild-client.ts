import type { HubDeployResponse } from '@/types/hub-deploy';

export async function rebuildHub(): Promise<HubDeployResponse> {
  const start = performance.now();

  let res: Response;
  try {
    res = await fetch('/api/hub/deploy', {
      method: 'POST',
      credentials: 'same-origin',
    });
  } catch (err) {
    return {
      success: false,
      error: 'ネットワークエラー',
      stage: 'unknown',
      detail: String(err),
      durationMs: performance.now() - start,
    };
  }

  if (!res.ok) {
    let body: { error?: string } | null = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return {
      success: false,
      error: 'HTTP ' + res.status,
      stage: 'unknown',
      detail: body?.error ?? res.statusText,
      durationMs: performance.now() - start,
    };
  }

  try {
    const body = (await res.json()) as HubDeployResponse;
    return body;
  } catch (err) {
    return {
      success: false,
      error: 'レスポンス解析失敗',
      stage: 'unknown',
      detail: String(err),
      durationMs: performance.now() - start,
    };
  }
}

export function formatHubRebuildResult(r: HubDeployResponse): string {
  if (r.success) {
    return `ハブ再生成: OK (${r.pages}ページ, ${r.articles}記事, ${r.durationMs}ms)`;
  }
  return `ハブ再生成: FAIL [${r.stage}] ${r.error}${r.detail ? ' — ' + r.detail : ''}`;
}
