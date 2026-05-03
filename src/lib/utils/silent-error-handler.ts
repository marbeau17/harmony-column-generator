// ============================================================================
// src/lib/utils/silent-error-handler.ts
// P5-62: silent failure 防止用の共通 catch ヘルパー
// ============================================================================

import { logger } from '@/lib/logger';

/**
 * P5-62: Silent failure を防止する標準 catch handler。
 * fire-and-forget な promise chain で error を握り潰す代わりに、
 * 必ず logger.warn で記録する。
 *
 * @example
 *   void doAsyncWork().catch(logAndIgnore('background_sync', { jobId }));
 *
 * @param context どこで発生した silent catch かを示す識別子（必須）
 * @param extra 追加で記録したい構造化メタデータ（任意）
 * @returns Promise.catch にそのまま渡せる error handler
 */
export function logAndIgnore(context: string, extra?: Record<string, unknown>) {
  return (err: unknown) => {
    logger.warn('utility', 'silent_caught', {
      context,
      message: err instanceof Error ? err.message : String(err),
      ...extra,
    });
  };
}
