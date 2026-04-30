// ============================================================================
// test/unit/hallucination-validators.test.ts
// ハルシネーション検証層 (spec §6) のユニットテスト
// ============================================================================

import { describe, it, expect, vi } from 'vitest';
import { validateFactualClaim } from '@/lib/hallucination/validators/factual';
import { validateAttributionClaim } from '@/lib/hallucination/validators/attribution';
import {
  validateSpiritualClaim,
  __test__ as spiritualInternals,
} from '@/lib/hallucination/validators/spiritual';
import { validateLogicalPair } from '@/lib/hallucination/validators/logical';
import { validateHallucination } from '@/lib/hallucination';
import type {
  ContradictionJudgeFn,
  RetrieveChunksFn,
} from '@/lib/hallucination/types';

// ─── factual ─────────────────────────────────────────────────────────────

describe('validateFactualClaim', () => {
  it('数値も固有名詞も無い場合は検証対象外として grounded を返す', async () => {
    const r = await validateFactualClaim('今日は穏やかな一日でした。');
    expect(r.verdict).toBe('grounded');
    expect(r.severity).toBe('none');
  });

  it('similarity >= 0.75 → grounded', async () => {
    const retrieve: RetrieveChunksFn = vi.fn(async () => [
      { id: 'c1', content: 'sample', similarity: 0.82 },
    ]);
    const r = await validateFactualClaim(
      '2024年に小林由起子さんが講演を行いました。',
      retrieve
    );
    expect(r.verdict).toBe('grounded');
    expect(r.severity).toBe('none');
  });

  it('0.65 <= similarity < 0.75 → weak / medium', async () => {
    const retrieve: RetrieveChunksFn = vi.fn(async () => [
      { id: 'c1', content: 'sample', similarity: 0.7 },
    ]);
    const r = await validateFactualClaim(
      '2024年のイベントは盛況でした。',
      retrieve
    );
    expect(r.verdict).toBe('weak');
    expect(r.severity).toBe('medium');
  });

  it('similarity < 0.65 → unsupported / high', async () => {
    const retrieve: RetrieveChunksFn = vi.fn(async () => [
      { id: 'c1', content: 'sample', similarity: 0.4 },
    ]);
    const r = await validateFactualClaim(
      '2024年に大きな出来事がありました。',
      retrieve
    );
    expect(r.verdict).toBe('unsupported');
    expect(r.severity).toBe('high');
  });

  it('境界値 0.65 ちょうどは weak', async () => {
    const retrieve: RetrieveChunksFn = vi.fn(async () => [
      { id: 'c1', content: 'sample', similarity: 0.65 },
    ]);
    const r = await validateFactualClaim('30%の方が回答しました。', retrieve);
    expect(r.verdict).toBe('weak');
  });

  it('境界値 0.75 ちょうどは grounded', async () => {
    const retrieve: RetrieveChunksFn = vi.fn(async () => [
      { id: 'c1', content: 'sample', similarity: 0.75 },
    ]);
    const r = await validateFactualClaim('30%の方が回答しました。', retrieve);
    expect(r.verdict).toBe('grounded');
  });

  it('retrieveTopK 未指定でもクラッシュしない（fallback）', async () => {
    const r = await validateFactualClaim('30%の方が回答しました。');
    // fallback は空配列を返すため unsupported
    expect(r.verdict).toBe('unsupported');
  });
});

// ─── attribution ─────────────────────────────────────────────────────────

describe('validateAttributionClaim', () => {
  it('URL も人名も無ければ grounded', async () => {
    const r = await validateAttributionClaim('今日は穏やかな一日でした。');
    expect(r.verdict).toBe('grounded');
  });

  it('既知ドメイン URL は grounded', async () => {
    const r = await validateAttributionClaim(
      '詳細は https://harmony-mc.com/column/ をご覧ください。'
    );
    expect(r.verdict).toBe('grounded');
  });

  it('未知ドメイン URL は flagged / high', async () => {
    const r = await validateAttributionClaim(
      '出典: https://unknown-source.example.com/article'
    );
    expect(r.verdict).toBe('flagged');
    expect(r.severity).toBe('high');
  });

  it('既知人名は grounded', async () => {
    const r = await validateAttributionClaim('小林由起子さんが言いました。');
    expect(r.verdict).toBe('grounded');
  });

  it('未知人名（敬称付き）は flagged', async () => {
    const r = await validateAttributionClaim(
      '田中太郎さんが研究を発表しました。'
    );
    expect(r.verdict).toBe('flagged');
    expect(r.reason).toContain('田中太郎');
  });
});

// ─── spiritual ───────────────────────────────────────────────────────────

