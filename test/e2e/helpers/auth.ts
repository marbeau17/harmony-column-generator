import { Page } from '@playwright/test';

/**
 * Login to the dashboard via Supabase Auth UI.
 * Uses the test user email/password from environment variables.
 */
export async function login(page: Page) {
  const email = process.env.TEST_USER_EMAIL || 'marbeau17@gmail.com';
  const password = process.env.TEST_USER_PASSWORD || '';

  if (!password) {
    throw new Error(
      'TEST_USER_PASSWORD environment variable is required for E2E tests. ' +
      'Set it in .env.local or pass it when running tests: TEST_USER_PASSWORD=xxx npx playwright test'
    );
  }

  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);

  // Fill login form
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.locator('button[type="submit"]').click();

  // Wait for redirect to dashboard
  await page.waitForURL('**/dashboard**', { timeout: 30_000 });
}

/**
 * Ensure we're on the dashboard (login if needed).
 */
export async function ensureLoggedIn(page: Page) {
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle');

  // Check if redirected to login
  if (page.url().includes('/login')) {
    await login(page);
  }
}
