// ============================================================================
// src/lib/hallucination/persist-claims.ts
// article_claims テーブルへの claim 永続化（spec §4.2 / §6.2 step3）
//
// 機能:
//   - 既存レコードを DELETE（再生成時の置換）
//   - 受領した Claim[] を service role でバルク INSERT
//   - 既存 publish-control コア / articles.ts は変更しない
//   - 記事本文への write は行わない（article_claims のみ操作）
//
// 注意: テーブルには UNIQUE(article_id, sentence_idx, claim_type) 制約が
//       あるため、再生成時は必ず DELETE → INSERT の順で置換する。
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Claim } from '@/types/hallucination';

// ─── Supabase クライアント ─────────────────────────────────────────────────

/** 単体テストから差し替え可能にするためのファクトリ。 */
export type SupabaseFactory = () => SupabaseClient;

/**
 * 既定の service role クライアント。
 * cookies() を呼ばないため Next.js リクエスト外（バッチ）でも安全に動く。
 */
export const defaultSupabaseFactory: SupabaseFactory = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase service-role credentials are not configured');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

// ─── INSERT 行の整形 ───────────────────────────────────────────────────────

interface ArticleClaimRow {
  article_id: string;
  sentence_idx: number;
  claim_text: string;
  claim_type: Claim['claim_type'];
}

function toRow(articleId: string, claim: Claim): ArticleClaimRow {
  return {
    article_id: articleId,
    sentence_idx: claim.sentence_idx,
    claim_text: claim.claim_text,
    claim_type: claim.claim_type,
  };
}

// ─── メインエントリ ────────────────────────────────────────────────────────

/**
 * article_id に紐づく既存 article_claims を削除した上で、
 * 受領した claims をバルク INSERT する。
 *
 * @param articleId  対象記事 ID（articles.id）
 * @param claims     永続化する Claim 配列。空配列なら DELETE のみ実行する。
 * @param factory    Supabase クライアント生成関数（テスト時に差し替え可）
 *
 * 例外:
 *   - DELETE / INSERT どちらで失敗しても上位へ throw する
 *   - 既存 record の DELETE は ON DELETE CASCADE 配下なので
 *     article 自体は影響を受けない
 */
export async function persistClaims(
  articleId: string,
  claims: Claim[],
  factory: SupabaseFactory = defaultSupabaseFactory,
): Promise<void> {
  if (!articleId) {
    throw new Error('persistClaims: articleId is required');
  }

  const supabase = factory();

  // 既存 record を削除（再生成時の置換）
  const { error: deleteError } = await supabase
    .from('article_claims')
    .delete()
    .eq('article_id', articleId);

  if (deleteError) {
    throw new Error(
      `persistClaims: failed to delete existing claims for article ${articleId}: ${deleteError.message}`,
    );
  }

  // 空配列なら INSERT は skip（DELETE のみで完了）
  if (claims.length === 0) return;

  const rows = claims.map((c) => toRow(articleId, c));

  const { error: insertError } = await supabase
    .from('article_claims')
    .insert(rows);

  if (insertError) {
    throw new Error(
      `persistClaims: failed to insert ${rows.length} claims for article ${articleId}: ${insertError.message}`,
    );
  }
}
