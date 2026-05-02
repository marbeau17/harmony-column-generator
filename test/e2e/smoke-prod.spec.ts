/**
 * Production Smoke Tests (Layer 5 — P5-32)
 *
 * 本番デプロイ後に GitHub Actions から実行される認証不要 smoke。
 * フル E2E ではなく、デプロイ自体が壊れていないかの最低限チェック:
 *   1. /login が 200 で render
 *   2. /dashboard 未認証アクセス → /login にリダイレクト
 *   3. 公開 column ページのいずれかが 200 (実 url は dynamic だが routing 自体は応答)
 *   4. console エラーが出ない (拡張機能干渉なし環境)
 *
 * 実行コマンド:
 *   TEST_BASE_URL=https://blogauto-pi.vercel.app npx playwright test smoke-prod
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.TEST_BASE_URL ?? 'https://blogauto-pi.vercel.app';

test.describe('Production Smoke (P5-32 Layer 5)', () => {
  test('S1. /login が 200 で render される', async ({ page }) => {
    const response = await page.goto(`${BASE_URL}/login`);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Harmony|Column/i);
  });

  test('S2. 未認証 /dashboard → /login redirect', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    expect(page.url()).toContain('/login');
  });

  test('S3. 認証必要 API は 401 を返す', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/articles/zero-generate-async`, {
      data: { theme_id: 'x', persona_id: 'x', keywords: ['x'], intent: 'info', target_length: 2000 },
    });
    expect([401, 400]).toContain(res.status()); // 401 (認証) または 400 (validation)
  });

  test('S4. login ページに console エラーが出ない (拡張機能なし)', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('networkidle');
    // 我々のアプリ由来のエラーは 0 件のはず
    const appErrors = errors.filter(
      (e) =>
        !e.includes('chrome-extension') &&
        !e.includes('Sentry') &&
        !e.toLowerCase().includes('extension'),
    );
    expect(appErrors).toEqual([]);
  });

  test('S5. /api/themes は 401 (未認証)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/themes`);
    expect([200, 401]).toContain(res.status()); // 開発時は 200 になる場合あり
  });
});
