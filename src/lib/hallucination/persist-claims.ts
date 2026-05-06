// ============================================================================
// src/lib/hallucination/persist-claims.ts
// article_claims テーブルへの claim 永続化（spec v2.1 §6.2 step3 / §D17・§D18・§D24）
//
// 機能:
//   - persist_claims_atomic RPC を呼び出し DELETE+INSERT を 1 transaction で実行
//   - Claim ごとに retrieve-chunks の cosine 類似度 / 最良チャンク / evidence JSONB を
//     持ち回して書き込む（factual claim のみ対象。それ以外は NULL）
//   - 既存 publish-control コア / articles.ts は変更しない
//   - 記事本文への write は行わない（article_claims のみ操作）
//
// 互換性:
//   - 旧シグネチャ persistClaims(articleId, claims) はそのまま動く（results 省略時は
//     similarity_score / source_chunk_id / evidence を NULL で書き込む）
//   - 新シグネチャ persistClaims(articleId, claims, { results }) で
//     ClaimResult[] を渡すと evidence/similarity_score を充実させて書き込む
// ============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import type { Claim } from '@/types/hallucination';
import type { ClaimResult, RetrievedChunk } from './types';

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

// ─── 拡張 Claim ペイロード ─────────────────────────────────────────────────
//
// 共有型 (`@/types/hallucination`) は変更禁止 (G2 担当領域) のため、
// persist-claims モジュール内ローカル型として「DB に書く 1 行」を表現する。
// JSONB シリアライズ前提のため、ネストは plain object のみ。

/** evidence JSONB の論理スキーマ。 */
export interface ClaimEvidence {
  /** RAG retrieve のトップヒット chunk id。 */
  source_chunk_id: string | null;
  /** RAG retrieve の cosine 類似度（0..1）。 */
  similarity_score: number | null;
  /** ヒットしたチャンク本文の抜粋（先頭 500 文字）。 */
  raw_excerpt: string | null;
  /** 検証 verdict（grounded / weak / unsupported / flagged）。 */
  verdict?: ClaimResult['verdict'];
  /** severity（none〜critical）。 */
  severity?: ClaimResult['severity'];
  /** 検証理由（人読み）。 */
  reason?: string;
}

/** persist_claims_atomic に渡す JSONB 要素 1 件分。 */
interface ClaimAtomicPayload {
  sentence_idx: number;
  claim_text: string;
  claim_type: Claim['claim_type'] | null;
  risk: 'low' | 'medium' | 'high' | 'critical' | null;
  source_chunk_id: string | null;
  similarity_score: number | null;
  evidence: ClaimEvidence | null;
}

/** ClaimResult.severity → article_claims.risk へのマッピング。 */
function mapSeverityToRisk(
  sev: ClaimResult['severity'] | undefined,
): ClaimAtomicPayload['risk'] {
  switch (sev) {
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'critical':
      return 'critical';
    case 'none':
    case undefined:
    default:
      return null;
  }
}

/**
 * RetrievedChunk[] のうち similarity 最大のものを返す。
 * 空配列なら null を返す。
 */
function pickBestChunk(chunks: RetrievedChunk[] | undefined): RetrievedChunk | null {
  if (!chunks || chunks.length === 0) return null;
  let best = chunks[0];
  for (let i = 1; i < chunks.length; i += 1) {
    if (chunks[i].similarity > best.similarity) best = chunks[i];
  }
  return best;
}

/**
 * Claim と ClaimResult から DB 書込用の atomic payload を構築する。
 * results が無い場合は evidence/similarity_score を NULL にする（後方互換）。
 */
function buildAtomicPayload(
  claim: Claim,
  result: ClaimResult | undefined,
): ClaimAtomicPayload {
  if (!result) {
    return {
      sentence_idx: claim.sentence_idx,
      claim_text: claim.claim_text,
      claim_type: claim.claim_type ?? null,
      risk: null,
      source_chunk_id: null,
      similarity_score: null,
      evidence: null,
    };
  }

  const best = pickBestChunk(result.evidence);
  const sourceChunkId = best?.id ?? null;
  // result.similarity は ClaimResult 共通の score（0..1）。
  // best chunk の similarity と異なる場合があるが、DB の similarity_score 列には
  // 「retrieve-chunks の cosine 値」を入れる仕様 (spec v2.1 §D18) なので
  // best?.similarity を優先し、無ければ result.similarity にフォールバック。
  const similarityScore =
    typeof best?.similarity === 'number'
      ? best.similarity
      : typeof result.similarity === 'number'
        ? result.similarity
        : null;

  const evidence: ClaimEvidence = {
    source_chunk_id: sourceChunkId,
    similarity_score: similarityScore,
    raw_excerpt: best ? truncate(best.content, 500) : null,
    verdict: result.verdict,
    severity: result.severity,
    reason: result.reason,
  };

  return {
    sentence_idx: claim.sentence_idx,
    claim_text: claim.claim_text,
    claim_type: claim.claim_type ?? null,
    risk: mapSeverityToRisk(result.severity),
    source_chunk_id: sourceChunkId,
    similarity_score: similarityScore,
    evidence,
  };
}

