/**
 * Publish Control Baseline E2E
 *
 * Step 1 リファクタ前の現状挙動を pin するベースライン。
 * 主要 API エンドポイントの「認証必須」が崩れていないことを確認する。
 *
 * 目的:
 *   - /login が render できる (smoke)
 *   - /api/* が未認証で 401 を返す (auth gate baseline)
 *
 * 実行コマンド:
 *   TEST_BASE_URL=http://localhost:3000 npx playwright test publish-control-baseline
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';

// テスト用ダミー article id (実在しなくても、認証チェックは route ハンドラの先頭で行われる想定)
const DUMMY_ARTICLE_ID = '00000000-0000-0000-0000-000000000000';

test.describe('Publish Control Baseline (Step 1 リファクタ前 pin)', () => {
  test('B1. /login が 200 で render される', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/login`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Harmony|Column|Login/i);
  });

  test('B2. /api/articles 一覧が認証なしで 401 を返す', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/articles`);
    expect(res.status()).toBe(401);
  });

  test('B3. /api/hub/rebuild が認証なしで 401 を返す', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/hub/rebuild`, {
      data: {},
    });
    expect(res.status()).toBe(401);
  });

  test('B4. /api/articles/[id]/deploy が認証なしで 401 を返す', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/articles/${DUMMY_ARTICLE_ID}/deploy`, {
      data: {},
    });
    expect(res.status()).toBe(401);
  });

  test('B5. /api/articles/[id]/visibility が認証なしで 401 を返す', async ({ request }) => {
    // visibility route は POST のみ受け付ける。
    // 未認証時は 401。PUBLISH_CONTROL_V2 が無効な環境では 404。どちらも acceptable。
    const res = await request.post(`${BASE_URL}/api/articles/${DUMMY_ARTICLE_ID}/visibility`, {
      data: { visible: false, requestId: '0'.repeat(26) },
    });
    expect([401, 404]).toContain(res.status());
  });
});
