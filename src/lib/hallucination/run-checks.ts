// ============================================================================
// src/lib/hallucination/run-checks.ts
// ハルシネーション検出パイプライン統合エントリ（spec §6.2）
//
// 本モジュールは以下を 1 関数で束ねる:
//   1. extractClaims(htmlBody)            … 文単位 Claim 抽出（claim-extractor.ts）
//   2. claims を 4 タイプに振り分けて ClaimsPayload に整形
//   3. validateHallucination(payload, deps) … 4 種 validator を並列実行
//   4. 集計結果（hallucination_score / criticals 件数 / claims[]）を返却
//
// 設計方針:
//   - 既存 publish-control コア / articles.ts は変更しない
//   - 既存 hallucination 個別 validator は変更しない（呼び出すのみ）
//   - 記事本文への write は一切行わない（read-only）
//   - retrieveTopK / judgeFn は opts で DI 可能（F4 設計準拠）
// ============================================================================

import { extractClaims as defaultExtractClaims } from './claim-extractor';
import {
  validateHallucination as defaultValidateHallucination,
  validateFactualClaim,
  validateAttributionClaim,
  validateSpiritualClaim,
  validateLogicalPair,
} from './index';
import { logger } from '@/lib/logger';
import type {
  ClaimsPayload,
  ClaimResult,
  ContradictionJudgeFn,
  HallucinationDeps,
  HallucinationResult as ValidateResult,
  RetrieveChunksFn,
  Severity,
} from './types';
import type { Claim } from '@/types/hallucination';

// ─── タイムアウト / slow 検知の閾値 ───────────────────────────────────────
// Stage 3 (75% stuck) の根本原因可視化のため、超過時に warn / error を出す。
const PER_CLAIM_TIMEOUT_MS = 60_000; // 個別 claim verify の上限
const PER_CLAIM_SLOW_MS = 30_000; // 個別 claim が遅いと warn
const RUN_TOTAL_TIMEOUT_MS = 5 * 60_000; // 全体 5 分の保護
const RUN_TOTAL_SLOW_MS = 60_000; // 全体 60s 超で warn

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * 個別 claim の verify を timeout + slow 検知付きで実行する。
 */
async function timedClaimVerify<T extends ClaimResult>(
  validatorName: 'factual' | 'attribution' | 'spiritual' | 'logical',
  claimIdx: number,
  claimText: string,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = Date.now();
  const claim_text_len = claimText.length;
  try {
    const result = await withTimeout(
      fn(),
      PER_CLAIM_TIMEOUT_MS,
      `hallucination.verify_claim.${validatorName}[${claimIdx}]`,
    );
    const elapsed_ms = Date.now() - t0;
    logger.debug('ai', 'hallucination.verify_claim', {
      validator: validatorName,
      claim_idx: claimIdx,
      claim_text_len,
      elapsed_ms,
      verdict: result.verdict,
      severity: result.severity,
      similarity: result.similarity,
    });
    if (elapsed_ms >= PER_CLAIM_SLOW_MS) {
      logger.warn('ai', 'hallucination.claim_slow', {
        validator: validatorName,
        claim_idx: claimIdx,
        claim_text_len,
        elapsed_ms,
        threshold_ms: PER_CLAIM_SLOW_MS,
      });
    }
    return result;
  } catch (err) {
    const elapsed_ms = Date.now() - t0;
    const errObj = err as Error;
    logger.error(
      'ai',
      'hallucination.verify_claim.failed',
      {
        validator: validatorName,
        claim_idx: claimIdx,
        claim_text_len,
        elapsed_ms,
        error_message: errObj?.message,
        stack: errObj?.stack?.slice(0, 500),
      },
      err,
    );
    throw err;
  }
}

// ─── ログ用ヘルパ ───────────────────────────────────────────────────────────

/**
 * 個別 validator グループ（factual / attribution / spiritual / logical）を
 * 計測しつつ実行する。Promise.all の rejection-bubbling 挙動を維持するため、
 * try/catch で時間を測ってログ出力したのち、エラーを再 throw する。
 */
