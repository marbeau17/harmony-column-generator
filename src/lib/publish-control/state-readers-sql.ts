import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * P5-43: Supabase クエリで「公開対象記事」を絞り込むためのフィルタ群。
 * 既存の reviewed_at IS NOT NULL ベースから移行する際の集約点。
 */

/**
 * .in('visibility_state', ['live','live_hub_stale']) を返す helper.
 * チェーンしやすいよう query builder を受け取って返す.
 *
 * @example
 *   const { data } = await applyPubliclyVisibleFilter(
 *     supabase.from('articles').select('id, slug')
 *   );
 */
export function applyPubliclyVisibleFilter<T extends { in: (col: string, values: readonly string[]) => T }>(query: T): T {
  return query.in('visibility_state', ['live', 'live_hub_stale']);
}

/**
 * Step 2 シャドー期間用: reviewed_at OR visibility_state の片方でも
 * 真なら true (デグレ回避用安全網)。
 * Step 3 完了後に削除予定。
 */
export function applyShadowVisibleFilter<T extends { or: (filter: string) => T }>(query: T): T {
  return query.or('reviewed_at.not.is.null,visibility_state.in.(live,live_hub_stale)');
}
