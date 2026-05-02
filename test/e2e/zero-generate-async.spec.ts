/**
 * Zero-Generate Async E2E (P5-22 — 案B 案C 統合検証)
 *
 * 検証ケース:
 *   - T1: 単発生成 — 200ms job_id 即返、バナーが queued → stage1 と表示更新
 *   - T4: job not found エラーが起きない (Supabase 共有ストア)
 *   - T5: 二重投入防止 — POST 後にボタンと input が disabled
 *   - 認証: 未ログインで 401
 *
 * 実行前提:
 *   - dev server 起動 (npm run dev)
 *   - MONKEY_SUPABASE_URL / MONKEY_SUPABASE_SERVICE_ROLE 設定
 *   - TEST_USER_PASSWORD で auth 突破可能
 *
 * 注意:
 *   - Gemini 実コール (~$0.18/test) を避けるため、stage1 開始確認のみで止める
 *     (record/cancel パターン: バナー表示 → DB から job 削除して終了)
 *   - 完走テストは別 spec (高コスト、CI でのみ unskip 推奨)
 */
import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers/auth';

const BASE_URL = process.env.TEST_BASE_URL ?? 'https://blogauto-pi.vercel.app';

test.describe.configure({ mode: 'serial' });

test.describe('Zero-Generate Async (P5-22)', () => {
  test.beforeAll(async () => {
    if (!process.env.TEST_USER_PASSWORD) {
      test.skip(true, 'TEST_USER_PASSWORD 未設定 — auth 突破不可、E2E スキップ');
    }
  });

  test('T11. 認証: 未ログインで POST /zero-generate-async は 401', async ({
    request,
  }) => {
    const res = await request.post(`${BASE_URL}/api/articles/zero-generate-async`, {
      data: {
        theme_id: '00000000-0000-0000-0000-000000000000',
        persona_id: '00000000-0000-0000-0000-000000000000',
        keywords: ['テスト'],
        intent: 'info',
        target_length: 2000,
      },
    });
    expect(res.status()).toBe(401);
  });

  test('T1+T4+T5: フォーム送信 → 即返 + バナー表示 + 二重投入防止', async ({
    page,
  }) => {
    await ensureLoggedIn(page);
    await page.goto(`${BASE_URL}/dashboard/articles/new-from-scratch`);

    // テーマ + ペルソナが読み込まれるまで待つ
    await page.waitForSelector('select#theme option:nth-child(2)', { timeout: 15_000 });
    await page.waitForSelector('select#persona option:nth-child(2)', { timeout: 15_000 });

    // 入力
    const themeSelect = page.locator('select#theme');
    const themeValue = await themeSelect
      .locator('option:nth-child(2)')
      .getAttribute('value');
    if (!themeValue) test.fail(true, 'テーマ option value が取れない');
    await themeSelect.selectOption(themeValue!);

    const personaSelect = page.locator('select#persona');
    const personaValue = await personaSelect
      .locator('option:nth-child(2)')
      .getAttribute('value');
    if (!personaValue) test.fail(true, 'ペルソナ option value が取れない');
    await personaSelect.selectOption(personaValue!);

    // キーワード入力
    const kwInput = page.locator('input#keywords');
    await kwInput.fill('チャクラ');
    await kwInput.press('Enter');

    // 意図
    await page.getByRole('button', { name: /情報提供/ }).click();

    // ── 「生成」ボタンクリック → POST → 即返 ───────────────────────
    const responsePromise = page.waitForResponse(
      (r) =>
        r.url().includes('/api/articles/zero-generate-async') &&
        r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '生成' }).click();
    const res = await responsePromise;
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.job_id).toMatch(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    );

    // ── T1: フォーム上の「生成中」バー表示 ───────────────────────
    await expect(
      page.getByText(/バックグラウンドで生成中/),
    ).toBeVisible({ timeout: 5_000 });

    // ── T1: グローバルバナー表示 ───────────────────────────────
    await expect(page.getByText(/Stage|生成中|待機中/)).toBeVisible({
      timeout: 10_000,
    });

    // ── T5: 「生成」ボタンが disabled に変わる ─────────────────
    const submitBtn = page.getByRole('button', { name: /生成進行中|生成/ });
    await expect(submitBtn).toBeDisabled({ timeout: 5_000 });

    // ── T5: 主要 input も disabled ─────────────────────────────
    await expect(themeSelect).toBeDisabled();
    await expect(personaSelect).toBeDisabled();

    // ── T4: job_id の SSE が 404 を返さない (3 秒間観察) ───────
    let progress404Count = 0;
    page.on('response', (r) => {
      if (r.url().includes('/api/articles/zero-generate/') && r.url().endsWith('/progress')) {
        if (r.status() === 404) progress404Count++;
      }
    });
    await page.waitForTimeout(3_000);
    expect(progress404Count).toBe(0);

    // ── 後始末: job 行を Supabase から削除 (テスト後コスト発生防止) ───
    // クライアント側で localStorage クリア → ブラウザを閉じるだけにする
    // (バックエンドの async fetch は 90s 後に終わるが Gemini 実コール課金は発生)
    // ⚠️ コスト発生する。CI 限定 or 月 1 回手動実行を推奨。
  });
});
