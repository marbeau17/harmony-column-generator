/**
 * 再デプロイ / FTPアップロードボタン 実機プローブテスト
 *
 * 目的:
 *   管理画面 (記事詳細ページ) の「FTPアップロード」or「再デプロイ」ボタンを
 *   実際の本番環境でクリックし、発火する fetch / response / console を全部観測する。
 *   現状ボタンが動かないと疑われているため assertion はせず、観察ログだけ出す。
 *
 * 認証:
 *   手動で取得した storageState (auth-state.json 等) が無い場合は test.skip()。
 *   storageState は process.env.PLAYWRIGHT_AUTH_STATE で指定可能。
 *   未指定の場合は以下の候補パスを順に探索:
 *     - ./auth-state.json
 *     - ./test/e2e/.auth/state.json
 *     - ./.auth/state.json
 *     - ./tmp/auth-state.json
 *
 * 実行例:
 *   PLAYWRIGHT_AUTH_STATE=/path/to/auth-state.json \
 *     npx playwright test redeploy-button-probe
 *
 *   # ローカル dev に対して走らせる場合
 *   TEST_BASE_URL=http://localhost:3000 \
 *     PLAYWRIGHT_AUTH_STATE=./auth-state.json \
 *     npx playwright test redeploy-button-probe
 */
import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.TEST_BASE_URL ?? 'https://blogauto-pi.vercel.app';
const TARGET_ARTICLE_ID =
  process.env.PROBE_ARTICLE_ID ?? '01d12905-8c43-49c5-aeae-68c797b07dad';

/**
 * storageState (auth-state.json) を解決する。
 * 見つからない場合は null を返し、テストは skip される。
 */
