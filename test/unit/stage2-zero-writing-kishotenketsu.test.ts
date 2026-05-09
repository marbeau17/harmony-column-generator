// ============================================================================
// test/unit/stage2-zero-writing-kishotenketsu.test.ts
//
// P5-101: Stage2 zero-writing user prompt 内 起承転結ブロックの注入挙動。
//
// spec: docs/specs/kishotenketsu-flow.md §5.1 / §5.2 / §5.4
//
// 対象ケース:
//   TC1 : approved_kishotenketsu null → block 非出力 (旧 path 互換 / byte-identical)
//   TC2 : approved present + approved_at present → block + 「対応 H2:」を含む
//   TC3 : approved present + approved_at null → block 非出力 (承認待ちは旧 path)
//   TC4 : H2 章数 != 4 → 「対応 H2:」マッピング行は出力しない (4 段テキストのみ)
//   TC5 : 各段の Japanese 文字列が verbatim で含まれる
//
// 注意: AI 呼び出し無し。純粋な prompt builder の文字列検査のみ。
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  buildZeroWritingUserPrompt,
  type ZeroWritingInput,
  type ZeroWritingPersona,
  type RetrievedChunk,
} from '@/lib/ai/prompts/stage2-zero-writing';
import type { ZeroOutlineOutput } from '@/lib/ai/prompts/stage1-zero-outline';
import type { KishotenketsuPlan } from '@/lib/schemas/kishotenketsu';

// ─── フィクスチャ ─────────────────────────────────────────────────────────────

const baseOutline4Chapters: ZeroOutlineOutput = {
  lead_summary:
    '孤独を欠落として捉えるあなたへ。視点を一つ変えると、孤独は自分との出会いの扉になります。',
  narrative_arc: {
    opening_hook: { type: 'empathy', text: '夜、ふと部屋が静かに感じる瞬間があります' },
    awareness: '孤独は欠落として現れる',
    wavering: '本当に欠落だろうか、と心がゆれる',
    acceptance: '孤独は自分と出会う扉だったのかもしれない',
    action: '今日、5 分だけひとりで深呼吸してみてくださいね',
    closing_style: 'lingering',
  },
  emotion_curve: [-1, -2, 1, 2],
  h2_chapters: [
    { title: '夜の静けさに気づく', summary: '読者の現在地を言語化', target_chars: 500, arc_phase: 'awareness' },
    { title: '欠落と感じる心の声', summary: '感情への寄り添い', target_chars: 500, arc_phase: 'wavering' },
    { title: 'けれど、それは扉でした', summary: '視点の転換', target_chars: 500, arc_phase: 'acceptance' },
    { title: '今日からのちいさな一歩', summary: '行動への招待', target_chars: 500, arc_phase: 'action' },
  ],
  citation_highlights: ['孤独は欠落ではなく、自分との出会いの扉です'],
  faq_items: [{ q: '孤独を感じたときの対処は？', a: '5 分だけ静かな時間を持ってみてください。' }],
  image_prompts: [
    { slot: 'hero', prompt: '静かな夜の窓辺' },
    { slot: 'body', prompt: '朝の光と一輪の花' },
    { slot: 'summary', prompt: '夕焼けと小道' },
  ],
};

const baseOutline3Chapters: ZeroOutlineOutput = {
  ...baseOutline4Chapters,
  h2_chapters: [
    { title: '気づき + 揺らぎ', summary: 'まとめて 1 章', target_chars: 700, arc_phase: 'awareness' },
    { title: '転 (視点転換)', summary: '独立章', target_chars: 600, arc_phase: 'wavering' },
    { title: '結 (行動)', summary: '小さな一歩', target_chars: 500, arc_phase: 'action' },
  ],
};

const basePersona: ZeroWritingPersona = {
  id: 'persona-1',
  name: '40代女性・自己探求中',
};

const baseTheme = { id: 'theme-loneliness', name: '孤独と向き合う' };

const baseChunks: RetrievedChunk[] = [
  { text: '夜、ひとりで空を見上げる時間がありますね。', similarity: 0.91 },
];

