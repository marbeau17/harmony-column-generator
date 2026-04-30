// ============================================================================
// src/lib/hallucination-retry/retry.ts
// critical claim 残存記事を定期 retry する純ロジック。
//
// 処理フロー:
//   1. articles から `is_hub_visible=false AND status='published'` の記事を抽出し、
//      EXISTS(article_claims with risk='critical') で絞り込む（最大 50 件）
//   2. 各記事に対して runHallucinationChecks を再実行（claim 抽出 + 4 検証）
//   3. critical=0 になった記事は articles.hallucination_score を UPDATE
//   4. 結果サマリ JSON: { retried, resolved, still_critical }
//
// 絶対ルール:
//   - 既存 publish-control コア / articles.ts は変更しない（read-only + score UPDATE のみ）
//   - 既存 hallucination モジュール (run-checks 等) は変更しない（呼び出すのみ）
//   - 記事本文 (stage2_body_html / title) への write は禁止
//   - API キー / トークンをログに出さない
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { runHallucinationChecks as defaultRunHallucinationChecks } from '@/lib/hallucination/run-checks';
import type { HallucinationCheckResult } from '@/lib/hallucination/run-checks';

const MAX_ROWS = 50;

// ─── DI 用ファクトリ ─────────────────────────────────────────────────────────

/**
 * Supabase クライアントの依存性注入用ファクトリ。
 * 既定では service role クライアントを返すが、単体テストで差し替え可能。
 */
export type SupabaseFactory = () => SupabaseClient;

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

/**
 * runHallucinationChecks 関数の差し替え型。テスト時に Gemini / RAG を呼ばずに
 * 結果を擬似返却したい場合に注入する。
 */
export type RunChecksFn = (
  htmlBody: string,
) => Promise<HallucinationCheckResult>;

// ─── 型定義 ──────────────────────────────────────────────────────────────────

interface CandidateRow {
  id: string;
  stage2_body_html: string | null;
}

export interface RetryResult {
  retried: number;
  resolved: number;
  still_critical: number;
}

// ─── 候補抽出 ────────────────────────────────────────────────────────────────

/**
 * critical claim を 1 件以上保持し、かつ未公開（is_hub_visible=false かつ
 * status='published'）の記事 ID を最大 MAX_ROWS 件返す。
 *
 * 実装方針:
 *   - 1 クエリで両条件を満たすには PostgREST の `inner` 結合が必要だが、
 *     supabase-js の型互換を保つため 2 段階で取得する:
 *       (a) article_claims から risk='critical' の article_id 集合を取得
 *       (b) (a) の id を `in` で articles から status/visibility 条件付きで取得
 *   - (a) は claim_text 等を読まず article_id のみ取得（read-only）
 *   - (b) は stage2_body_html を read-only で取得（hallucination 再検証の入力）
 */
async function fetchCandidates(
  supabase: SupabaseClient,
): Promise<CandidateRow[]> {
  // (a) critical claim を持つ article_id 集合
  const { data: claimRows, error: claimErr } = await supabase
    .from('article_claims')
    // guard-approved: read-only select for hallucination retry candidate scan
    .select('article_id')
    .eq('risk', 'critical');

  if (claimErr) {
    throw new Error(`select article_claims failed: ${claimErr.message}`);
  }

  const criticalIds = Array.from(
    new Set(
      ((claimRows ?? []) as Array<{ article_id: string | null }>).map(
        (r) => r.article_id,
      ).filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  );

  if (criticalIds.length === 0) {
    return [];
  }

  // (b) status='published' AND is_hub_visible=false AND id IN (...)
  const { data: articleRows, error: articleErr } = await supabase
    .from('articles')
    // guard-approved: read-only select of hallucination-retry candidates
    .select('id, stage2_body_html')
    .eq('status', 'published')
    .eq('is_hub_visible', false)
    .in('id', criticalIds)
    .limit(MAX_ROWS);

  if (articleErr) {
    throw new Error(`select articles failed: ${articleErr.message}`);
  }

  return (articleRows ?? []) as CandidateRow[];
}

// ─── retry 本体 ──────────────────────────────────────────────────────────────

/**
 * critical claim 残存記事を再検証し、解決した記事の hallucination_score を
 * UPDATE する。1 行ずつ独立処理するため、途中で 1 件失敗しても残りは進める。
 */
export async function runHallucinationRetry(
  supabase: SupabaseClient,
  runChecks: RunChecksFn = defaultRunHallucinationChecks,
): Promise<RetryResult> {
  const candidates = await fetchCandidates(supabase);

  if (candidates.length === 0) {
    return { retried: 0, resolved: 0, still_critical: 0 };
  }

  let resolved = 0;
  let stillCritical = 0;

  for (const row of candidates) {
    const html = (row.stage2_body_html ?? '') as string;

    let result: HallucinationCheckResult;
    try {
      result = await runChecks(html);
    } catch {
      // 1 件失敗しても残りは進める（still_critical 扱い）
      stillCritical += 1;
      continue;
    }

    if (result.criticals === 0) {
      // critical 解消 → hallucination_score のみ UPDATE（本文は触らない）
      const { error: updErr } = await supabase
        .from('articles')
        // guard-approved: hallucination retry score update only
        .update({ hallucination_score: result.hallucination_score })
        .eq('id', row.id);

      if (updErr) {
        // UPDATE 失敗時は still_critical 扱い（解決とはみなさない）
        stillCritical += 1;
        continue;
      }
      resolved += 1;
    } else {
      stillCritical += 1;
    }
  }

  return {
    retried: candidates.length,
    resolved,
    still_critical: stillCritical,
  };
}

// ─── HTTP ハンドラ ───────────────────────────────────────────────────────────

/**
 * Bearer token を検証し、runHallucinationRetry を呼び出す。
 * テストから supabase ファクトリと runChecks を差し替え可能にする。
 */
export async function handleHallucinationRetryRequest(
  req: NextRequest,
  factory: SupabaseFactory = defaultSupabaseFactory,
  runChecks: RunChecksFn = defaultRunHallucinationChecks,
): Promise<NextResponse> {
  const expectedToken = process.env.HALLUCINATION_RETRY_TOKEN;
  if (!expectedToken) {
    return NextResponse.json(
      { error: 'retry token not configured' },
      { status: 500 },
    );
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/.exec(authHeader);
  if (!match || match[1] !== expectedToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const supabase = factory();
    const result = await runHallucinationRetry(supabase, runChecks);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'retry failed', detail: msg },
      { status: 500 },
    );
  }
}
