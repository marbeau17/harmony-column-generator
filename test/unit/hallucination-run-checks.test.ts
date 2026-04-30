// ============================================================================
// test/unit/hallucination-run-checks.test.ts
// run-checks.ts 統合フローのユニットテスト
//
// 検証観点:
//   - extractClaims / validateHallucination が DI 経由で差し替え可能
//   - claim_type ごとの ClaimsPayload 振り分けが正しい
//   - 5 件 claim → 1 critical → score = 75 となる集計フロー
//   - 空 HTML → score=100 / criticals=0 早期 return
//   - opts.retrieveTopK / opts.judgeFn が validator に伝播
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import {
  buildClaimsPayload,
  runHallucinationChecks,
} from '@/lib/hallucination/run-checks';
import type { Claim } from '@/types/hallucination';
import type {
  ClaimsPayload,
  HallucinationDeps,
  HallucinationResult,
} from '@/lib/hallucination/types';

// ─── buildClaimsPayload ──────────────────────────────────────────────────

describe('buildClaimsPayload', () => {
  it('claim_type ごとに正しく振り分ける', () => {
    const claims: Claim[] = [
      { sentence_idx: 0, claim_text: '2024年は重要な年でした。', claim_type: 'factual' },
      { sentence_idx: 1, claim_text: '田中博士は瞑想を推奨しています。', claim_type: 'attribution' },
      { sentence_idx: 2, claim_text: '波動が高まる感覚があります。', claim_type: 'spiritual' },
      { sentence_idx: 3, claim_text: '今日は晴れ。', claim_type: 'general' },
      { sentence_idx: 4, claim_text: 'だから心が落ち着くのです。', claim_type: 'logical' },
    ];

    const payload = buildClaimsPayload(claims);
    expect(payload.factualClaims).toEqual(['2024年は重要な年でした。']);
    expect(payload.attributionClaims).toEqual(['田中博士は瞑想を推奨しています。']);
    expect(payload.spiritualClaims).toEqual(['波動が高まる感覚があります。']);
    // logical は直前文（idx=3）とペア化される
    expect(payload.logicalPairs).toEqual([['今日は晴れ。', 'だから心が落ち着くのです。']]);
  });

  it('experience / general は payload に含めない', () => {
    const claims: Claim[] = [
      { sentence_idx: 0, claim_text: '私は瞑想を始めました。', claim_type: 'experience' },
      { sentence_idx: 1, claim_text: '皆さんはどう思いますか？', claim_type: 'general' },
    ];
    const payload = buildClaimsPayload(claims);
    expect(payload.factualClaims).toHaveLength(0);
    expect(payload.attributionClaims).toHaveLength(0);
    expect(payload.spiritualClaims).toHaveLength(0);
    expect(payload.logicalPairs).toHaveLength(0);
  });

  it('logical 文の直前文が無ければ同一文ペアを生成（validator 側で grounded 扱い）', () => {
    const claims: Claim[] = [
      { sentence_idx: 5, claim_text: '結論として X である。', claim_type: 'logical' },
    ];
    const payload = buildClaimsPayload(claims);
    expect(payload.logicalPairs).toEqual([['結論として X である。', '結論として X である。']]);
  });
});

// ─── runHallucinationChecks ──────────────────────────────────────────────

