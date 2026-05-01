/**
 * 生成モード（generation_mode）による記事フィルタヘルパ
 * -----------------------------------------------------
 * dashboard 一覧ページのモードドロップダウンが利用する純ロジック。
 *
 * 規約（既存挙動と一致させる）:
 *   - 'all'    : 全件をそのまま返す（並びは保持）
 *   - 'zero'   : generation_mode === 'zero' のみ
 *   - 'source' : generation_mode === 'source' に加え、null / undefined（legacy）も含む
 *
 * legacy 行（generation_mode が null / undefined）は P5 以前のソース記事として
 * 'source' 扱いするのが UI 上の合意（dashboard/articles/page.tsx 参照）。
 */

export type ArticleMode = 'all' | 'zero' | 'source';

export interface MaybeArticle {
  generation_mode?: string | null;
}

/**
 * generation_mode で配列をフィルタする純関数。
 * 入力配列は破壊しない（filter は新しい配列を返すため）。
 */
export function filterArticlesByMode<T extends MaybeArticle>(
  articles: T[],
  mode: ArticleMode,
): T[] {
  if (mode === 'all') return articles;
  if (mode === 'zero') {
    return articles.filter((a) => a.generation_mode === 'zero');
  }
  // mode === 'source'
  return articles.filter(
    (a) => a.generation_mode === 'source' || !a.generation_mode,
  );
}