async function runValidatorGroupTimed(
  name: 'factual' | 'attribution' | 'spiritual' | 'logical',
  inputCount: number,
  fn: () => Promise<ClaimResult[]>,
): Promise<ClaimResult[]> {
  const t0 = Date.now();
  logger.info('ai', `hallucination.validator_group.start`, {
    validator: name,
    input_count: inputCount,
  });
  try {
    const results = await fn();
    const elapsed_ms = Date.now() - t0;
    logger.info('ai', `hallucination.validator_group.end`, {
      validator: name,
      input_count: inputCount,
      findings_count: results.length,
      elapsed_ms,
      status: 'ok',
    });
    return results;
  } catch (err) {
    const elapsed_ms = Date.now() - t0;
    const errObj = err as Error;
    logger.error(
      'ai',
      `hallucination.validator_group.failed`,
      {
        validator: name,
        input_count: inputCount,
        elapsed_ms,
        error_message: errObj?.message,
        stack: errObj?.stack?.slice(0, 500),
      },
      err,
    );
    throw err;
  }
}

const SEVERITY_PENALTY: Record<Severity, number> = {
  none: 0,
  low: 3,
  medium: 7,
  high: 15,
  critical: 25,
};

function calcScore(results: ClaimResult[]): number {
  const total = results.reduce((acc, r) => acc + SEVERITY_PENALTY[r.severity], 0);
  return Math.max(0, Math.min(100, 100 - total));
}

function summarizeResults(results: ClaimResult[]): ValidateResult['summary'] {
  return {
    total: results.length,
    grounded: results.filter((r) => r.verdict === 'grounded').length,
    weak: results.filter((r) => r.verdict === 'weak').length,
    unsupported: results.filter((r) => r.verdict === 'unsupported').length,
    flagged: results.filter((r) => r.verdict === 'flagged').length,
    critical_hits: results.filter((r) => r.severity === 'critical').length,
  };
}

// ─── 型定義 ────────────────────────────────────────────────────────────────

/**
 * runHallucinationChecks の戻り値。
 *   - hallucination_score: 0..100（高いほど安全）
 *   - criticals:           critical 重大度の検証結果の件数
 *   - claims:              抽出された Claim 配列（永続化や UI 表示で利用）
 *   - results:             個別 validator の判定結果（ClaimResult[]）
 *   - summary:             validateHallucination の集計サマリ
 */
export interface HallucinationCheckResult {
  hallucination_score: number;
  criticals: number;
  claims: Claim[];
  results: ClaimResult[];
  summary: ValidateResult['summary'];
}

/**
 * runHallucinationChecks に注入できる依存（テスト時に差し替え）。
 *  - retrieveTopK:           F2 の RAG 検索関数（factual 検証で使用）
 *  - judgeFn:                論理矛盾 LLM judge（logical 検証で使用）
 *  - extractClaimsFn:        Claim 抽出関数の差し替え（テスト時 mock 用）
 *  - validateHallucinationFn validator 集約関数の差し替え（テスト時 mock 用）
 */
export interface RunChecksOpts {
  retrieveTopK?: RetrieveChunksFn;
  judgeFn?: ContradictionJudgeFn;
  extractClaimsFn?: typeof defaultExtractClaims;
  validateHallucinationFn?: typeof defaultValidateHallucination;
}

// ─── Claim 振り分け ────────────────────────────────────────────────────────

/**
 * Claim[] を validator が要求する ClaimsPayload に振り分ける。
 *
 *  - factual     → factualClaims
 *  - attribution → attributionClaims
 *  - spiritual   → spiritualClaims
 *  - logical     → logicalPairs（隣接文ペアを構築）
 *  - experience / general は検証対象外（payload に含めない）
 *
 * logicalPairs は「論理主張」と判定された文を、その直前文（sentence_idx-1）と
 * ペアにする。直前文が claims 内に無い場合は、論理文単独で同一文ペアを作るが、
 * validateLogicalPair は同一文を grounded として早期 return するため副作用は無い。
 */
export function buildClaimsPayload(claims: Claim[]): ClaimsPayload {
  const factualClaims: string[] = [];
  const attributionClaims: string[] = [];
  const spiritualClaims: string[] = [];
  const logicalPairs: Array<[string, string]> = [];

  // sentence_idx → claim_text 索引（隣接文ペア構築用）
  const byIdx = new Map<number, string>();
  for (const c of claims) byIdx.set(c.sentence_idx, c.claim_text);

  for (const c of claims) {
    switch (c.claim_type) {
      case 'factual':
        factualClaims.push(c.claim_text);
        break;
      case 'attribution':
        attributionClaims.push(c.claim_text);
        break;
      case 'spiritual':
        spiritualClaims.push(c.claim_text);
        break;
      case 'logical': {
        const prev = byIdx.get(c.sentence_idx - 1);
        if (prev && prev !== c.claim_text) {
          logicalPairs.push([prev, c.claim_text]);
        } else {
          // 隣接文が無い場合は同一文ペア（validator 側で grounded 扱い）
          logicalPairs.push([c.claim_text, c.claim_text]);
        }
        break;
      }
      // experience / general は検証対象外
      default:
        break;
    }
  }

  return { factualClaims, attributionClaims, spiritualClaims, logicalPairs };
}

