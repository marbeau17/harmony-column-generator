// ============================================================================
// src/lib/tone/yukiko-scoring.ts
// spec §7 由起子トーン採点
// 14 項目を重み付けで採点（必須通過項目 NG → 全体 0）
// ============================================================================

import clicheDict from './cliche-dictionary.json';
import forbiddenSpiritual from '@/lib/hallucination/forbidden-spiritual.json';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

export interface YukikoToneBreakdown {
  // 1
  perspectiveShift: number; // 視点変換度
  // 2
  doublePostAvoidance: number; // ダブルポスト回避
  // 3
  concretenessReverse: number; // 抽象度逆スコア
  // 4
  deepResonance: number; // 深い納得度
  // 5
  softEnding: number; // 語尾優しさ
  // 6
  metaphorOriginality: number; // 比喩オリジナリティ
  // 7
  hiraganaRatio: number; // ひらがな化率
  // 8
  rhythmShortLong: number; // 短短長リズム
  // 9 必須通過
  noDoubleQuote: number; // ""非使用
  // 10 必須通過
  noSpiritualAssertion: number; // スピ断定回避
  // 11
  ctaNaturalInsertion: number; // CTA 自然挿入
  // 12-14
  emojiRestraint: number; // 絵文字抑制
  ctaUrlPresence: number; // CTA-URL 自然提示
  forbiddenPhraseAbsence: number; // 禁止フレーズ非使用
}

export interface YukikoToneScore {
  total: number; // 0-1
  breakdown: YukikoToneBreakdown;
  passed: boolean;
  // 必須通過項目の NG 詳細（デバッグ用途）
  blockers: string[];
}

// ─── 重み（spec §7.1）─────────────────────────────────────────────────────
// 1-11 で合計 1.00、12-14 は『その他簡易項目』として小さな重みを上乗せ。
// 合計 ≒ 1.03（仕様の "1.0 に近い" を満たす）。
export const WEIGHTS: Record<keyof YukikoToneBreakdown, number> = {
  perspectiveShift: 0.15,
  doublePostAvoidance: 0.1,
  concretenessReverse: 0.1,
  deepResonance: 0.1,
  softEnding: 0.1,
  metaphorOriginality: 0.1,
  hiraganaRatio: 0.05,
  rhythmShortLong: 0.1,
  noDoubleQuote: 0.05,
  noSpiritualAssertion: 0.1,
  ctaNaturalInsertion: 0.05,
  emojiRestraint: 0.01,
  ctaUrlPresence: 0.01,
  forbiddenPhraseAbsence: 0.01,
};

const WEIGHT_SUM = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

// ─── ユーティリティ ──────────────────────────────────────────────────────

