// ============================================================================
// test/unit/claim-extractor.test.ts
// spec §6.2 step1 検証:
//   - 30 文 golden set による recall ≥ 0.9 検証（Gemini API は vi.mock）
//   - claim_type 分類精度（fixture の正解付きで判定）
//   - HTML タグ除去 / 句点分割 / 不正値防御の単体テスト
// ============================================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ClaimType } from '@/types/hallucination';

// gemini-client を mock 化（実 API は呼ばない）
vi.mock('@/lib/ai/gemini-client', () => ({
  generateJson: vi.fn(),
}));

import { generateJson } from '@/lib/ai/gemini-client';
import {
  extractClaims,
  splitSentences,
  stripHtml,
} from '@/lib/hallucination/claim-extractor';

const generateJsonMock = generateJson as unknown as ReturnType<typeof vi.fn>;

// ─── 30 文 golden fixture ──────────────────────────────────────────────────
// 形式: [文, 期待 claim_type]
type GoldenRow = readonly [string, ClaimType];

const GOLDEN_30: readonly GoldenRow[] = [
  ['1995年、日本ではインターネットが本格的に普及し始めました。', 'factual'],
  ['世界保健機関の統計によると、世界人口は78億人を超えています。', 'factual'],
  ['日本の総人口は約1億2500万人です。', 'factual'],
  ['東京都の人口密度は1平方キロメートルあたり約6000人です。', 'factual'],
  ['富士山の標高は3776メートルです。', 'factual'],
  ['田中博士は「瞑想は脳の前頭前皮質を活性化させる」と述べています。', 'attribution'],
  ['アメリカ心理学会によると、マインドフルネスはストレス軽減に有効です。', 'attribution'],
  ['佐藤教授は2020年の論文で同様の結論を示しています。', 'attribution'],
  ['ある研究者は瞑想の効果について次のように語っています。', 'attribution'],
  ['ユング心理学によれば、集合的無意識は人類共通の元型から成り立ちます。', 'attribution'],
  ['あなたの波動が高まると、現実が変わり始めます。', 'spiritual'],
  ['過去世のカルマは今世の人間関係に影響を与えています。', 'spiritual'],
  ['チャクラのエネルギーが整うと、心身のバランスが取れます。', 'spiritual'],
  ['ハイヤーセルフからのメッセージを受け取ることが可能です。', 'spiritual'],
  ['天使はいつもあなたを見守っています。', 'spiritual'],
  ['呼吸が浅いから、自律神経が乱れるのです。', 'logical'],
  ['睡眠時間が短い人は集中力が低下するため、生産性が下がります。', 'logical'],
  ['毎日運動すれば、結果として基礎代謝が向上します。', 'logical'],
  ['食事を整えることで、心の安定にもつながります。', 'logical'],
  ['朝日を浴びると、体内時計がリセットされるため眠りが深くなります。', 'logical'],
  ['私は先週、初めて瞑想を体験しました。', 'experience'],
  ['昨日のセッションで、不思議な感覚を覚えました。', 'experience'],
  ['以前、私自身もこの方法で人生が変わりました。', 'experience'],
  ['先月、自分のチャクラを意識する時間を作りました。', 'experience'],
  ['私が初めてヒーリングを受けたのは、数年前のことです。', 'experience'],
  ['人はそれぞれ自分らしさを持っています。', 'general'],
  ['あなたはどんなときに幸せを感じますか。', 'general'],
  ['人生は一度きりです。', 'general'],
  ['心と体はつながっていると言われます。', 'general'],
  ['本当の豊かさとは何でしょうか。', 'general'],
];

// 期待される claim_type 分布が均等（各 5 件）であることを確認
function expectedDistribution(): Record<ClaimType, number> {
  const dist: Record<ClaimType, number> = {
    factual: 0,
    attribution: 0,
    spiritual: 0,
    logical: 0,
    experience: 0,
    general: 0,
  };
  for (const [, t] of GOLDEN_30) dist[t]++;
  return dist;
}

// fixture をそのまま返す Gemini モックレスポンスを構築
function buildPerfectMockResponse() {
  return {
    data: GOLDEN_30.map(([text, type], idx) => ({
      sentence_idx: idx,
      claim_text: text,
      claim_type: type,
    })),
    response: {
      text: '',
      finishReason: 'STOP',
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    },
  };
}

