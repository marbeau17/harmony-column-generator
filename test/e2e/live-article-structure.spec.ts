/**
 * 本番公開記事 HTML 構造検証 (手動実行専用)
 *
 * Harmony Column Generator から本番 (https://harmony-mc.com) にデプロイ済みの
 * 記事 HTML が、テンプレ要素（プロフィール / 関連記事 / footer / Copyright /
 * disclaimer）を「ちょうど 1 回」だけ含むことを fetch ベースで検証する。
 *
 * CI には組み込まない (本番データ確認用)。
 * 実行は環境変数 HARMONY_LIVE_TEST=1 を明示した時のみ:
 *
 *   HARMONY_LIVE_TEST=1 npx playwright test live-article-structure
 *
 * 任意で BASE_URL を上書き:
 *   HARMONY_LIVE_TEST=1 HARMONY_PUBLIC_URL=https://harmony-mc.com \
 *     npx playwright test live-article-structure
 */
import { test, expect, request as pwRequest } from '@playwright/test';

const BASE_URL = process.env.HARMONY_PUBLIC_URL ?? 'https://harmony-mc.com';
const LIVE_ENABLED = process.env.HARMONY_LIVE_TEST === '1';

/**
 * 検証対象の本番公開記事 URL 群。
 * 必要に応じて追加可能。すべて /spiritual/column/<slug>/index.html 形式。
 */
const TARGET_PATHS: string[] = [
  '/spiritual/column/law-of-attraction/index.html',
];

/**
 * 大文字小文字を区別せず needle が haystack に含まれる回数を返す。
 * 単純な split ベース実装 (正規表現特殊文字を含むキーワードでも安全)。
 */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

test.describe('本番公開記事 HTML 構造検証 (手動実行)', () => {
  test.skip(!LIVE_ENABLED, 'HARMONY_LIVE_TEST=1 が指定されていないためスキップ');

  for (const path of TARGET_PATHS) {
    test(`${path} はテンプレ要素をちょうど 1 回ずつ含む`, async () => {
      const ctx = await pwRequest.newContext();
      const url = `${BASE_URL}${path}`;
      const res = await ctx.get(url, { timeout: 30_000 });
      expect(res.status(), `GET ${url} status`).toBe(200);

      const html = await res.text();
      expect(html.length, 'HTML 本文が空ではない').toBeGreaterThan(0);

      // 1. 著者プロフィール「小林由起子」が 1 回だけ
      expect(countOccurrences(html, '小林由起子'), 'プロフィール: 小林由起子').toBe(1);

      // 2. 「関連記事」セクションが 1 回だけ
      expect(countOccurrences(html, '関連記事'), '関連記事セクション').toBe(1);

      // 3. <footer タグが 1 回だけ
      expect(countOccurrences(html, '<footer'), '<footer タグ数').toBe(1);

      // 4. 「Copyright」記述が 1 回だけ
      expect(countOccurrences(html, 'Copyright'), 'Copyright').toBe(1);

      // 5. 免責 (「本コラムの内容」) が 1 回だけ
      expect(countOccurrences(html, '本コラムの内容'), 'disclaimer: 本コラムの内容').toBe(1);

      await ctx.dispose();
    });
  }
});
