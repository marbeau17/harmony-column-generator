// ============================================================================
// test/unit/keyword-density-tokenize.test.ts
// keyword_density トークナイザーの regression テスト
// ----------------------------------------------------------------------------
// keyword 文字列 (UI 入力 / DB に格納された CSV 形式) を
// 「半角/全角スペース」「半角/全角コンマ」で分割し、
// 空要素を除外し、重複を排除した一意なトークン配列に正規化する仕様を固定する。
//
// 既存実装 (`src/lib/zero-gen/run-completion.ts` 内 `split(/[,、\s]+/)`) と
// `src/lib/seo/score-calculator.ts` 内 `keywordTokens()` の挙動を統合した
// 想定挙動を pin down する。本ファイルはテスト専用であり、本体実装には
// 触らない (グローバル §5「無許可のアーキテクチャ変更禁止」を遵守)。
// ============================================================================

import { describe, it, expect } from 'vitest';

/**
 * keyword_density 計算で使用するトークナイザー。
 *
 * - 半角スペース / 全角スペース / 半角コンマ "," / 全角コンマ "、" を区切りとする
 * - 各トークンは前後の空白をトリム
 * - 空文字列は除外
 * - 出現順序を維持しつつ重複を排除する
 */
function tokenizeKeyword(keyword: string): string[] {
  if (!keyword) return [];
  const raw = keyword
    .split(/[,、\s　]+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const t of raw) {
    if (!seen.has(t)) {
      seen.add(t);
      unique.push(t);
    }
  }
  return unique;
}

describe('tokenizeKeyword (keyword_density 用 regression)', () => {
  it('1. 単一キーワード "ヒーリング" → ["ヒーリング"]', () => {
    expect(tokenizeKeyword('ヒーリング')).toEqual(['ヒーリング']);
  });

  it('2. 単一キーワード (空白区切り) "気功 自然" → ["気功", "自然"]', () => {
    expect(tokenizeKeyword('気功 自然')).toEqual(['気功', '自然']);
  });

  it('3. 複数キーワード (コンマ区切り) "気功 自然, 東洋医学 自然" → unique ["気功", "自然", "東洋医学"]', () => {
    expect(tokenizeKeyword('気功 自然, 東洋医学 自然')).toEqual([
      '気功',
      '自然',
      '東洋医学',
    ]);
  });

  it('4. コンマだけ区切り "A,B" → ["A", "B"]', () => {
    expect(tokenizeKeyword('A,B')).toEqual(['A', 'B']);
  });

  it('5. コンマ+空白 "A, B" → ["A", "B"]', () => {
    expect(tokenizeKeyword('A, B')).toEqual(['A', 'B']);
  });

  it('6. 全角コンマ "A、B" → ["A", "B"]', () => {
    expect(tokenizeKeyword('A、B')).toEqual(['A', 'B']);
  });

  it('7. 末尾コンマ "A," → ["A"] (空トークンを混入させない)', () => {
    const tokens = tokenizeKeyword('A,');
    expect(tokens).toEqual(['A']);
    expect(tokens).not.toContain('A,');
    expect(tokens).not.toContain('');
  });

  it('8. 重複トークン "A B, A C" → ["A", "B", "C"]', () => {
    expect(tokenizeKeyword('A B, A C')).toEqual(['A', 'B', 'C']);
  });

  // ─── 補強ケース (regression hardening) ─────────────────────────────────────

  it('9. 空文字列 → []', () => {
    expect(tokenizeKeyword('')).toEqual([]);
  });

  it('10. 全角スペース区切り "気功　自然" → ["気功", "自然"]', () => {
    expect(tokenizeKeyword('気功　自然')).toEqual(['気功', '自然']);
  });

  it('11. 連続区切り "A,, B" → ["A", "B"] (空トークン無し)', () => {
    expect(tokenizeKeyword('A,, B')).toEqual(['A', 'B']);
  });
});
