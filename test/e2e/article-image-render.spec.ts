/**
 * 本番公開記事 <img> レンダリング検証 (手動実行専用)
 *
 * Harmony Column Generator が本番 (https://harmony-mc.com) にデプロイした
 * 記事 HTML 内で、画像タグ (<img>) が正しくレンダリングされ、コメントアウト
 * (<!--<img ...) されたまま公開されていないことを fetch ベースで検証する。
 *
 * P5-57 (本文/サマリー画像が <!--<img ...--> としてコメントアウトされたまま
 * 公開されてしまった事象) の regression を防ぐためのガード。
 *
 * CI には組み込まない (本番データ確認用)。
 * 実行は環境変数 HARMONY_LIVE_TEST=1 を明示した時のみ:
 *
 *   HARMONY_LIVE_TEST=1 npx playwright test article-image-render
 *
 * 任意で BASE_URL を上書き:
 *   HARMONY_LIVE_TEST=1 HARMONY_PUBLIC_URL=https://harmony-mc.com \
 *     npx playwright test article-image-render
 */
import { test, expect, request as pwRequest } from '@playwright/test';

const BASE_URL = process.env.HARMONY_PUBLIC_URL ?? 'https://harmony-mc.com';
const LIVE_ENABLED = process.env.HARMONY_LIVE_TEST === '1';

/**
 * 検証対象の本番公開記事 URL 群。
 * すべて /spiritual/column/<slug>/index.html 形式。
 */
const TARGET_PATHS: string[] = [
  '/spiritual/column/law-of-attraction/index.html',
  '/spiritual/column/healing/index.html',
];

/**
 * 大文字小文字を区別せず needle が haystack に含まれる回数を返す。
 * 単純な split ベース実装 (正規表現特殊文字を含むキーワードでも安全)。
 */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

/**
 * HTML 文字列から <img ...> タグを抽出する。
 * コメント (<!-- ... -->) は除外してから走査する。
 */
function extractImgTags(html: string): string[] {
  // コメント領域を除去 (コメント内の <img は別途検出する)
  const stripped = html.replace(/<!--[\s\S]*?-->/g, '');
  const matches = stripped.match(/<img\b[^>]*>/gi);
  return matches ?? [];
}

/**
 * <img ...> タグから src 属性値を抽出する。
 */
function extractSrc(imgTag: string): string | null {
  const m = imgTag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
  return m ? m[1] : null;
}

test.describe('本番公開記事 <img> レンダリング検証 (手動実行)', () => {
  test.skip(!LIVE_ENABLED, 'HARMONY_LIVE_TEST=1 が指定されていないためスキップ');

  for (const path of TARGET_PATHS) {
    test(`${path} は <img> がコメントアウトされておらず相対パスで描画される`, async () => {
      const ctx = await pwRequest.newContext();
      const url = `${BASE_URL}${path}`;
      const res = await ctx.get(url, { timeout: 30_000 });
      expect(res.status(), `GET ${url} status`).toBe(200);

      const html = await res.text();
      expect(html.length, 'HTML 本文が空ではない').toBeGreaterThan(0);

      // 1. P5-57 regression guard: コメントアウトされた <img が 0 件
      expect(
        countOccurrences(html, '<!--<img'),
        'コメントアウトされた <img タグ (<!--<img) が残っていないこと',
      ).toBe(0);

      // 2. <img タグが 2 個以上含まれる (body + summary)
      const imgTags = extractImgTags(html);
      expect(
        imgTags.length,
        `body + summary 用に <img> タグが 2 個以上含まれる (実際: ${imgTags.length})`,
      ).toBeGreaterThanOrEqual(2);

      // 3. hero img もテンプレ側で 1 個含まれる
      //    body / summary / hero の合計で 3 個以上を期待
      expect(
        imgTags.length,
        `hero + body + summary で <img> タグが 3 個以上含まれる (実際: ${imgTags.length})`,
      ).toBeGreaterThanOrEqual(3);

      // 4. 各 <img> の src が相対パス (./images/...jpg) 形式
      for (const tag of imgTags) {
        const src = extractSrc(tag);
        expect(src, `<img> タグに src 属性が存在: ${tag}`).not.toBeNull();
        expect(
          src!,
          `src は相対パス (./images/...jpg) 形式であるべき: ${src}`,
        ).toMatch(/^\.\/images\/[^"'\s]+\.jpg$/i);
      }

      await ctx.dispose();
    });
  }
});