// fixture の一部を意図的に欠損させた応答（recall 検証用）
function buildLossyMockResponse(missingIndices: number[]) {
  const set = new Set(missingIndices);
  return {
    data: GOLDEN_30.flatMap(([text, type], idx) =>
      set.has(idx)
        ? []
        : [{ sentence_idx: idx, claim_text: text, claim_type: type }],
    ),
    response: {
      text: '',
      finishReason: 'STOP',
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    },
  };
}

// ─── ユーティリティのテスト ────────────────────────────────────────────────

describe('stripHtml', () => {
  it('script / style ブロックの中身ごと除去する', () => {
    const html =
      '<p>本文1。</p><script>alert(1)</script><style>.a{color:red}</style><p>本文2。</p>';
    const out = stripHtml(html);
    expect(out).not.toContain('alert');
    expect(out).not.toContain('color:red');
    expect(out).toContain('本文1。');
    expect(out).toContain('本文2。');
  });

  it('HTML エンティティをデコードする', () => {
    const html = '<p>A&amp;B&nbsp;C&lt;D&gt;E</p>';
    const out = stripHtml(html);
    expect(out).toContain('A&B C<D>E');
  });

  it('空文字列でも例外を投げない', () => {
    expect(stripHtml('')).toBe('');
  });
});

describe('splitSentences', () => {
  it('句点（。！？）で文を分割する', () => {
    const text = 'これは1文目。これは2文目！これは3文目？';
    const out = splitSentences(text);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('これは1文目。');
    expect(out[1]).toBe('これは2文目！');
    expect(out[2]).toBe('これは3文目？');
  });

  it('括弧閉じを直前の句点に吸収する', () => {
    // 内側の「行きます。」は閉じ括弧まで吸収して 1 文、続きの「と言った。」が 2 文目
    const text = '彼は「行きます。」と言った。';
    const out = splitSentences(text);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe('彼は「行きます。」');
    expect(out[1]).toBe('と言った。');
  });

  it('句点がない末尾も拾う', () => {
    const text = '一文目。末尾の断片';
    const out = splitSentences(text);
    expect(out).toEqual(['一文目。', '末尾の断片']);
  });

  it('空文字列で空配列を返す', () => {
    expect(splitSentences('')).toEqual([]);
  });
});

// ─── extractClaims 本体テスト ──────────────────────────────────────────────

