// ============================================================================
// test/unit/kishotenketsu-schema.test.ts
//
// 起承転結 (kishotenketsu) zod schema + 検証ヘルパーの単体テスト。
//
// spec: docs/specs/kishotenketsu-flow.md §3.1 (schema) + §4.3 (検証ポイント)
//
// 対象ケース (P5-99 受け入れ条件):
//   - TC1 : valid 4-phase plan + ten_perspective_shift が safeParse 通過
//   - TC2 : 各 phase 50 字未満は reject
//   - TC3 : 各 phase 150 字超過は reject
//   - TC4 : ten_perspective_shift 20 字未満は reject
//   - TC5 : ten_perspective_shift 120 字超過は reject
//   - TC6 : §4.3-4 転換語チェック (assertTenHasTransitionWord)
//   - TC7 : §4.3-4 転と承の先頭差異 (assertTenDiffersFromSho)
//   - TC8 : §4.3-5 ten_perspective_shift の抽象 boilerplate reject
//
// 注意:
//   ヘルパー関数 (assertTen*) は P5-101 で validator レイヤに昇格予定。
//   現時点ではテストファイル内に inline 定義する (production export はまだない)。
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  kishotenketsuSchema,
  kishotenketsuPhaseSchema,
  type KishotenketsuPlan,
} from '@/lib/schemas/kishotenketsu';

// ─── 文字数調整ヘルパー ──────────────────────────────────────────────────────
// テストデータ生成用。本文は何でもよいので「あ」で長さを決め打ちする。
const repeat = (ch: string, n: number): string => ch.repeat(n);

// 50〜150 字レンジを満たす標準的な phase テキスト (約 80 字)。
const VALID_KI =
  '最近、何気ない日常の中でふと立ち止まってしまう瞬間はありませんか。' +
  'そんな小さな違和感に、そっと耳を澄ませてみてもよいのかもしれません。';
const VALID_SHO =
  'その感覚は、実は多くの人が同じように抱えているものなんです。' +
  'うまく言葉にできないけれど、心の奥でずっと響いている声があります。';
// 「でも」を含み、承の冒頭と異なる出だし (転の signature 用)
const VALID_TEN =
  'でも視点を少し変えてみると、その違和感は欠落ではなく、新しい扉を開く合図かもしれません。' +
  '心が抵抗するときこそ、扉の向こうに届くべき気づきが待っています。';
const VALID_KETSU =
  '今日はひとつだけ、深呼吸をしてみてくださいね。小さな一歩が、明日のあなたをそっと支えてくれます。' +
  '焦らず、自分のペースで歩いていきましょう。';
const VALID_SHIFT =
  '孤独を欠落と捉える視点から、孤独は出会いの扉と捉える視点へ角度を90度変えました。';

const VALID_PLAN: KishotenketsuPlan = {
  ki: VALID_KI,
  sho: VALID_SHO,
  ten: VALID_TEN,
  ketsu: VALID_KETSU,
  ten_perspective_shift: VALID_SHIFT,
};

// 文字数事前確認 (テストデータが 50〜150 字レンジを実際に満たしているかを保証)
describe('kishotenketsu test fixture sanity', () => {
  it('VALID_PLAN の各 phase が 50〜150 字に収まる', () => {
    expect(VALID_KI.length).toBeGreaterThanOrEqual(50);
    expect(VALID_KI.length).toBeLessThanOrEqual(150);
    expect(VALID_SHO.length).toBeGreaterThanOrEqual(50);
    expect(VALID_SHO.length).toBeLessThanOrEqual(150);
    expect(VALID_TEN.length).toBeGreaterThanOrEqual(50);
    expect(VALID_TEN.length).toBeLessThanOrEqual(150);
    expect(VALID_KETSU.length).toBeGreaterThanOrEqual(50);
    expect(VALID_KETSU.length).toBeLessThanOrEqual(150);
    expect(VALID_SHIFT.length).toBeGreaterThanOrEqual(20);
    expect(VALID_SHIFT.length).toBeLessThanOrEqual(120);
  });
});

