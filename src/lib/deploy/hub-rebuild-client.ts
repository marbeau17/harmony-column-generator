import type { HubDeployResponse } from '@/types/hub-deploy';
import { logger } from '@/lib/logger';

const TARGET_URL = '/api/hub/deploy';

export async function rebuildHub(traceId?: string): Promise<HubDeployResponse> {
  const start = performance.now();
  // 呼び出し元 (Journey A の visibility ルート / Journey B の bulk-deploy) が trace_id を
  // 渡してきた場合は X-Trace-Id ヘッダで hub/deploy ルートに伝搬し、server 側ログを連結する。
  logger.info('deploy', 'hub_rebuild_client.post.start', {
    target_url: TARGET_URL,
    method: 'POST',
    trace_id: traceId ?? null,
  });

  let res: Response;
  try {
    res = await fetch(TARGET_URL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: traceId ? { 'X-Trace-Id': traceId } : undefined,
    });
  } catch (err) {
    const elapsed_ms = performance.now() - start;
    const error_message = err instanceof Error ? err.message : String(err);
    logger.error(
      'deploy',
      'hub_rebuild_client.post.failed',
      {
        target_url: TARGET_URL,
        elapsed_ms,
        error_message,
        stack: (err as Error)?.stack?.slice(0, 500),
        phase: 'network',
      },
      err,
    );
    return {
      success: false,
      error: 'ネットワークエラー',
      stage: 'unknown',
      detail: String(err),
      durationMs: elapsed_ms,
    };
  }

  if (!res.ok) {
    let body: { error?: string } | null = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const elapsed_ms = performance.now() - start;
    logger.warn('deploy', 'hub_rebuild_client.post.http_error', {
      target_url: TARGET_URL,
      status: res.status,
      status_text: res.statusText,
      elapsed_ms,
      error_message: body?.error ?? res.statusText,
    });
    return {
      success: false,
      error: 'HTTP ' + res.status,
      stage: 'unknown',
      detail: body?.error ?? res.statusText,
      durationMs: elapsed_ms,
    };
  }

  try {
    const body = (await res.json()) as HubDeployResponse;
    const elapsed_ms = performance.now() - start;
    logger.info('deploy', 'hub_rebuild_client.post.end', {
      target_url: TARGET_URL,
      status: res.status,
      elapsed_ms,
      success: body.success,
      pages: body.success ? body.pages : undefined,
      articles: body.success ? body.articles : undefined,
      uploaded: body.success ? body.uploaded : undefined,
      stage: body.success ? undefined : body.stage,
      error_message: body.success ? undefined : body.error,
    });
    return body;
  } catch (err) {
    const elapsed_ms = performance.now() - start;
    const error_message = err instanceof Error ? err.message : String(err);
    logger.error(
      'deploy',
      'hub_rebuild_client.post.parse_failed',
      {
        target_url: TARGET_URL,
        elapsed_ms,
        error_message,
        stack: (err as Error)?.stack?.slice(0, 500),
      },
      err,
    );
    return {
      success: false,
      error: 'レスポンス解析失敗',
      stage: 'unknown',
      detail: String(err),
      durationMs: elapsed_ms,
    };
  }
}

export function formatHubRebuildResult(r: HubDeployResponse): string {
  logger.info('deploy', 'hub_rebuild_client.format.start', {
    success: r.success,
    stage: r.success ? undefined : r.stage,
  });
  if (r.success) {
    return `ハブ再生成: OK (${r.pages}ページ, ${r.articles}記事, ${r.durationMs}ms)`;
  }
  return `ハブ再生成: FAIL [${r.stage}] ${r.error}${r.detail ? ' — ' + r.detail : ''}`;
}