describe('extractClaims (golden set 30 sentences)', () => {
  beforeEach(() => {
    generateJsonMock.mockReset();
  });

  it('30 文 fixture 完全応答時、すべての文が抽出される（recall = 1.0）', async () => {
    generateJsonMock.mockResolvedValueOnce(buildPerfectMockResponse());

    const html = `<article>${GOLDEN_30.map(([s]) => `<p>${s}</p>`).join('')}</article>`;
    const claims = await extractClaims(html);

    expect(claims).toHaveLength(GOLDEN_30.length);

    const recall = claims.length / GOLDEN_30.length;
    expect(recall).toBeGreaterThanOrEqual(0.9);
  });

  it('一部欠損応答（3 件欠損）でも recall ≥ 0.9 を満たす', async () => {
    generateJsonMock.mockResolvedValueOnce(buildLossyMockResponse([2, 14, 27]));

    const html = `<article>${GOLDEN_30.map(([s]) => `<p>${s}</p>`).join('')}</article>`;
    const claims = await extractClaims(html);

    const recall = claims.length / GOLDEN_30.length;
    // 27/30 = 0.9
    expect(recall).toBeGreaterThanOrEqual(0.9);
  });

  it('claim_type 分類精度: 完全応答時、全 6 種類が均等に 5 件ずつ抽出される', async () => {
    generateJsonMock.mockResolvedValueOnce(buildPerfectMockResponse());

    const html = `<article>${GOLDEN_30.map(([s]) => `<p>${s}</p>`).join('')}</article>`;
    const claims = await extractClaims(html);

    const dist: Record<ClaimType, number> = {
      factual: 0,
      attribution: 0,
      spiritual: 0,
      logical: 0,
      experience: 0,
      general: 0,
    };
    for (const c of claims) dist[c.claim_type]++;

    expect(dist).toEqual(expectedDistribution());
  });

  it('claim_type 分類精度: 各 Claim が fixture 正解と一致する', async () => {
    generateJsonMock.mockResolvedValueOnce(buildPerfectMockResponse());

    const html = `<article>${GOLDEN_30.map(([s]) => `<p>${s}</p>`).join('')}</article>`;
    const claims = await extractClaims(html);

    let correct = 0;
    for (const c of claims) {
      const [, expected] = GOLDEN_30[c.sentence_idx];
      if (c.claim_type === expected) correct++;
    }
    const accuracy = correct / claims.length;
    // モック完全応答なので 1.0 のはず（分類精度の床は 0.9）
    expect(accuracy).toBeGreaterThanOrEqual(0.9);
  });

  it('未知 claim_type は general にフォールバックする', async () => {
    generateJsonMock.mockResolvedValueOnce({
      data: [
        { sentence_idx: 0, claim_text: 'これは一文目です。', claim_type: 'mystery' },
      ],
      response: {
        text: '',
        finishReason: 'STOP',
        tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      },
    });

    const claims = await extractClaims('<p>これは一文目です。</p>');
    expect(claims).toHaveLength(1);
    expect(claims[0].claim_type).toBe('general');
  });

  it('範囲外 sentence_idx / 重複 idx は除去される', async () => {
    generateJsonMock.mockResolvedValueOnce({
      data: [
        { sentence_idx: 0, claim_text: '一文目。', claim_type: 'general' },
        { sentence_idx: 0, claim_text: '一文目（重複）。', claim_type: 'general' }, // 重複
        { sentence_idx: 99, claim_text: '範囲外。', claim_type: 'factual' },        // 範囲外
        { sentence_idx: -1, claim_text: '負値。', claim_type: 'factual' },           // 負値
      ],
      response: {
        text: '',
        finishReason: 'STOP',
        tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      },
    });

    const claims = await extractClaims('<p>一文目。</p>');
    expect(claims).toHaveLength(1);
    expect(claims[0].sentence_idx).toBe(0);
    expect(claims[0].claim_text).toBe('一文目。'); // 最初の有効レコードが採用される
  });

  it('Gemini が { claims: [...] } 形式で包んだ応答も受け入れる', async () => {
    generateJsonMock.mockResolvedValueOnce({
      data: {
        claims: [
          { sentence_idx: 0, claim_text: '一文目。', claim_type: 'general' },
        ],
      },
      response: {
        text: '',
        finishReason: 'STOP',
        tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      },
    });

    const claims = await extractClaims('<p>一文目。</p>');
    expect(claims).toHaveLength(1);
  });

  it('空 HTML では Gemini を呼ばずに空配列を返す', async () => {
    const claims = await extractClaims('');
    expect(claims).toEqual([]);
    expect(generateJsonMock).not.toHaveBeenCalled();
  });

  it('Gemini が例外を投げた場合、空配列を返す（記事本文には触れない）', async () => {
    generateJsonMock.mockRejectedValueOnce(new Error('upstream timeout'));
    const claims = await extractClaims('<p>一文目。</p>');
    expect(claims).toEqual([]);
  });

  it('応答が配列でも { claims } でもない場合は空配列を返す', async () => {
    generateJsonMock.mockResolvedValueOnce({
      data: { unexpected: 'shape' },
      response: {
        text: '',
        finishReason: 'STOP',
        tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      },
    });
    const claims = await extractClaims('<p>一文目。</p>');
    expect(claims).toEqual([]);
  });

  it('temperature=0.1 で Gemini が呼び出される', async () => {
    generateJsonMock.mockResolvedValueOnce(buildPerfectMockResponse());
    const html = `<article>${GOLDEN_30.map(([s]) => `<p>${s}</p>`).join('')}</article>`;
    await extractClaims(html);

    expect(generateJsonMock).toHaveBeenCalledTimes(1);
    const callArgs = generateJsonMock.mock.calls[0];
    // generateJson(systemPrompt, userPrompt, options)
    const options = callArgs[2] as { temperature?: number };
    expect(options.temperature).toBe(0.1);
  });
});
