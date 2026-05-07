import type { VisibilityState } from './state-machine';

/**
 * P5-43: ハブ・sitemap・SSG 等の「公開対象か?」判定の単一ソース。
 * 設計: docs/refactor/publish-control-unification.md §2.3
 */
export function isPubliclyVisible(article: { visibility_state?: string | null }): boolean {
  return article.visibility_state === 'live' || article.visibility_state === 'live_hub_stale';
}

export function isInReview(article: { visibility_state?: string | null }): boolean {
  return article.visibility_state === 'pending_review';
}

/**
 * P5-73: 'live' を deployable に含める。
 *   state machine では既に `live → deploying` が許可されているのに、本 predicate
 *   だけが 'live' を弾いており、UI「FTPアップロード」ボタンで再アップ不能に
 *   なっていた（編集後の差し替え・画像差し込み後の再 FTP 等の正当ユースケースで
 *   422 NOT_DEPLOYABLE が出る）。再デプロイは idempotent な FTP put のため
 *   副作用なし、本リストに追加して整合させる。
 */
export function isDeployable(article: { visibility_state?: string | null }): boolean {
  return ['idle', 'failed', 'live', 'live_hub_stale', 'unpublished'].includes(article.visibility_state ?? '');
}

export function isDraft(article: { visibility_state?: string | null }): boolean {
  return article.visibility_state === 'draft' || !article.visibility_state;
}

/** SQL で使うための公開可視 visibility_state 値のリスト */
export const PUBLICLY_VISIBLE_STATES: readonly VisibilityState[] = ['live', 'live_hub_stale'] as const;
export const DEPLOYABLE_STATES: readonly VisibilityState[] = ['idle', 'failed', 'live', 'live_hub_stale', 'unpublished'] as const;
