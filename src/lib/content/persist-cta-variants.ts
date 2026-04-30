// ============================================================================
// src/lib/content/persist-cta-variants.ts
//
// G9: cta_variants テーブルへ INSERT する永続化レイヤ。
//
// 設計:
//   - 既存 record があれば DELETE → INSERT (バリアントは記事ごとに 3 件で固定)
//   - service role クライアント使用 (RLS バイパス)
//   - 記事本文 (articles.html_body / title 等) には絶対に触らない
//   - cta_variants テーブル以外への書き込みは行わない
//
// 参考スキーマ (supabase/migrations/20260501000000_zero_generation_v1.sql):
//   CREATE TABLE cta_variants (
//     id            UUID PK DEFAULT gen_random_uuid(),
//     article_id    UUID NOT NULL FK articles(id) ON DELETE CASCADE,
//     position      SMALLINT CHECK (1,2,3),
//     persona_id    UUID FK personas(id),
//     stage         TEXT  CHECK ('empathy','transition','action'),
//     copy_text     TEXT NOT NULL,
//     micro_copy    TEXT,
//     variant_label TEXT,
//     utm_content   TEXT,
//     impressions   INT DEFAULT 0,
//     clicks        INT DEFAULT 0,
//     created_at    TIMESTAMPTZ DEFAULT NOW()
//   );
// ============================================================================

import { createServiceRoleClient } from '@/lib/supabase/server';
import type { CtaVariant } from '@/lib/content/cta-variants-generator';

/**
 * cta_variants へ 3 バリアントを永続化する。
 *
 * @param articleId 対象記事の UUID
 * @param variants generateCtaVariants の戻り値
 * @throws DELETE / INSERT に失敗した場合 Error を投げる
 */
export async function persistCtaVariants(
  articleId: string,
  variants: CtaVariant[],
): Promise<void> {
  if (!articleId || articleId.trim() === '') {
    throw new Error('persistCtaVariants: articleId is required');
  }
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new Error('persistCtaVariants: variants must be a non-empty array');
  }

  const supabase = await createServiceRoleClient();

  // ─── 既存レコードを削除 (DELETE+INSERT) ─────────────────────────────────
  const { error: deleteError } = await supabase
    .from('cta_variants')
    .delete()
    .eq('article_id', articleId);

  if (deleteError) {
    throw new Error(
      `persistCtaVariants: delete failed for article ${articleId}: ${deleteError.message}`,
    );
  }

  // ─── 新規 3 行を INSERT ─────────────────────────────────────────────────
  const rows = variants.map((v) => ({
    article_id: articleId,
    position: v.position,
    persona_id: v.persona_id,
    stage: v.stage,
    copy_text: v.copy_text,
    micro_copy: v.micro_copy,
    variant_label: v.variant_label,
    utm_content: v.utm_content,
  }));

  const { error: insertError } = await supabase
    .from('cta_variants')
    .insert(rows);

  if (insertError) {
    throw new Error(
      `persistCtaVariants: insert failed for article ${articleId}: ${insertError.message}`,
    );
  }
}
