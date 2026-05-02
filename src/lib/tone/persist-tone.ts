// ============================================================================
// src/lib/tone/persist-tone.ts
// runToneChecks の結果を articles.yukiko_tone_score 列に永続化する。
//
// 制約:
//   * service role クライアントを使用（RLS 越えで UPDATE）
//   * 既存記事の他列（visibility / html_body / title 等）には絶対に触らない
//     → UPDATE 対象を yukiko_tone_score 単一列に限定
//
// バグF (2026-05-02):
//   旧コードは payload を JSON object として書いていたが、yukiko_tone_score は
//   migration `20260501000000_zero_generation_v1.sql` で FLOAT 列として作成され、
//   全クエリ・UI も number 前提で扱っていた。CLI 経由で初めて顕在化（route 経由は
//   先行の insertZeroArticle が scalar を入れていたため気づかれなかった）。
//   scalar `tone.total` のみ書き込む方針に統一。詳細 breakdown / blockers /
//   centroid は ai_generation_log に既に蓄積されており、本列の役割は scalar 値。
// ============================================================================

import { createServiceRoleClient } from '@/lib/supabase/server';
import type { RunToneChecksResult } from '@/lib/tone/run-tone-checks';

/**
 * articles.yukiko_tone_score (FLOAT) に scalar 値を UPDATE する。
 *
 * @param articleId 対象記事 ID
 * @param toneResult runToneChecks() の結果
 */
export async function persistToneScore(
  articleId: string | number,
  toneResult: RunToneChecksResult,
): Promise<void> {
  if (articleId === null || articleId === undefined || articleId === '') {
    throw new Error('persistToneScore: articleId is required');
  }

  const startedAt = Date.now();
  const total = toneResult.tone?.total ?? null;
  console.log('[persist.tone.begin]', { articleId, total });

  const supabase = await createServiceRoleClient();

  const { error } = await supabase
    .from('articles')
    .update({ yukiko_tone_score: total })
    .eq('id', articleId);

  if (error) {
    throw new Error(
      `persistToneScore: update failed for article ${articleId}: ${error.message}`,
    );
  }

  console.log('[persist.tone.end]', {
    articleId,
    ok: true,
    total,
    elapsed_ms: Date.now() - startedAt,
  });
}
