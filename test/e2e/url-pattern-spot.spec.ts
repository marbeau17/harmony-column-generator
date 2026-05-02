/**
 * P5-44: URL パターン Production Spot Check (E2E)
 *
 * production smoke の一部として、API 経由で取得した記事 / ハブ HTML の
 * canonical URL が新形式 (`/spiritual/column/{slug}/` / `/spiritual/column/`)
 * に従うことを spot 検証する。
 *
 * 制約:
 *   - FTP 反映は今後の作業のため、ここでは API レスポンスから HTML を取り出して検査する。
 *   - HTML を返す未認証 API が存在しない場合は skip する。
 *
 * 実行コマンド:
 *   TEST_BASE_URL=https://blogauto-pi.vercel.app npx playwright test url-pattern-spot
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.TEST_BASE_URL ?? 'https://blogauto-pi.vercel.app';

/**
 * 公開 (未認証可) で記事 HTML を返却する候補エンドポイント。
 * 1 つでも 200 を返したら本物の HTML として canonical を検査する。
 * いずれも 401/404 の場合は skip する (FTP 反映待ち)。
 */
const ARTICLE_HTML_CANDIDATES = [
  '/api/public/sample-article',
  '/api/articles/sample/preview',
];

const HUB_HTML_CANDIDATES = [
  '/api/public/hub-preview',
  '/api/hub/preview',
];

/** HTML レスポンスの canonical URL を抽出 */
function extractCanonical(html: string): string | null {
  const m = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
  return m ? m[1] : null;
}

test.describe('URL pattern spot (P5-44 production HTML pinning)', () => {
  test('P1. 記事 HTML の canonical は /spiritual/column/{slug}/ 形式 (取得不可なら skip)', async ({ request }) => {
    let html: string | null = null;
    for (const path of ARTICLE_HTML_CANDIDATES) {
      const res = await request.get(`${BASE_URL}${path}`);
      if (res.ok()) {
        const ct = res.headers()['content-type'] ?? '';
        if (ct.includes('text/html')) {
          html = await res.text();
          break;
        }
      }
    }
    test.skip(html === null, 'public 記事 HTML API が未提供 (FTP 反映フェーズで本検証を有効化)');

    const canonical = extractCanonical(html ?? '');
    expect(canonical, 'canonical link が見つからない').not.toBeNull();
    // 新形式: /spiritual/column/{slug}/ で trailing slash 必須
    expect(canonical).toMatch(/\/spiritual\/column\/[^/]+\/$/);
    // 旧形式の混入が無い
    expect(canonical).not.toMatch(/\.html(?:[?#]|$)/);
    expect(canonical).not.toContain('/columns/');
  });

  test('P2. ハブ HTML の canonical は /spiritual/column/ (単数形) 形式 (取得不可なら skip)', async ({ request }) => {
    let html: string | null = null;
    for (const path of HUB_HTML_CANDIDATES) {
      const res = await request.get(`${BASE_URL}${path}`);
      if (res.ok()) {
        const ct = res.headers()['content-type'] ?? '';
        if (ct.includes('text/html')) {
          html = await res.text();
          break;
        }
      }
    }
    test.skip(html === null, 'public ハブ HTML API が未提供 (FTP 反映フェーズで本検証を有効化)');

    const canonical = extractCanonical(html ?? '');
    expect(canonical, 'canonical link が見つからない').not.toBeNull();
    // page 1 = /spiritual/column/  /  page 2+ = /spiritual/column/page/{N}/
    expect(canonical).toMatch(/\/spiritual\/column\/(?:page\/\d+\/)?$/);
    // 旧 /columns/ (複数形バグ) が再発していない
    expect(canonical).not.toContain('/columns/');
    expect(canonical).not.toMatch(/\.html(?:[?#]|$)/);
  });
});
