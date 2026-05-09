// ============================================================================
// test/unit/quality-check-kishotenketsu-phase-alignment.test.ts
//
// P5-102: quality_check の補助 check `kishotenketsu_phase_alignment` を検証する。
//        cheerio で <h2> を抽出し、各 phase summary の名詞 token (≥2 字) と
//        いずれかの H2 テキストが一致するかで pass / warn を判定する。
//
// spec: docs/specs/kishotenketsu-flow.md §8.3
//
// 対象ケース:
//   TC1: 全 4 phase の名詞 token が H2 に含まれる → status='pass'
//   TC2: 転 (ten) の token が H2 に含まれない    → status='warn',
//                                                  detail='H2 と非整合: ten'
//   TC3: kishotenketsu null                     → 空配列 (silent skip)
//
// 注意: AI 呼び出しなし。cheerio 純粋判定のみ。
//        production 関数 `checkKishotenketsuPhaseAlignment` は P5-102 で実装。
// ============================================================================

import { describe, it, expect } from 'vitest';

// production code (P5-102) は src/lib/content/checks/ に分離されている。
import { checkKishotenketsuPhaseAlignment } from '@/lib/content/checks/kishotenketsu-phase-alignment';

// ─── TC1: 全 phase の token が H2 に含まれる → pass ─────────────────────────

describe('checkKishotenketsuPhaseAlignment — TC1: 全 phase 整合', () => {
  it('TC1: 全 4 phase の token が H2 にいずれか含まれる → pass', () => {
    const article = {
      id: 'art-align-1',
      kishotenketsu: {
        // 各 summary は 50〜150 字相当の長さで、最初の 2 トークン (≥2 字) を
        // H2 に含ませる。spec §8.3 の split(/[、。\s]/).slice(0, 3) ロジックに従う。
        ki:
          '気づきの夜、心の静けさを言語化する。誰もが感じる感覚をそっと差し出す。',
        sho:
          '欠落の声、心の奥でうずく感情に寄り添う。多くの人が抱えるものなんです。',
        ten:
          '視点転換、扉として孤独を捉え直す気づき。承の前提そのものを問い直す段。',
        ketsu:
          '深呼吸、今日からの小さな一歩を提案する。優しい余韻で締めくくる段。',
        ten_perspective_shift:
          '欠落から扉へ、視点の角度を 90 度ずらしました。',
      },
      // H2 に各 phase の最初のトークンを含める (cheerio で text 取得)
      stage2_body_html: [
        '<h2>気づきの夜にそっと宿るもの</h2>',
        '<p>本文 本文 本文 本文 本文 本文 本文 本文 本文 本文。</p>',
        '<h2>欠落の声と寄り添うひととき</h2>',
        '<p>本文 本文 本文 本文 本文 本文 本文 本文 本文 本文。</p>',
        '<h2>視点転換が運ぶ気づき</h2>',
        '<p>本文 本文 本文 本文 本文 本文 本文 本文 本文 本文。</p>',
        '<h2>深呼吸から始まる小さな一歩</h2>',
        '<p>本文 本文 本文 本文 本文 本文 本文 本文 本文 本文。</p>',
      ].join(''),
    } as unknown as Parameters<typeof checkKishotenketsuPhaseAlignment>[0];

    const items = checkKishotenketsuPhaseAlignment(article);
    expect(items.length).toBe(1);
    const align = items[0];
    expect(align.id).toBe('kishotenketsu_phase_alignment');
    expect(align.status).toBe('pass');
    expect(align.severity).toBe('warning'); // §8.3 severity=warning 固定
  });
});

// ─── TC2: 転の token が H2 に含まれない → warn ────────────────────────────

describe('checkKishotenketsuPhaseAlignment — TC2: 転のみ非整合', () => {
  it('TC2: 転 (ten) の token がどの H2 にも含まれなければ warn / detail に「ten」', () => {
    const article = {
      id: 'art-align-2',
      kishotenketsu: {
        ki:
          '気づきの夜、心の静けさを言語化する。誰もが感じる感覚をそっと差し出す。',
        sho:
          '欠落の声、心の奥でうずく感情に寄り添う。多くの人が抱えるものなんです。',
        // 転 の最初のトークンは「視点転換」「扉」だが、H2 にどちらも入れない。
        ten:
          '視点転換、扉として孤独を捉え直す気づき。承の前提そのものを問い直す段。',
        ketsu:
          '深呼吸、今日からの小さな一歩を提案する。優しい余韻で締めくくる段。',
        ten_perspective_shift:
          '欠落から扉へ、視点の角度を 90 度ずらしました。',
      },
      stage2_body_html: [
        '<h2>気づきの夜にそっと宿るもの</h2>',
        '<p>本文 本文 本文 本文 本文 本文 本文 本文 本文 本文。</p>',
        '<h2>欠落の声と寄り添うひととき</h2>',
        '<p>本文 本文 本文 本文 本文 本文 本文 本文 本文 本文。</p>',
        // 転に対応する H2 が無い (まったく無関係なタイトル)
        '<h2>朝のコーヒーと窓辺の風</h2>',
        '<p>本文 本文 本文 本文 本文 本文 本文 本文 本文 本文。</p>',
        '<h2>深呼吸から始まる小さな一歩</h2>',
        '<p>本文 本文 本文 本文 本文 本文 本文 本文 本文 本文。</p>',
      ].join(''),
    } as unknown as Parameters<typeof checkKishotenketsuPhaseAlignment>[0];

    const items = checkKishotenketsuPhaseAlignment(article);
    expect(items.length).toBe(1);
    const align = items[0];
    expect(align.id).toBe('kishotenketsu_phase_alignment');
    expect(align.status).toBe('warn');
    expect(align.detail).toBeDefined();
    expect(align.detail).toContain('H2 と非整合');
    expect(align.detail).toContain('ten');
    // §8.3: 公開ブロック禁止 → severity=warning
    expect(align.severity).toBe('warning');
  });
});

// ─── TC3: kishotenketsu null → 空配列 (silent skip) ────────────────────────

describe('checkKishotenketsuPhaseAlignment — TC3: silent skip', () => {
  it('TC3: kishotenketsu が null なら空配列を返す (check item は emit しない)', () => {
    const article = {
      id: 'art-align-3',
      kishotenketsu: null,
      stage2_body_html: '<h2>何らかの見出し</h2><p>本文。</p>',
    } as unknown as Parameters<typeof checkKishotenketsuPhaseAlignment>[0];

    const items = checkKishotenketsuPhaseAlignment(article);
    expect(items).toEqual([]);
  });

  it('TC3-2: body_html が null/空なら空配列 (cheerio 解析対象なし)', () => {
    const article = {
      id: 'art-align-4',
      kishotenketsu: {
        ki: 'a', sho: 'b', ten: 'c', ketsu: 'd', ten_perspective_shift: 'e',
      },
      stage2_body_html: null,
    } as unknown as Parameters<typeof checkKishotenketsuPhaseAlignment>[0];
    const items = checkKishotenketsuPhaseAlignment(article);
    expect(items).toEqual([]);
  });

  it('TC3-3: kishotenketsu が undefined でも空配列', () => {
    const article = {
      id: 'art-align-5',
      kishotenketsu: undefined,
      stage2_body_html: '<h2>x</h2>',
    } as unknown as Parameters<typeof checkKishotenketsuPhaseAlignment>[0];
    const items = checkKishotenketsuPhaseAlignment(article);
    expect(items).toEqual([]);
  });
});