describe('runHallucinationChecks', () => {
  it('claims が空なら score=100 / criticals=0 を即座に返す', async () => {
    const extractClaimsFn = vi.fn(async () => [] as Claim[]);
    const validateHallucinationFn = vi.fn();

    const r = await runHallucinationChecks('', undefined, undefined, {
      extractClaimsFn,
      validateHallucinationFn,
    });

    expect(r.hallucination_score).toBe(100);
    expect(r.criticals).toBe(0);
    expect(r.claims).toEqual([]);
    expect(r.results).toEqual([]);
    expect(r.summary.total).toBe(0);
    // 空入力時は validator を呼ばない（短絡評価）
    expect(validateHallucinationFn).not.toHaveBeenCalled();
  });

  it('5 件 claim → 1 critical → hallucination_score=75（統合フロー検証）', async () => {
    // mock: 5 件の Claim を返す
    const claims: Claim[] = [
      { sentence_idx: 0, claim_text: '2024年に発表された統計があります。', claim_type: 'factual' },
      { sentence_idx: 1, claim_text: '田中博士の論文によれば...', claim_type: 'attribution' },
      { sentence_idx: 2, claim_text: '波動が高まる瞬間があります。', claim_type: 'spiritual' },
      { sentence_idx: 3, claim_text: '今日は晴れ。', claim_type: 'general' },
      { sentence_idx: 4, claim_text: 'だから心が落ち着く。', claim_type: 'logical' },
    ];
    const extractClaimsFn = vi.fn(async () => claims);

    // mock: validator は 4 件結果を返す（critical_hits=1, 他は grounded）
    const validateHallucinationFn = vi.fn(
      async (
        _payload: ClaimsPayload,
        _deps?: HallucinationDeps,
      ): Promise<HallucinationResult> => ({
        hallucination_score: 75,
        results: [
          {
            type: 'factual',
            claim: claims[0].claim_text,
            verdict: 'grounded',
            similarity: 0.9,
            severity: 'none',
            evidence: [],
            reason: 'ok',
          },
          {
            type: 'attribution',
            claim: claims[1].claim_text,
            verdict: 'grounded',
            similarity: 1,
            severity: 'none',
            evidence: [],
            reason: 'ok',
          },
          {
            type: 'spiritual',
            claim: claims[2].claim_text,
            verdict: 'flagged',
            similarity: 0,
            severity: 'critical',
            evidence: [],
            reason: 'NG hit',
          },
          {
            type: 'logical',
            claim: claims[4].claim_text,
            verdict: 'grounded',
            similarity: 1,
            severity: 'none',
            evidence: [],
            reason: 'ok',
          },
        ],
        summary: {
          total: 4,
          grounded: 3,
          weak: 0,
          unsupported: 0,
          flagged: 1,
          critical_hits: 1,
        },
      }),
    );

    const r = await runHallucinationChecks(
      '<p>本文。</p>',
      undefined,
      undefined,
      { extractClaimsFn, validateHallucinationFn },
    );

    // Claim 抽出は 1 回呼ばれる
    expect(extractClaimsFn).toHaveBeenCalledTimes(1);
    expect(extractClaimsFn).toHaveBeenCalledWith('<p>本文。</p>');

    // validator は 1 回呼ばれ、payload が正しく振り分けられている
    expect(validateHallucinationFn).toHaveBeenCalledTimes(1);
    const [calledPayload] = validateHallucinationFn.mock.calls[0];
    expect(calledPayload.factualClaims).toHaveLength(1);
    expect(calledPayload.attributionClaims).toHaveLength(1);
    expect(calledPayload.spiritualClaims).toHaveLength(1);
    expect(calledPayload.logicalPairs).toHaveLength(1);

    // 集計結果: 5 件 claim / 1 critical / score=75
    expect(r.claims).toHaveLength(5);
    expect(r.criticals).toBe(1);
    expect(r.hallucination_score).toBe(75);
    expect(r.summary.critical_hits).toBe(1);
    expect(r.summary.flagged).toBe(1);
    expect(r.results).toHaveLength(4);
  });

  it('opts.retrieveTopK / opts.judgeFn が validator の deps に伝播する', async () => {
    const claims: Claim[] = [
      { sentence_idx: 0, claim_text: '2024年です。', claim_type: 'factual' },
    ];
    const extractClaimsFn = vi.fn(async () => claims);

    const retrieveTopK = vi.fn(async () => []);
    const judgeFn = vi.fn(async () => ({ contradiction: false, reason: 'ok' }));

    const validateHallucinationFn = vi.fn(
      async (
        _payload: ClaimsPayload,
        _deps?: HallucinationDeps,
      ): Promise<HallucinationResult> => ({
        hallucination_score: 100,
        results: [],
        summary: {
          total: 0,
          grounded: 0,
          weak: 0,
          unsupported: 0,
          flagged: 0,
          critical_hits: 0,
        },
      }),
    );

    await runHallucinationChecks('<p>x</p>', retrieveTopK, judgeFn, {
      extractClaimsFn,
      validateHallucinationFn,
    });

    const [, deps] = validateHallucinationFn.mock.calls[0];
    expect(deps).toBeDefined();
    expect(deps?.retrieveTopK).toBe(retrieveTopK);
    expect(deps?.judgeContradiction).toBe(judgeFn);
  });

  it('extractClaims が throw した場合は throw を伝播する', async () => {
    const extractClaimsFn = vi.fn(async () => {
      throw new Error('gemini timeout');
    });
    const validateHallucinationFn = vi.fn();

    await expect(
      runHallucinationChecks('<p>x</p>', undefined, undefined, {
        extractClaimsFn,
        validateHallucinationFn,
      }),
    ).rejects.toThrow('gemini timeout');
    expect(validateHallucinationFn).not.toHaveBeenCalled();
  });
});