// ─── メインエントリ ────────────────────────────────────────────────────────

/**
 * 記事 HTML 本文に対し、ハルシネーション検出パイプラインを通しで実行する。
 *
 * @param htmlBody     検査対象の HTML 本文（read-only。書き換えはしない）
 * @param retrieveTopK F2 の RAG 検索関数（factual validator に渡す）
 * @param judgeFn      論理矛盾 LLM judge（logical validator に渡す）
 * @param opts         追加 DI（extractClaims / validateHallucination の差し替え）
 *
 * 引数シグネチャは F4 設計に従い `(htmlBody, retrieveTopK?, judgeFn?)` を採る。
 * テスト時は opts.extractClaimsFn / opts.validateHallucinationFn を差し替えて、
 * Gemini API・DB を一切呼ばずに統合フローを検証できる。
 */
export async function runHallucinationChecks(
  htmlBody: string,
  retrieveTopK?: RetrieveChunksFn,
  judgeFn?: ContradictionJudgeFn,
  opts: Pick<RunChecksOpts, 'extractClaimsFn' | 'validateHallucinationFn'> = {},
): Promise<HallucinationCheckResult> {
  return withTimeout(
    runHallucinationChecksInner(htmlBody, retrieveTopK, judgeFn, opts),
    RUN_TOTAL_TIMEOUT_MS,
    'hallucination.run_checks',
  ).catch((err) => {
    const errObj = err as Error;
    if (errObj?.message?.includes('timed out')) {
      logger.error('ai', 'hallucination.run_checks.failed', {
        error_message: errObj.message,
        timeout_ms: RUN_TOTAL_TIMEOUT_MS,
        phase: 'overall_timeout',
      });
    }
    throw err;
  });
}