const VALID_PLAN: KishotenketsuPlan = {
  ki:
    '最近、夜にふと心が静まりかえる瞬間はありませんか。' +
    '何でもない日常のなかで、少しだけ立ち止まりたくなる時間があるのかもしれません。',
  sho:
    'その静けさは、実は多くの人が同じように抱えているものなんです。' +
    '言葉にできないけれど心の奥でずっと響いている声があります。',
  ten:
    'でも視点を少し変えてみると、その静けさは欠落ではなく、自分と出会う扉かもしれません。' +
    '心が抵抗するときこそ、扉の向こうに気づきが待っています。',
  ketsu:
    '今日はひとつだけ、深呼吸をしてみてくださいね。小さな一歩が明日のあなたをそっと支えてくれます。' +
    '焦らず、自分のペースで歩いていきましょう。',
  ten_perspective_shift:
    '孤独を欠落と捉える視点から、孤独は自分と出会う扉と捉える視点へ角度を90度ずらしました。',
};

const baseInput4: ZeroWritingInput = {
  outline: baseOutline4Chapters,
  persona: basePersona,
  theme: baseTheme,
  retrievedChunks: baseChunks,
};

const baseInput3: ZeroWritingInput = {
  outline: baseOutline3Chapters,
  persona: basePersona,
  theme: baseTheme,
  retrievedChunks: baseChunks,
};

// ─── TC1: approved_kishotenketsu null → 旧 path ──────────────────────────────

describe('Stage2 kishotenketsu inject — TC1: approved null', () => {
  it('TC1: approved_kishotenketsu 未指定なら 起承転結ブロック非出力', () => {
    const user = buildZeroWritingUserPrompt(baseInput4);
    expect(user).not.toContain('## 起承転結構造');
    expect(user).not.toContain('対応 H2:');
  });

  it('TC1-2: approved_kishotenketsu = null でも block 非出力', () => {
    const user = buildZeroWritingUserPrompt({
      ...baseInput4,
      approved_kishotenketsu: null,
      kishotenketsu_approved_at: '2026-05-09T00:00:00Z',
    });
    expect(user).not.toContain('## 起承転結構造');
  });
});

// ─── TC2: approved + approved_at present → block 注入 ──────────────────────

describe('Stage2 kishotenketsu inject — TC2: approved + approved_at', () => {
  it('TC2: 両方 present で 起承転結ブロックが出力される', () => {
    const user = buildZeroWritingUserPrompt({
      ...baseInput4,
      approved_kishotenketsu: VALID_PLAN,
      kishotenketsu_approved_at: '2026-05-09T14:32:00Z',
    });
    expect(user).toContain('## 起承転結構造 (必須遵守');
  });

  it('TC2-2: H2 章数 = 4 のとき 「対応 H2:」マッピング行が 4 つ出力される', () => {
    const user = buildZeroWritingUserPrompt({
      ...baseInput4,
      approved_kishotenketsu: VALID_PLAN,
      kishotenketsu_approved_at: '2026-05-09T14:32:00Z',
    });
    const matches = user.match(/対応 H2:/g) ?? [];
    expect(matches.length).toBe(4);
    // kishotenketsu_phase ラベルが各 phase で出る
    expect(user).toContain('kishotenketsu_phase: ki');
    expect(user).toContain('kishotenketsu_phase: sho');
    expect(user).toContain('kishotenketsu_phase: ten');
    expect(user).toContain('kishotenketsu_phase: ketsu');
  });

  it('TC2-3: 「転」「結」の書き方ガイドラインも同時に出力される', () => {
    const user = buildZeroWritingUserPrompt({
      ...baseInput4,
      approved_kishotenketsu: VALID_PLAN,
      kishotenketsu_approved_at: '2026-05-09T14:32:00Z',
    });
    expect(user).toContain('### 転 (ten) の書き方');
    expect(user).toContain('### 結 (ketsu) の書き方');
    expect(user).toContain('〜してみてくださいね');
    expect(user).toContain('〜しますように');
  });
});

// ─── TC3: approved present + approved_at null → 旧 path (承認待ち) ────────

