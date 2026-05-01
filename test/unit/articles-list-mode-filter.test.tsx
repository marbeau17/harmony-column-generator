/**
 * filterArticlesByMode 単体テスト (K13)
 * --------------------------------------
 * dashboard 一覧ページのモードドロップダウンが利用する純ロジックを検証する。
 *
 * 規約（src/app/(dashboard)/dashboard/articles/page.tsx の useMemo フィルタチェーン
 * から切り出したもの）:
 *   - 'all'    : 全件をそのまま返す
 *   - 'zero'   : generation_mode === 'zero' のみ
 *   - 'source' : generation_mode === 'source' に加え、null / undefined（legacy）も含む
 */

import { describe, expect, it } from 'vitest';

import {
  filterArticlesByMode,
  type MaybeArticle,
} from '@/lib/utils/article-mode-filter';

// テスト用 fixture（ArticleItem を最小化したもの。id を付けて挙動を識別する）
interface FixtureArticle extends MaybeArticle {
  id: string;
}

const FIXTURE: FixtureArticle[] = [
  { id: 'z1', generation_mode: 'zero' },
  { id: 's1', generation_mode: 'source' },
  { id: 'z2', generation_mode: 'zero' },
  { id: 'legacy_null', generation_mode: null },
  { id: 'legacy_undef' /* generation_mode 未定義 */ },
  { id: 's2', generation_mode: 'source' },
];

describe('filterArticlesByMode', () => {
  it("mode='all' のとき入力配列をそのまま返す（並び保持）", () => {
    const result = filterArticlesByMode(FIXTURE, 'all');
    expect(result).toEqual(FIXTURE);
    // 件数も完全一致
    expect(result).toHaveLength(FIXTURE.length);
  });

  it("mode='zero' のとき generation_mode==='zero' のみを返す", () => {
    const result = filterArticlesByMode(FIXTURE, 'zero');
    const ids = result.map((a) => a.id);
    expect(ids).toEqual(['z1', 'z2']);
    // source / null / undefined は除外される
    expect(ids).not.toContain('s1');
    expect(ids).not.toContain('s2');
    expect(ids).not.toContain('legacy_null');
    expect(ids).not.toContain('legacy_undef');
  });

  it("mode='source' のとき 'source' + null + undefined（legacy 扱い）を返す", () => {
    const result = filterArticlesByMode(FIXTURE, 'source');
    const ids = result.map((a) => a.id);
    // source 明示 2 件 + legacy null 1 件 + legacy undefined 1 件 = 計 4 件
    expect(ids).toEqual(['s1', 'legacy_null', 'legacy_undef', 's2']);
    // zero は除外される
    expect(ids).not.toContain('z1');
    expect(ids).not.toContain('z2');
  });

  it('空配列を入力すると、どの mode でも空配列を返す', () => {
    const empty: FixtureArticle[] = [];
    expect(filterArticlesByMode(empty, 'all')).toEqual([]);
    expect(filterArticlesByMode(empty, 'zero')).toEqual([]);
    expect(filterArticlesByMode(empty, 'source')).toEqual([]);
  });

  it('入力配列を破壊しない（イミュータブル）', () => {
    const snapshot = FIXTURE.map((a) => ({ ...a }));
    filterArticlesByMode(FIXTURE, 'zero');
    filterArticlesByMode(FIXTURE, 'source');
    filterArticlesByMode(FIXTURE, 'all');
    // 元配列は変化していないこと
    expect(FIXTURE).toEqual(snapshot);
  });

  it("legacy 行のみ（generation_mode が null/undefined だけ）でも mode='source' で全件返る", () => {
    const legacyOnly: FixtureArticle[] = [
      { id: 'a', generation_mode: null },
      { id: 'b' },
      { id: 'c', generation_mode: undefined },
    ];
    const result = filterArticlesByMode(legacyOnly, 'source');
    expect(result).toHaveLength(3);
    // mode='zero' では legacy は 1 件も拾われない
    expect(filterArticlesByMode(legacyOnly, 'zero')).toEqual([]);
  });
});