function truncate(text: string, maxLen: number): string {
  if (typeof text !== 'string') return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen);
}

/**
 * Claim[] と ClaimResult[] を sentence_idx + claim_text で突き合わせる索引を作る。
 * 完全一致でヒットしないものは undefined になり、後方互換動作（evidence なし）になる。
 */
function indexResults(results: ClaimResult[] | undefined): Map<string, ClaimResult> {
  const map = new Map<string, ClaimResult>();
  if (!results) return map;
  for (const r of results) {
    // ClaimResult.claim は claim_text、ClaimResult.type は claim_type と対応。
    // sentence_idx は ClaimResult 側に存在しないため、claim_text + type で索引する。
    const key = `${r.type}:::${r.claim}`;
    if (!map.has(key)) map.set(key, r);
  }
  return map;
}

function findResultForClaim(
  claim: Claim,
  index: Map<string, ClaimResult>,
): ClaimResult | undefined {
  // claim_type が ClaimResult.type と一致する型のみマッチ可能。
  // experience / general は検証対象外なので必ず undefined。
  const key = `${claim.claim_type}:::${claim.claim_text}`;
  return index.get(key);
}

// ─── メインエントリ ────────────────────────────────────────────────────────

/** persistClaims のオプション引数。 */
export interface PersistClaimsOpts {
  /** Supabase クライアント生成関数（テスト時に差し替え可）。 */
  factory?: SupabaseFactory;
  /**
   * runHallucinationChecks 由来の ClaimResult[]。
   * 渡された場合、claim ごとに evidence / similarity_score / risk を充実させる。
   */
  results?: ClaimResult[];
}

/**
 * article_id に紐づく既存 article_claims を削除した上で、
 * 受領した claims をバルク INSERT する（1 transaction）。
 *
 * @param articleId 対象記事 ID（articles.id）
 * @param claims    永続化する Claim 配列。空配列なら DELETE のみ実行する。
 * @param opts      Supabase クライアント / ClaimResult 補強情報
 *
 * 後方互換:
 *   旧シグネチャ persistClaims(articleId, claims, factory) もサポートする。
 *   第 3 引数が関数の場合は SupabaseFactory として扱う。
 *
 * 例外:
 *   - RPC 呼び出しで失敗した場合は throw する
 *   - DELETE+INSERT は RPC 内で 1 transaction なので partial state は残らない
 */
export async function persistClaims(
  articleId: string,
  claims: Claim[],
  optsOrFactory: PersistClaimsOpts | SupabaseFactory = {},
): Promise<void> {
  const opts: PersistClaimsOpts =
    typeof optsOrFactory === 'function'
      ? { factory: optsOrFactory }
      : optsOrFactory;
  const factory = opts.factory ?? defaultSupabaseFactory;
  const results = opts.results;

  const startedAt = Date.now();
  logger.info('ai', 'hallucination.persist_claims.start', {
    article_id: articleId,
    claims_count: claims.length,
    has_results: !!(results && results.length > 0),
  });

  if (!articleId) {
    logger.error('ai', 'hallucination.persist_claims.failed', {
      elapsed_ms: Date.now() - startedAt,
      error_message: 'articleId is required',
    });
    throw new Error('persistClaims: articleId is required');
  }

  let supabase: SupabaseClient;
  try {
    supabase = factory();
  } catch (err) {
    const errObj = err as Error;
    logger.error(
      'ai',
      'hallucination.persist_claims.failed',
      {
        article_id: articleId,
        elapsed_ms: Date.now() - startedAt,
        error_message: errObj?.message,
        stack: errObj?.stack?.slice(0, 500),
        phase: 'factory',
      },
      err,
    );
    throw err;
  }

  // 1. ClaimResult を sentence_idx + claim_text で索引化
  const resultIndex = indexResults(results);

  // 2. 各 Claim を JSONB 行に整形
  const payload: ClaimAtomicPayload[] = claims.map((c) =>
    buildAtomicPayload(c, findResultForClaim(c, resultIndex)),
  );

  // 3. RPC で atomic DELETE+INSERT
  const { data, error } = await supabase.rpc('persist_claims_atomic', {
    p_article_id: articleId,
    p_claims: payload,
  });

  if (error) {
    logger.error('ai', 'hallucination.persist_claims.failed', {
      article_id: articleId,
      elapsed_ms: Date.now() - startedAt,
      error_message: error.message,
      rows_count: payload.length,
      phase: 'rpc',
    });
    throw new Error(
      `persistClaims: persist_claims_atomic failed for article ${articleId}: ${error.message}`,
    );
  }

  // RPC は INSERT した件数を返す（DELETE のみのときは 0）。
  // payload 0 件なら 0 が返ってくるのが正しいので status を分岐する。
  const inserted = typeof data === 'number' ? data : payload.length;
  const status =
    payload.length === 0
      ? 'delete_only'
      : results && results.length > 0
        ? 'ok_with_evidence'
        : 'ok';

  logger.info('ai', 'hallucination.persist_claims.end', {
    article_id: articleId,
    elapsed_ms: Date.now() - startedAt,
    inserted,
    payload_size: payload.length,
    status,
  });
}