describe('validateSpiritualClaim', () => {
  it('NG 語が無ければ grounded', async () => {
    const r = await validateSpiritualClaim(
      '心の落ち着きを取り戻すことが大切です。'
    );
    expect(r.verdict).toBe('grounded');
    expect(r.severity).toBe('none');
  });

  it('NG 語「波動」ヒット → flagged / critical', async () => {
    const r = await validateSpiritualClaim(
      'この瞑想で波動が高まり人生が変わります。'
    );
    expect(r.verdict).toBe('flagged');
    expect(r.severity).toBe('critical');
    expect(r.reason).toContain('波動');
  });

  it('NG 語「過去世」ヒット → flagged / critical', async () => {
    const r = await validateSpiritualClaim(
      'あなたの過去世が今に影響しています。'
    );
    expect(r.verdict).toBe('flagged');
    expect(r.severity).toBe('critical');
  });

  it('医療断定「治る」ヒット → flagged / critical', async () => {
    const r = await validateSpiritualClaim('この方法で必ず治るでしょう。');
    expect(r.verdict).toBe('flagged');
    expect(r.severity).toBe('critical');
  });

  it('否定文脈（〜ない / 〜ません）は除外される', async () => {
    const r = await validateSpiritualClaim(
      '波動が高いという表現は使いません。'
    );
    expect(r.verdict).toBe('grounded');
    expect(r.reason).toContain('否定文脈');
  });

  it('複数 NG 語ヒット時はすべて reason に含まれる', async () => {
    const r = await validateSpiritualClaim(
      'チャクラが開く瞬間と前世の記憶が同時に蘇ります。'
    );
    expect(r.verdict).toBe('flagged');
    expect(r.reason).toMatch(/チャクラが開く/);
    expect(r.reason).toMatch(/前世/);
  });

  it('辞書語句が長い順にソートされている（過去世 > 世 の優先）', () => {
    const idxKakoze = spiritualInternals.FORBIDDEN_TERMS.indexOf('過去世');
    const idxUnmei = spiritualInternals.FORBIDDEN_TERMS.indexOf('運命の人');
    // 長い語が短い語より前に並んでいるはず（過去世=3字 / 運命の人=4字）
    expect(idxUnmei).toBeLessThan(
      spiritualInternals.FORBIDDEN_TERMS.findIndex((t) => t.length === 2)
    );
    expect(idxKakoze).toBeGreaterThanOrEqual(0);
  });
});

// ─── logical ─────────────────────────────────────────────────────────────

describe('validateLogicalPair', () => {
  const judgeYes: ContradictionJudgeFn = vi.fn(async () => ({
    contradiction: true,
    reason: '事実関係が逆',
  }));
  const judgeNo: ContradictionJudgeFn = vi.fn(async () => ({
    contradiction: false,
    reason: '矛盾なし',
  }));

  it('judge が contradiction=true → flagged / high', async () => {
    const r = await validateLogicalPair(
      '彼女は東京に住んでいる。',
      '彼女は北海道で生まれ育った後一度も離れていない。',
      judgeYes
    );
    expect(r.verdict).toBe('flagged');
    expect(r.severity).toBe('high');
    expect(r.reason).toContain('矛盾');
  });

  it('judge が contradiction=false → grounded', async () => {
    const r = await validateLogicalPair(
      '今日は晴れです。',
      '気温は20度です。',
      judgeNo
    );
    expect(r.verdict).toBe('grounded');
    expect(r.severity).toBe('none');
  });

  it('同一文ならスキップ（grounded）', async () => {
    const r = await validateLogicalPair('同じ文', '同じ文', judgeYes);
    expect(r.verdict).toBe('grounded');
    expect(r.reason).toContain('検証対象外');
  });

  it('judge が throw した場合 weak / medium に降格', async () => {
    const judgeErr: ContradictionJudgeFn = vi.fn(async () => {
      throw new Error('LLM timeout');
    });
    const r = await validateLogicalPair('A文', 'B文', judgeErr);
    expect(r.verdict).toBe('weak');
    expect(r.severity).toBe('medium');
    expect(r.reason).toContain('LLM timeout');
  });

  it('judge 未指定なら no-op（grounded）', async () => {
    const r = await validateLogicalPair('A文', 'B文');
    expect(r.verdict).toBe('grounded');
  });
});

// ─── 集計エントリ validateHallucination ───────────────────────────────────

describe('validateHallucination', () => {
  it('全タイプのクレームが空でも安全に動作する', async () => {
    const r = await validateHallucination({
      factualClaims: [],
      attributionClaims: [],
      spiritualClaims: [],
      logicalPairs: [],
    });
    expect(r.hallucination_score).toBe(100);
    expect(r.summary.total).toBe(0);
  });

  it('スピリチュアル NG hit があれば critical 計上 + score 減点', async () => {
    const r = await validateHallucination({
      factualClaims: [],
      attributionClaims: [],
      spiritualClaims: ['波動が上がる瞬間が訪れます。'],
      logicalPairs: [],
    });
    expect(r.summary.critical_hits).toBe(1);
    expect(r.summary.flagged).toBe(1);
    expect(r.hallucination_score).toBeLessThan(100);
    // critical=1 → -25 → 75 の想定
    expect(r.hallucination_score).toBe(75);
  });

  it('複数検証器を並列実行し summary に合算する', async () => {
    const retrieve: RetrieveChunksFn = vi.fn(async () => [
      { id: 'c1', content: 's', similarity: 0.9 },
    ]);
    const judge: ContradictionJudgeFn = vi.fn(async () => ({
      contradiction: false,
      reason: 'ok',
    }));

    const r = await validateHallucination(
      {
        factualClaims: ['2024年の調査結果です。'],
        attributionClaims: ['https://harmony-mc.com/column/'],
        spiritualClaims: ['心が穏やかになります。'],
        logicalPairs: [['今日は晴れ。', '気温20度。']],
      },
      { retrieveTopK: retrieve, judgeContradiction: judge }
    );

    expect(r.summary.total).toBe(4);
    expect(r.summary.grounded).toBe(4);
    expect(r.hallucination_score).toBe(100);
  });

  it('score 下限は 0 を下回らない', async () => {
    // critical を大量に積んで -25 * N を発生させる
    const r = await validateHallucination({
      factualClaims: [],
      attributionClaims: [],
      spiritualClaims: [
        '波動が上がる',
        '前世の記憶',
        '過去世の影響',
        'チャクラが開く',
        '霊格の高い人',
      ],
      logicalPairs: [],
    });
    // 5 * 25 = 125 減点 → 0 でクランプ
    expect(r.hallucination_score).toBe(0);
    expect(r.summary.critical_hits).toBe(5);
  });
});
