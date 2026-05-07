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
import { logger } from '@/lib/logger';
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
  const startedAt = Date.now();
  logger.info('db', 'cta_variants.persist.start', {
    article_id: articleId,
    variants_count: Array.isArray(variants) ? variants.length : null,
  });

  if (!articleId || articleId.trim() === '') {
    logger.error('db', 'cta_variants.persist.failed', {
      elapsed_ms: Date.now() - startedAt,
      error_message: 'articleId is required',
      phase: 'validate_input',
    });
    throw new Error('persistCtaVariants: articleId is required');
  }
  if (!Array.isArray(variants) || variants.length === 0) {
    logger.error('db', 'cta_variants.persist.failed', {
      article_id: articleId,
      elapsed_ms: Date.now() - startedAt,
      error_message: 'variants must be a non-empty array',
      phase: 'validate_input',
    });
    throw new Error('persistCtaVariants: variants must be a non-empty array');
  }

  try {
    const supabase = await createServiceRoleClient();

    // ─── 既存レコードを削除 (DELETE+INSERT) ─────────────────────────────────
    const { error: deleteError } = await supabase
      .from('cta_variants')
      .delete()
      .eq('article_id', articleId);

    if (deleteError) {
      logger.error('db', 'cta_variants.persist.failed', {
        article_id: articleId,
        elapsed_ms: Date.now() - startedAt,
        error_message: deleteError.message,
        code: (deleteError as { code?: string }).code,
        phase: 'delete',
      });
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
      logger.error('db', 'cta_variants.persist.failed', {
        article_id: articleId,
        elapsed_ms: Date.now() - startedAt,
        error_message: insertError.message,
        code: (insertError as { code?: string }).code,
        rows_count: rows.length,
        phase: 'insert',
      });
      throw new Error(
        `persistCtaVariants: insert failed for article ${articleId}: ${insertError.message}`,
      );
    }

    logger.info('db', 'cta_variants.persist.end', {
      article_id: articleId,
      inserted: rows.length,
      elapsed_ms: Date.now() - startedAt,
    });
  } catch (err) {
    const e = err as Error;
    // 上の error 分岐で既にログ済みのケースもあるが、createServiceRoleClient 等の
    // 予期せぬ例外を確実に拾うため再ログ（duplicate でも silent failure よりまし）
    if (!/persistCtaVariants:/.test(e?.message ?? '')) {
      logger.error(
        'db',
        'cta_variants.persist.failed',
        {
          article_id: articleId,
          elapsed_ms: Date.now() - startedAt,
          error_message: e?.message ?? String(err),
          stack: e?.stack?.slice(0, 500),
          phase: 'unexpected',
        },
        err,
      );
    }
    throw err;
  }
}
