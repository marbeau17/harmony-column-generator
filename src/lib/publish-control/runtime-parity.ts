// ============================================================================
// src/lib/publish-control/runtime-parity.ts
// P5-43 Step 2: 実行時 parity アサート用ヘルパー (シャドー期間)
// ============================================================================

import { logger } from '@/lib/logger';

interface ArticleStateSnapshot {
  id: string;
  reviewed_at: string | null;
  visibility_state: string | null;
}

/**
 * P5-43 Step 2: reviewed_at と visibility_state の parity チェック。
 * 不整合をログに出すだけで動作はブロックしない (シャドー期間用)。
 *
 * 使う場所: API ルートで article fetch 直後、UI で article 表示直前など。
 *
 * 注: logger カテゴリ 'publish-control' は未定義のため 'deploy' を使用する。
 */
export function assertStateParity(article: ArticleStateSnapshot): { ok: boolean; mismatch?: string } {
  const reviewed = article.reviewed_at != null;
  const publiclyVisible =
    article.visibility_state === 'live' || article.visibility_state === 'live_hub_stale';
  if (reviewed !== publiclyVisible) {
    logger.warn('deploy', 'state-parity-mismatch', {
      articleId: article.id,
      reviewed_at: article.reviewed_at,
      visibility_state: article.visibility_state,
    });
    return { ok: false, mismatch: `reviewed=${reviewed} != publiclyVisible=${publiclyVisible}` };
  }
  return { ok: true };
}
