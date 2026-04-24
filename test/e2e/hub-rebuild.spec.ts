import { test, expect, type Page } from '@playwright/test';
import {
  cleanupMonkeyArticles,
  countNonMonkeyArticles,
  createReviewedMonkeyArticles,
  hubIndexContainsSlug,
  loadMonkeyEnv,
  makeAdminClient,
  readDryRunHubIndex,
  unreviewArticle,
  type ReviewedMonkeyArticle,
  PROD_SUBSTRINGS,
} from './helpers/monkey-fixtures';
import { ensureLoggedIn } from './helpers/auth';

// Hub rebuild guarantee E2E suite.
// Spec: docs/specs/hub-rebuild-guarantee.md §6.3
//
// Run: `FTP_DRY_RUN=true MONKEY_TEST=true PUBLISH_CONTROL_V2=on \
//       MONKEY_SUPABASE_URL=... MONKEY_SUPABASE_SERVICE_ROLE=... \
//       MONKEY_BASE_URL=http://localhost:3000 \
//       TEST_USER_PASSWORD=... \
//       npx playwright test hub-rebuild`
//
// Note: these tests exercise the LEGACY checkbox UI, so the dev server should
// be running WITHOUT `NEXT_PUBLIC_PUBLISH_CONTROL_V2=on` (client-side flag).
// The server-side `PUBLISH_CONTROL_V2=on` is still required for monkey env.

const env = loadMonkeyEnv();
const sb = makeAdminClient(env);
let preCount = 0;

test.beforeAll(async () => {
  preCount = await countNonMonkeyArticles(sb);
});

test.afterAll(async () => {
  await cleanupMonkeyArticles(sb);
  const postCount = await countNonMonkeyArticles(sb);
  if (postCount !== preCount) {
    throw new Error(
      `non-monkey article row count drifted: pre=${preCount} post=${postCount}. Existing articles MUST NOT be touched.`,
    );
  }
});

test.beforeEach(async ({ page }) => {
  // Layer 5: route blocklist — never let a test reach prod.
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.includes('harmony-mc.com')) return route.abort('blockedbyclient');
    if (PROD_SUBSTRINGS.some((p) => url.includes(p))) return route.abort('blockedbyclient');
    return route.continue();
  });
  await ensureLoggedIn(page);
});

async function gotoArticles(page: Page) {
  await page.goto('/dashboard/articles');
  await page.waitForLoadState('networkidle');
}

async function triggerInitialHubDeploy(page: Page): Promise<void> {
  // Hit the API directly to seed a baseline dry-run hub index.
  const res = await page.request.post(`${env.baseUrl}/api/hub/deploy`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
}

async function findReviewCheckboxForSlug(page: Page, slug: string) {
  // Slug appears in the keyword sub-line rendered beneath the title.
  // Locate that cell, then walk up to the row and grab the 確認 checkbox.
  const row = page.locator('tr', { hasText: slug });
  return row.locator('input[type="checkbox"]');
}

test.describe('Hub rebuild guarantee (spec §6.3)', () => {
  test('§6.3.1 uncheck reviewed article removes it from hub', async ({ page }) => {
    const articles: ReviewedMonkeyArticle[] = await createReviewedMonkeyArticles(2);
    const [target, keeper] = articles;

    await triggerInitialHubDeploy(page);

    // Baseline: both slugs must be in dry-run hub.
    const baseline = await readDryRunHubIndex();
    expect(hubIndexContainsSlug(baseline, target.slug)).toBe(true);
    expect(hubIndexContainsSlug(baseline, keeper.slug)).toBe(true);

    await gotoArticles(page);

    // Confirm the uncheck dialog.
    page.once('dialog', (d) => d.accept());

    const checkbox = await findReviewCheckboxForSlug(page, target.slug);
    await expect(checkbox).toBeVisible({ timeout: 15_000 });
    await expect(checkbox).toBeChecked();
    await checkbox.click();

    const banner = page.locator('text=/ハブ再生成: OK/');
    await expect(banner).toBeVisible({ timeout: 30_000 });

    const after = await readDryRunHubIndex();
    expect(hubIndexContainsSlug(after, target.slug)).toBe(false);
    expect(hubIndexContainsSlug(after, keeper.slug)).toBe(true);
  });

  test('§6.3.2 bulk deploy with zero reviewed still rebuilds hub', async ({ page }) => {
    const articles = await createReviewedMonkeyArticles(2);
    for (const a of articles) {
      await unreviewArticle(a.id);
    }

    await gotoArticles(page);

    // Accept the "確認済みの記事をサーバーにデプロイしますか？" confirm.
    page.once('dialog', (d) => d.accept());

    await page.getByRole('button', { name: /サーバーに更新/ }).click();

    const banner = page.locator('text=/0 件デプロイ成功[\\s\\S]*ハブ再生成: OK/');
    await expect(banner).toBeVisible({ timeout: 30_000 });

    const hub = await readDryRunHubIndex();
    for (const a of articles) {
      expect(hubIndexContainsSlug(hub, a.slug)).toBe(false);
    }
  });

  test('§6.3.3 hub rebuild failure surfaces in banner', async ({ page }) => {
    const [target] = await createReviewedMonkeyArticles(1);

    await gotoArticles(page);

    // Intercept only the hub rebuild call and force a structured failure.
    await page.route('**/api/hub/deploy', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'simulated',
          stage: 'ftp',
          detail: 'mock failure',
          durationMs: 0,
        }),
      });
    });

    // Accept the uncheck confirm (wasReviewed=true triggers confirm dialog).
    page.once('dialog', (d) => d.accept());

    const checkbox = await findReviewCheckboxForSlug(page, target.slug);
    await expect(checkbox).toBeVisible({ timeout: 15_000 });
    await checkbox.click();

    const banner = page.locator('text=/ハブ再生成: FAIL \\[ftp\\][\\s\\S]*mock failure/');
    await expect(banner).toBeVisible({ timeout: 30_000 });
  });
});