// ─── TC1〜TC5: zod schema レイヤ ───────────────────────────────────────────
describe('kishotenketsuSchema (zod)', () => {
  // TC1
  it('TC1: 完全な 4-phase plan + ten_perspective_shift を受理する', () => {
    const result = kishotenketsuSchema.safeParse(VALID_PLAN);
    expect(result.success).toBe(true);
  });

  // TC2: 50 字未満
  it('TC2: ki が 50 字未満 (10 字) なら reject', () => {
    const r = kishotenketsuSchema.safeParse({
      ...VALID_PLAN,
      ki: '短い文。短い文。', // 10 字未満想定 (8 字)
    });
    expect(r.success).toBe(false);
  });

  it('TC2-2: phase schema 単体でも 49 字なら reject', () => {
    const r = kishotenketsuPhaseSchema.safeParse(repeat('あ', 49));
    expect(r.success).toBe(false);
  });

  it('TC2-3: phase schema 単体で 50 字ちょうどなら受理', () => {
    const r = kishotenketsuPhaseSchema.safeParse(repeat('あ', 50));
    expect(r.success).toBe(true);
  });

  // TC3: 150 字超過
  it('TC3: sho が 200 字なら reject', () => {
    const r = kishotenketsuSchema.safeParse({
      ...VALID_PLAN,
      sho: repeat('あ', 200),
    });
    expect(r.success).toBe(false);
  });

  it('TC3-2: phase schema 単体で 151 字なら reject', () => {
    const r = kishotenketsuPhaseSchema.safeParse(repeat('あ', 151));
    expect(r.success).toBe(false);
  });

  it('TC3-3: phase schema 単体で 150 字ちょうどなら受理', () => {
    const r = kishotenketsuPhaseSchema.safeParse(repeat('あ', 150));
    expect(r.success).toBe(true);
  });

  // TC4: ten_perspective_shift 20 字未満
  it('TC4: ten_perspective_shift が 5 字なら reject', () => {
    const r = kishotenketsuSchema.safeParse({
      ...VALID_PLAN,
      ten_perspective_shift: repeat('あ', 5),
    });
    expect(r.success).toBe(false);
  });

  it('TC4-2: ten_perspective_shift が 19 字なら reject', () => {
    const r = kishotenketsuSchema.safeParse({
      ...VALID_PLAN,
      ten_perspective_shift: repeat('あ', 19),
    });
    expect(r.success).toBe(false);
  });

  // TC5: ten_perspective_shift 120 字超過
  it('TC5: ten_perspective_shift が 130 字なら reject', () => {
    const r = kishotenketsuSchema.safeParse({
      ...VALID_PLAN,
      ten_perspective_shift: repeat('あ', 130),
    });
    expect(r.success).toBe(false);
  });

  it('TC5-2: ten_perspective_shift が 121 字なら reject', () => {
    const r = kishotenketsuSchema.safeParse({
      ...VALID_PLAN,
      ten_perspective_shift: repeat('あ', 121),
    });
    expect(r.success).toBe(false);
  });

  it('TC5-3: ten_perspective_shift が 120 字ちょうどなら受理', () => {
    const r = kishotenketsuSchema.safeParse({
      ...VALID_PLAN,
      ten_perspective_shift: repeat('あ', 120),
    });
    expect(r.success).toBe(true);
  });

  // 必須フィールド欠落
  it('ten が欠落していたら reject', () => {
    const { ten: _omit, ...rest } = VALID_PLAN;
    void _omit;
    const r = kishotenketsuSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it('ten_perspective_shift が欠落していたら reject', () => {
    const { ten_perspective_shift: _omit, ...rest } = VALID_PLAN;
    void _omit;
    const r = kishotenketsuSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });
});

// ─── TC6〜TC8: 検証ヘルパー (P5-101 で validator レイヤに昇格予定) ───────────

/**
 * TC6 §4.3-4: 「転」テキストに転換語が含まれるか検証する。
 * 由起子さんの「視点転換」signature を担保する最低条件。
 */
const TRANSITION_WORDS = ['でも', 'けれど', '実は', '一方で', 'ところが'] as const;
function assertTenHasTransitionWord(ten: string): boolean {
  return TRANSITION_WORDS.some((w) => ten.includes(w));
}

/**
 * TC7 §4.3-4: 「転」と「承」の先頭 20 字が異なることを検証する。
 * 平行展開 (承の言い換え) を防ぐ。
 */
function assertTenDiffersFromSho(ten: string, sho: string): boolean {
  return ten.slice(0, 20) !== sho.slice(0, 20);
}

/**
 * TC8 §4.3-5: ten_perspective_shift が抽象 boilerplate のみで終わっていないか検証。
 * 「視点を転換」「角度を変え」だけで済ませる手抜き出力を reject する。
 */
function assertTenShiftConcrete(text: string): boolean {
  if (/^視点を転換/.test(text)) return false;
  if (/^角度を変え/.test(text)) return false;
  return true;
}

describe('assertTenHasTransitionWord (§4.3-4)', () => {
  // TC6
  it('TC6: 「でも」を含む転テキストは pass', () => {
    expect(assertTenHasTransitionWord('でも視点を変えてみると…')).toBe(true);
  });

  it('TC6-2: 「けれど」を含む転テキストは pass', () => {
    expect(assertTenHasTransitionWord('けれど、本当はそうではないのかもしれません。')).toBe(true);
  });

  it('TC6-3: 「実は」を含む転テキストは pass', () => {
    expect(assertTenHasTransitionWord('実はそれは欠落ではなく扉だったのです。')).toBe(true);
  });

  it('TC6-4: 「一方で」を含む転テキストは pass', () => {
    expect(assertTenHasTransitionWord('一方で、まったく逆の景色も見えてきます。')).toBe(true);
  });

  it('TC6-5: 「ところが」を含む転テキストは pass', () => {
    expect(assertTenHasTransitionWord('ところが、視点を一段ずらしてみると…')).toBe(true);
  });

  it('TC6-6: 転換語を含まない平叙文は fail', () => {
    expect(
      assertTenHasTransitionWord('そして、その気持ちはとても大切なものでした。'),
    ).toBe(false);
  });

  it('TC6-7: 空文字は fail', () => {
    expect(assertTenHasTransitionWord('')).toBe(false);
  });
});

describe('assertTenDiffersFromSho (§4.3-4)', () => {
  // TC7
  it('TC7: ten と sho の先頭 20 字が同じなら fail', () => {
    const same = 'その感覚は、実は多くの人が同じように抱えているものです。';
    expect(assertTenDiffersFromSho(same, same)).toBe(false);
  });

  it('TC7-2: ten と sho の先頭 20 字が異なれば pass', () => {
    expect(assertTenDiffersFromSho(VALID_TEN, VALID_SHO)).toBe(true);
  });

  it('TC7-3: ten と sho の先頭 19 字一致 + 20 字目相違は pass', () => {
    const sho = 'あ'.repeat(19) + 'い' + 'うえおかきくけこ';
    const ten = 'あ'.repeat(19) + 'X' + 'うえおかきくけこ';
    expect(assertTenDiffersFromSho(ten, sho)).toBe(true);
  });
});

describe('assertTenShiftConcrete (§4.3-5)', () => {
  // TC8
  it('TC8: 「視点を転換します。」のような抽象 boilerplate は fail', () => {
    expect(assertTenShiftConcrete('視点を転換します。')).toBe(false);
  });

  it('TC8-2: 「角度を変えます」も fail', () => {
    expect(assertTenShiftConcrete('角度を変えます')).toBe(false);
  });

  it('TC8-3: 具体的な視点転換の言語化は pass', () => {
    expect(
      assertTenShiftConcrete(
        '孤独を欠落と捉える視点から、孤独は出会いの扉と捉える視点へ',
      ),
    ).toBe(true);
  });

  it('TC8-4: 文中に「視点を転換」が出てくるが先頭ではない場合は pass', () => {
    expect(
      assertTenShiftConcrete('承では孤独を欠落と捉えていたが、転では視点を転換し、扉として捉え直した。'),
    ).toBe(true);
  });
});