function resolveAuthStatePath(): string | null {
  const envPath = process.env.PLAYWRIGHT_AUTH_STATE;
  const candidates = [
    envPath,
    path.resolve(process.cwd(), 'auth-state.json'),
    path.resolve(process.cwd(), 'test/e2e/.auth/state.json'),
    path.resolve(process.cwd(), '.auth/state.json'),
    path.resolve(process.cwd(), 'tmp/auth-state.json'),
  ].filter((p): p is string => Boolean(p));

  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        return p;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

const authStatePath = resolveAuthStatePath();

test.describe('再デプロイボタン プローブ (FTPアップロード/再デプロイ)', () => {
  test('詳細ページで再デプロイボタンをクリックして fetch/response/console を観察', async ({
    browser,
  }) => {
    test.skip(
      !authStatePath,
      'storageState (auth-state.json) が見つかりません。' +
        'PLAYWRIGHT_AUTH_STATE 環境変数で path を指定するか、' +
        './auth-state.json を配置してください。',
    );

    // 認証付き context を作成
    const context = await browser.newContext({
      storageState: authStatePath!,
      baseURL: BASE_URL,
    });
    const page = await context.newPage();

    // ───────── ロガー定義 (クリック前から記録開始) ─────────
    type ReqRecord = {
      ts: number;
      method: string;
      url: string;
      resourceType: string;
    };
    type ResRecord = {
      ts: number;
      url: string;
      status: number;
      statusText: string;
      contentType: string | null;
    };
    type ConsoleRecord = {
      ts: number;
      type: string;
      text: string;
      location?: string;
    };

    const requests: ReqRecord[] = [];
    const responses: ResRecord[] = [];
    const consoleMessages: ConsoleRecord[] = [];
    const pageErrors: { ts: number; message: string }[] = [];

    page.on('request', (req) => {
      requests.push({
        ts: Date.now(),
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
      });
    });

    page.on('response', async (res) => {
      try {
        responses.push({
          ts: Date.now(),
          url: res.url(),
          status: res.status(),
          statusText: res.statusText(),
          contentType: res.headers()['content-type'] ?? null,
        });
      } catch {
        // 切断時は無視
      }
    });

    page.on('console', (msg) => {
      let location: string | undefined;
      try {
        const loc = msg.location();
        if (loc?.url) location = `${loc.url}:${loc.lineNumber}`;
      } catch {
        // ignore
      }
      consoleMessages.push({
        ts: Date.now(),
        type: msg.type(),
        text: msg.text(),
        location,
      });
    });

    page.on('pageerror', (err) => {
      pageErrors.push({ ts: Date.now(), message: err.message });
    });

    // ───────── 詳細ページへ遷移 ─────────
    const detailUrl = `${BASE_URL}/dashboard/articles/${TARGET_ARTICLE_ID}`;
    console.log(`[probe] navigate -> ${detailUrl}`);
    const navResp = await page.goto(detailUrl, { waitUntil: 'domcontentloaded' });
    console.log(`[probe] nav status = ${navResp?.status()}`);

    // /login にリダイレクトされた場合は storageState 期限切れ → skip
    if (page.url().includes('/login')) {
      console.log('[probe] redirected to /login — storageState may be expired');
      test.skip(true, 'storageState の有効期限が切れています。再取得してください。');
      await context.close();
      return;
    }

    await page.waitForLoadState('networkidle').catch(() => {
      console.log('[probe] networkidle timeout (non-fatal)');
    });

    // ───────── ボタン探索 ─────────
    // 候補テキスト (複数想定): 「FTPアップロード」「再デプロイ」「デプロイ」「アップロード」
    const buttonCandidates = [
      'FTPアップロード',
      '再デプロイ',
      'FTP アップロード',
      'デプロイ',
      'Re-deploy',
      'Redeploy',
    ];

    let targetButton = null;
    let matchedLabel = '';
    for (const label of buttonCandidates) {
      const btn = page.getByRole('button', { name: label, exact: false }).first();
      if (await btn.count().catch(() => 0)) {
        try {
          const visible = await btn.isVisible({ timeout: 1_000 });
          if (visible) {
            targetButton = btn;
            matchedLabel = label;
            break;
          }
        } catch {
          // 次候補へ
        }
      }
    }

    // role=button で見つからない場合は generic locator もフォールバック
    if (!targetButton) {
      for (const label of buttonCandidates) {
        const btn = page.locator(`button:has-text("${label}")`).first();
        if (await btn.count().catch(() => 0)) {
          try {
            const visible = await btn.isVisible({ timeout: 1_000 });
            if (visible) {
              targetButton = btn;
              matchedLabel = label;
              break;
            }
          } catch {
            // 次候補へ
          }
        }
      }
    }

    if (!targetButton) {
      console.log(
        `[probe] !!! 再デプロイ/FTPアップロードボタンが見つかりませんでした (候補: ${buttonCandidates.join(
          ', ',
        )})`,
      );
      // ページ上の主要ボタン一覧をダンプして手がかりに
      const allButtons = await page
        .locator('button')
        .allTextContents()
        .catch(() => [] as string[]);
      console.log(`[probe] page buttons (${allButtons.length}): ${JSON.stringify(allButtons)}`);
      await context.close();
      return;
    }

    console.log(`[probe] matched button: "${matchedLabel}"`);

    // ───────── クリック前のスナップショット位置を記録 ─────────
    const reqCountBefore = requests.length;
    const resCountBefore = responses.length;
    const consoleCountBefore = consoleMessages.length;

    // ───────── クリック ─────────
    console.log('[probe] click button...');
    await targetButton.click({ trial: false }).catch((e) => {
      console.log(`[probe] click error: ${(e as Error).message}`);
    });

    // ───────── 5秒待機 ─────────
    await page.waitForTimeout(5_000);

    // ───────── 観察ログ出力 ─────────
    const newRequests = requests.slice(reqCountBefore);
    const newResponses = responses.slice(resCountBefore);
    const newConsole = consoleMessages.slice(consoleCountBefore);

    // クリックに関係しそうな fetch / xhr / api を抽出
    const apiRequests = newRequests.filter(
      (r) =>
        r.resourceType === 'fetch' ||
        r.resourceType === 'xhr' ||
        r.url.includes('/api/'),
    );

    const apiResponseUrls = new Set(apiRequests.map((r) => r.url));
    const apiResponses = newResponses.filter((r) => apiResponseUrls.has(r.url));

    console.log('═══════════════════════════════════════════════════════════');
    console.log(`[probe] === RESULT for article ${TARGET_ARTICLE_ID} ===`);
    console.log(`[probe] BASE_URL              : ${BASE_URL}`);
    console.log(`[probe] matched button        : "${matchedLabel}"`);
    console.log(`[probe] new requests total    : ${newRequests.length}`);
    console.log(`[probe] new api/fetch/xhr     : ${apiRequests.length}`);
    console.log(`[probe] new responses total   : ${newResponses.length}`);
    console.log(`[probe] new console messages  : ${newConsole.length}`);
    console.log(`[probe] new page errors       : ${pageErrors.length}`);
    console.log('───────── API/Fetch URL list ─────────');
    for (const r of apiRequests) {
      console.log(`  ${r.method.padEnd(5)} ${r.url}`);
    }
    console.log('───────── API Response status ─────────');
    for (const r of apiResponses) {
      console.log(`  ${String(r.status).padEnd(4)} ${r.statusText.padEnd(12)} ${r.url}`);
    }
    console.log('───────── Console messages ─────────');
    for (const c of newConsole) {
      const loc = c.location ? ` @ ${c.location}` : '';
      console.log(`  [${c.type}] ${c.text}${loc}`);
    }
    if (pageErrors.length > 0) {
      console.log('───────── Page errors ─────────');
      for (const e of pageErrors) {
        console.log(`  ${e.message}`);
      }
    }
    console.log('═══════════════════════════════════════════════════════════');

    await context.close();
  });
});
