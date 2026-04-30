// ============================================================================
// src/lib/tone/persist-tone.ts
// runToneChecks の結果を articles.yukiko_tone_score 列に永続化する。
//
// 制約:
//   * service role クライアントを使用（RLS 越えで UPDATE）
//   * 既存記事の他列（visibility / html_body / title 等）には絶対に触らない
//     → UPDATE 対象を yukiko_tone_score 単一列に限定
// ============================================================================

import { createServiceRoleClient } from '@/lib/supabase/server';
import type { RunToneChecksResult } from '@/lib/tone/run-tone-checks';

/**
 * articles.yukiko_tone_score を JSONB として UPDATE する。
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

  const supabase = await createServiceRoleClient();

  const payload = {
    total: toneResult.tone.total,
    passed: toneResult.tone.passed,
    blockers: toneResult.tone.blockers,
    breakdown: toneResult.tone.breakdown,
    centroidSimilarity: toneResult.centroidSimilarity,
    overallPassed: toneResult.passed,
    scoredAt: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('articles')
    .update({ yukiko_tone_score: payload })
    .eq('id', articleId);

  if (error) {
    throw new Error(
      `persistToneScore: update failed for article ${articleId}: ${error.message}`,
    );
  }
}