describe('Stage2 kishotenketsu inject — TC3: approved 有 + approved_at 無', () => {
  it('TC3: approved_at が null なら block 非出力 (承認待ちは旧 path)', () => {
    const user = buildZeroWritingUserPrompt({
      ...baseInput4,
      approved_kishotenketsu: VALID_PLAN,
      kishotenketsu_approved_at: null,
    });
    expect(user).not.toContain('## 起承転結構造');
    expect(user).not.toContain('対応 H2:');
  });

  it('TC3-2: approved_at が undefined でも block 非出力', () => {
    const user = buildZeroWritingUserPrompt({
      ...baseInput4,
      approved_kishotenketsu: VALID_PLAN,
      // kishotenketsu_approved_at 未指定
    });
    expect(user).not.toContain('## 起承転結構造');
  });

  it('TC3-3: approved_at が空文字なら block 非出力 (truthy 判定で除外)', () => {
    const user = buildZeroWritingUserPrompt({
      ...baseInput4,
      approved_kishotenketsu: VALID_PLAN,
      kishotenketsu_approved_at: '',
    });
    expect(user).not.toContain('## 起承転結構造');
  });
});

// ─── TC4: H2 章数 != 4 → 「対応 H2:」マッピング行は出力しない ────────────

describe('Stage2 kishotenketsu inject — TC4: H2 数 != 4', () => {
  it('TC4: H2 数 = 3 のとき block 自体は出力されるが「対応 H2:」行は出ない', () => {
    const user = buildZeroWritingUserPrompt({
      ...baseInput3,
      approved_kishotenketsu: VALID_PLAN,
      kishotenketsu_approved_at: '2026-05-09T00:00:00Z',
    });
    // ブロックヘッダは出力 (4 段テキストのみ提示)
    expect(user).toContain('## 起承転結構造');
    // マッピング行は出力されない
    expect(user).not.toContain('対応 H2:');
    expect(user).not.toContain('kishotenketsu_phase: ki');
    expect(user).not.toContain('kishotenketsu_phase: sho');
    expect(user).not.toContain('kishotenketsu_phase: ten');
    expect(user).not.toContain('kishotenketsu_phase: ketsu');
  });

  it('TC4-2: H2 数 = 3 でも 4 段の Japanese テキストは含まれる (本文のみ提示)', () => {
    const user = buildZeroWritingUserPrompt({
      ...baseInput3,
      approved_kishotenketsu: VALID_PLAN,
      kishotenketsu_approved_at: '2026-05-09T00:00:00Z',
    });
    expect(user).toContain(VALID_PLAN.ki);
    expect(user).toContain(VALID_PLAN.sho);
    expect(user).toContain(VALID_PLAN.ten);
    expect(user).toContain(VALID_PLAN.ketsu);
  });
});

// ─── TC5: 各段の Japanese 文字列が verbatim で含まれる ────────────────────

describe('Stage2 kishotenketsu inject — TC5: verbatim 含有', () => {
  it('TC5: ki / sho / ten / ketsu の値が一字一句そのまま埋まる', () => {
    const user = buildZeroWritingUserPrompt({
      ...baseInput4,
      approved_kishotenketsu: VALID_PLAN,
      kishotenketsu_approved_at: '2026-05-09T00:00:00Z',
    });
    expect(user).toContain(VALID_PLAN.ki);
    expect(user).toContain(VALID_PLAN.sho);
    expect(user).toContain(VALID_PLAN.ten);
    expect(user).toContain(VALID_PLAN.ketsu);
  });

  it('TC5-2: 各段のラベル「起 (導入...)」「承」「転」「結」の見出しが日本語で出る', () => {
    const user = buildZeroWritingUserPrompt({
      ...baseInput4,
      approved_kishotenketsu: VALID_PLAN,
      kishotenketsu_approved_at: '2026-05-09T00:00:00Z',
    });
    expect(user).toContain('起 (導入');
    expect(user).toContain('承 (深掘り');
    expect(user).toContain('転 (視点の転換');
    expect(user).toContain('結 (受容と祈り');
  });

  it('TC5-3: 旧 prompt の他セクション (ナラティブ・アーク / 感情曲線) も同居する', () => {
    const user = buildZeroWritingUserPrompt({
      ...baseInput4,
      approved_kishotenketsu: VALID_PLAN,
      kishotenketsu_approved_at: '2026-05-09T00:00:00Z',
    });
    expect(user).toContain('## ナラティブ・アーク');
    expect(user).toContain('## 感情曲線');
    expect(user).toContain('## H2 章構成');
  });
});