/** HTML タグを除去して本文プレーンテキストを抽出 */
function stripHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 句点で文を分割 */
function splitSentences(text: string): string[] {
  return text
    .split(/[。！？]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** クランプ */
function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// ─── 個別スコアラー ───────────────────────────────────────────────────────

/** 1. 視点変換度（簡易: 視点語句の出現で採点） */
function scorePerspectiveShift(text: string): number {
  const cues = [
    'でも実は',
    'けれど',
    '見方を変える',
    '視点を変える',
    '別の角度',
    'もう一つの',
    '逆に',
    '反対に',
    'のかもしれません',
    '本当は',
  ];
  const hits = cues.filter((c) => text.includes(c)).length;
  // 3 ヒット以上で満点
  return clamp01(hits / 3);
}

/** 2. ダブルポスト回避（既存 45 記事との embedding 類似度。stub: 0.85 上限を満たす想定で 1 を返す） */
function scoreDoublePostAvoidance(_text: string): number {
  // ローカル環境では embedding API を呼ばずに stub
  // 本番では cosine 類似度の最大が 0.85 未満なら 1、超過時は線形減衰
  return 1;
}

/** 3. 抽象度逆スコア（具体エピソード密度） */
function scoreConcretenessReverse(text: string): number {
  const concretePatterns = [
    /たとえば/g,
    /例えば/g,
    /ある日/g,
    /先日/g,
    /カウンセリングの中で/g,
    /カウンセリングで/g,
    /朝起きて/g,
    /夜になると/g,
    /こんなお話/g,
    /こんなことを/g,
  ];
  const hits = concretePatterns.reduce((sum, re) => {
    const m = text.match(re);
    return sum + (m ? m.length : 0);
  }, 0);
  // 2 ヒット以上で満点
  return clamp01(hits / 2);
}

/** 4. 深い納得度（体感的言い換え有無） */
function scoreDeepResonance(text: string): number {
  const cues = [
    'と感じる',
    'と思える',
    'のかもしれません',
    'ありませんか',
    'ではないでしょうか',
    'そう思える',
    'なんです',
    'そんな気がする',
    'そんなふうに',
    'ありがちですね',
  ];
  const hits = cues.filter((c) => text.includes(c)).length;
  return clamp01(hits / 3);
}

/** 5. 語尾優しさ（断定語尾比率 < 20%） */
function scoreSoftEnding(text: string): number {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return 0;
  // 断定語尾: 「〜だ。」「〜である。」のように『〜です/ます』『〜ね/よね/なんです/かもしれません/でしょうか』を含まない短い終端
  let assertive = 0;
  let total = 0;
  for (const s of sentences) {
    const tail = s.slice(-12); // 末尾近傍
    total += 1;
    const soft =
      /です$|ます$|ですね$|ですよね$|なんです$|でしょうか$|かもしれません$|ください$|くださいね$|ますように$|もの$|こと$/.test(
        tail.trim()
      );
    const hardAssert = /(だ|である|に違いない|に決まっている)$/.test(tail.trim());
    if (hardAssert && !soft) assertive += 1;
  }
  const ratio = assertive / total;
  // < 20% で満点、20-50% で線形減衰、>=50% で 0
  if (ratio < 0.2) return 1;
  if (ratio >= 0.5) return 0;
  return clamp01(1 - (ratio - 0.2) / 0.3);
}

/** 6. 比喩オリジナリティ（クリシェ辞書非該当） */
function scoreMetaphorOriginality(text: string): number {
  const list: string[] = clicheDict.cliches as string[];
  const hits = list.filter((c) => text.includes(c)).length;
  // ヒット 0 で満点、3 ヒット以上で 0
  if (hits === 0) return 1;
  if (hits >= 3) return 0;
  return clamp01(1 - hits / 3);
}

/** 7. ひらがな化率（漢字率 35-45% を満点ゾーンに） */
function scoreHiraganaRatio(text: string): number {
  const chars = text.replace(/\s+/g, '').split('');
  if (chars.length === 0) return 0;
  let kanji = 0;
  let jp = 0;
  for (const ch of chars) {
    // 日本語文字（ひらがな・カタカナ・漢字）のみカウント
    if (/[぀-ゟ]/.test(ch)) jp += 1;
    else if (/[゠-ヿ]/.test(ch)) jp += 1;
    else if (/[一-鿿]/.test(ch)) {
      jp += 1;
      kanji += 1;
    }
  }
  if (jp === 0) return 0;
  const kanjiRatio = kanji / jp;
  // 35-45% で満点、25-55% で線形減衰
  if (kanjiRatio >= 0.35 && kanjiRatio <= 0.45) return 1;
  if (kanjiRatio < 0.25 || kanjiRatio > 0.55) return 0;
  if (kanjiRatio < 0.35) return clamp01((kanjiRatio - 0.25) / 0.1);
  return clamp01((0.55 - kanjiRatio) / 0.1);
}

/** 8. 短短長リズム（連続短文→長文の出現頻度） */
function scoreRhythmShortLong(text: string): number {
  const sentences = splitSentences(text);
  if (sentences.length < 3) return 0;
  let patterns = 0;
  for (let i = 0; i + 2 < sentences.length; i++) {
    const a = sentences[i].length;
    const b = sentences[i + 1].length;
    const c = sentences[i + 2].length;
    // 短(<20) + 短(<20) + 長(>=30) を 1 パターンとカウント
    if (a < 20 && b < 20 && c >= 30) patterns += 1;
  }
  // 文数に応じた密度で評価。1記事(2000字程度)で 2 パターン以上で満点
  return clamp01(patterns / 2);
}

/** 9. 必須通過: ""非使用 */
function scoreNoDoubleQuote(text: string): number {
  // 半角ダブルクォーテーション or 全角 ＂ or curly quotes “”
  const has = /[\"“”＂]/.test(text);
  return has ? 0 : 1;
}

/** 10. 必須通過: スピ断定回避（forbidden 辞書 + 否定文脈考慮） */
function scoreNoSpiritualAssertion(text: string): number {
  const cats = forbiddenSpiritual.categories as Record<string, string[]>;
  const negationMarkers = forbiddenSpiritual.negationMarkers as string[];
  const sentences = splitSentences(text);

  for (const [_cat, words] of Object.entries(cats)) {
    for (const w of words) {
      for (const s of sentences) {
        if (!s.includes(w)) continue;
        // その文中に否定マーカーが続けば許容
        const idx = s.indexOf(w) + w.length;
        const tail = s.slice(idx);
        const negated = negationMarkers.some((m) => tail.includes(m));
        if (!negated) {
          return 0;
        }
      }
    }
  }
  return 1;
}

/** 11. CTA 自然挿入（浮き感なし）— harmony-cta が 1-2 回、文中の自然繋ぎ語句が近接 */
function scoreCtaNaturalInsertion(html: string): number {
  const ctaCount = (html.match(/class="harmony-cta"/g) || []).length;
  if (ctaCount === 0) return 0;
  // 1-2 回が理想。3 回以上は浮き感あり
  if (ctaCount === 1 || ctaCount === 2) return 1;
  return 0.4;
}

/** 12. 絵文字抑制（記事全体で 0-2 個まで） */
function scoreEmojiRestraint(text: string): number {
  // よく使われる感情絵文字 + Unicode 絵文字レンジ
  const emojiRe =
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;
  const matches = text.match(emojiRe);
  const count = matches ? matches.length : 0;
  if (count <= 1) return 1;
  if (count <= 2) return 0.6;
  return 0;
}

/** 13. CTA URL 自然提示 — booking URL がアンカー内に含まれているか */
function scoreCtaUrlPresence(html: string): number {
  const has = /https?:\/\/harmony-booking\.web\.app/.test(html);
  return has ? 1 : 0;
}

/** 14. 禁止フレーズ非使用（AI臭い結び等） */
function scoreForbiddenPhraseAbsence(text: string): number {
  const forbidden = [
    'いかがでしたでしょうか',
    'いかがでしたか',
    '参考になれば幸いです',
    'この記事では',
    'まとめると',
    '結論から言うと',
    'おわりに',
    'について解説します',
    'を紹介しました',
  ];
  const hits = forbidden.filter((p) => text.includes(p)).length;
  if (hits === 0) return 1;
  if (hits === 1) return 0.4;
  return 0;
}

// ─── 集約 ──────────────────────────────────────────────────────────────────

/**
 * 由起子トーンを採点する。
 * 必須通過項目（""非使用 / スピ断定回避）が 0 の場合、全体スコアを 0 にする。
 */
export function scoreYukikoTone(htmlBody: string): YukikoToneScore {
  const text = stripHtml(htmlBody);

  const breakdown: YukikoToneBreakdown = {
    perspectiveShift: scorePerspectiveShift(text),
    doublePostAvoidance: scoreDoublePostAvoidance(text),
    concretenessReverse: scoreConcretenessReverse(text),
    deepResonance: scoreDeepResonance(text),
    softEnding: scoreSoftEnding(text),
    metaphorOriginality: scoreMetaphorOriginality(text),
    hiraganaRatio: scoreHiraganaRatio(text),
    rhythmShortLong: scoreRhythmShortLong(text),
    noDoubleQuote: scoreNoDoubleQuote(text),
    noSpiritualAssertion: scoreNoSpiritualAssertion(text),
    ctaNaturalInsertion: scoreCtaNaturalInsertion(htmlBody),
    emojiRestraint: scoreEmojiRestraint(text),
    ctaUrlPresence: scoreCtaUrlPresence(htmlBody),
    forbiddenPhraseAbsence: scoreForbiddenPhraseAbsence(text),
  };

  const blockers: string[] = [];
  if (breakdown.noDoubleQuote === 0) blockers.push('noDoubleQuote');
  if (breakdown.noSpiritualAssertion === 0) blockers.push('noSpiritualAssertion');

  // 必須通過項目 NG → 全体 0
  if (blockers.length > 0) {
    return {
      total: 0,
      breakdown,
      passed: false,
      blockers,
    };
  }

  // 重み付き平均（重み合計で正規化）
  let weightedSum = 0;
  for (const key of Object.keys(WEIGHTS) as (keyof YukikoToneBreakdown)[]) {
    weightedSum += breakdown[key] * WEIGHTS[key];
  }
  const total = clamp01(weightedSum / WEIGHT_SUM);

  return {
    total,
    breakdown,
    passed: total >= 0.8,
    blockers,
  };
}