async function runHallucinationChecksInner(
  htmlBody: string,
  retrieveTopK: RetrieveChunksFn | undefined,
  judgeFn: ContradictionJudgeFn | undefined,
  opts: Pick<RunChecksOpts, 'extractClaimsFn' | 'validateHallucinationFn'>,
): Promise<HallucinationCheckResult> {
  const extractFn = opts.extractClaimsFn ?? defaultExtractClaims;
  const validateFn = opts.validateHallucinationFn ?? defaultValidateHallucination;
  const useDefaultValidator = !opts.validateHallucinationFn;

  const t_run_start = Date.now();
  logger.info('ai', 'hallucination.run_checks.start', {
    body_chars: htmlBody.length,
    started_at: new Date().toISOString(),
    use_default_validator: useDefaultValidator,
    has_retriever: !!retrieveTopK,
    has_judge: !!judgeFn,
  });

  // step1: claim 抽出（タイミング計測付き）
  const t_claims_start = Date.now();
  let claims: Claim[];
  try {
    claims = await extractFn(htmlBody);
  } catch (err) {
    const errObj = err as Error;
    logger.error(
      'ai',
      'hallucination.run_checks.failed',
      {
        elapsed_ms: Date.now() - t_run_start,
        error_message: errObj?.message,
        stack: errObj?.stack?.slice(0, 500),
        phase: 'extract_claims',
      },
      err,
    );
    throw err;
  }
  const claims_elapsed_ms = Date.now() - t_claims_start;

  // claim_type 別件数を集計（factual / attribution / spiritual / logical）
  const byType = { factual: 0, attribution: 0, spiritual: 0, logical: 0 };
  for (const c of claims) {
    if (c.claim_type === 'factual') byType.factual += 1;
    else if (c.claim_type === 'attribution') byType.attribution += 1;
    else if (c.claim_type === 'spiritual') byType.spiritual += 1;
    else if (c.claim_type === 'logical') byType.logical += 1;
  }
  logger.info('ai', 'hallucination.claims_extracted', {
    claims_count: claims.length,
    by_type: byType,
    elapsed_ms: claims_elapsed_ms,
  });

  // 空入力は score=100 / criticals=0 で早期 return
  if (claims.length === 0) {
    const total_elapsed_ms = Date.now() - t_run_start;
    logger.info('ai', 'hallucination.run_checks.end', {
      hallucination_score: 100,
      claims_count: 0,
      critical_count: 0,
      warning_count: 0,
      elapsed_ms: total_elapsed_ms,
      status: 'empty_claims',
    });
    return {
      hallucination_score: 100,
      criticals: 0,
      claims: [],
      results: [],
      summary: {
        total: 0,
        grounded: 0,
        weak: 0,
        unsupported: 0,
        flagged: 0,
        critical_hits: 0,
      },
    };
  }

  // step2: ClaimsPayload に整形
  const payload = buildClaimsPayload(claims);
  logger.info('ai', 'hallucination.payload_built', {
    factual_count: payload.factualClaims.length,
    attribution_count: payload.attributionClaims.length,
    spiritual_count: payload.spiritualClaims.length,
    logical_pairs_count: payload.logicalPairs.length,
  });

  // step3: 4 種 validator を並列実行
  const deps: HallucinationDeps = {
    retrieveTopK,
    judgeContradiction: judgeFn,
  };

  let result: ValidateResult;
  if (useDefaultValidator) {
    // デフォルト経路: 4 グループを個別に時間計測しつつ並列実行する。
    // 各 claim は per-claim timeout + slow 検知を適用する。
    const all = await Promise.all([
      runValidatorGroupTimed('factual', payload.factualClaims.length, () =>
        Promise.all(
          payload.factualClaims.map((c, idx) =>
            timedClaimVerify('factual', idx, c, () =>
              validateFactualClaim(c, deps.retrieveTopK),
            ),
          ),
        ),
      ),
      runValidatorGroupTimed('attribution', payload.attributionClaims.length, () =>
        Promise.all(
          payload.attributionClaims.map((c, idx) =>
            timedClaimVerify('attribution', idx, c, () =>
              validateAttributionClaim(c),
            ),
          ),
        ),
      ),
      runValidatorGroupTimed('spiritual', payload.spiritualClaims.length, () =>
        Promise.all(
          payload.spiritualClaims.map((c, idx) =>
            timedClaimVerify('spiritual', idx, c, () =>
              validateSpiritualClaim(c),
            ),
          ),
        ),
      ),
      runValidatorGroupTimed('logical', payload.logicalPairs.length, () =>
        Promise.all(
          payload.logicalPairs.map(([a, b], idx) =>
            timedClaimVerify('logical', idx, `${a}|${b}`, () =>
              validateLogicalPair(a, b, deps.judgeContradiction),
            ),
          ),
        ),
      ),
    ]);
    const flatResults: ClaimResult[] = all.flat();
    result = {
      hallucination_score: calcScore(flatResults),
      results: flatResults,
      summary: summarizeResults(flatResults),
    };
  } else {
    // DI 経由（テスト時 mock 等）: 単一呼び出しの既存挙動を維持し、
    // 結果から派生的に per-validator のログを出す（elapsed_ms は合算値）。
    const t_val_start = Date.now();
    try {
      result = await validateFn(payload, deps);
    } catch (err) {
      const elapsed_ms = Date.now() - t_val_start;
      const errObj = err as Error;
      // どの validator が落ちたか不明のため、全体としてエラーを記録する
      logger.error(
        'ai',
        'hallucination.validator_group.failed',
        {
          validator: 'all',
          elapsed_ms,
          error_message: errObj?.message,
          stack: errObj?.stack?.slice(0, 500),
        },
        err,
      );
      throw err;
    }
    const elapsed_ms = Date.now() - t_val_start;
    for (const name of ['factual', 'attribution', 'spiritual', 'logical'] as const) {
      const findings_count = result.results.filter((r) => r.type === name).length;
      logger.info('ai', 'hallucination.validator_group.end', {
        validator: name,
        findings_count,
        elapsed_ms,
        status: 'ok',
        via: 'di',
      });
    }
  }

  // step4: 集計結果を整形して返却
  const total_elapsed_ms = Date.now() - t_run_start;
  const warning_count = result.summary.weak + result.summary.unsupported + result.summary.flagged;
  if (total_elapsed_ms >= RUN_TOTAL_SLOW_MS) {
    logger.warn('ai', 'hallucination.run_slow', {
      elapsed_ms: total_elapsed_ms,
      threshold_ms: RUN_TOTAL_SLOW_MS,
      claims_count: claims.length,
      by_type: byType,
    });
  }
  logger.info('ai', 'hallucination.run_checks.end', {
    hallucination_score: result.hallucination_score,
    claims_count: claims.length,
    critical_count: result.summary.critical_hits,
    warning_count,
    elapsed_ms: total_elapsed_ms,
    status: 'ok',
  });

  return {
    hallucination_score: result.hallucination_score,
    criticals: result.summary.critical_hits,
    claims,
    results: result.results,
    summary: result.summary,
  };
}
