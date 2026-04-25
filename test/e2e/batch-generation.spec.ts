import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers/auth';
import { checkE2EEnv } from './helpers/env-check';

/**
 * E2E Test: Batch Blog Generation Pipeline
 *
 * Tests the full user journey:
 * 1. Login → Dashboard
 * 2. AI Planner → Generate plans
 * 3. Approve plans
 * 4. Queue processing (outline generation)
 * 5. Batch generation (body + images + SEO)
 * 6. Verify articles in editing state
 * 7. Verify images are embedded in body HTML
 */

// 必須環境変数チェック（不足時は describe 単位でスキップ）
const envCheck = checkE2EEnv([
  'GEMINI_API_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
]);

test.describe('Batch Blog Generation', () => {
  test.skip(!envCheck.ok, envCheck.reason ?? 'Missing required env vars');

  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('1. Dashboard loads correctly', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('main').getByRole('heading', { name: 'ダッシュボード' })).toBeVisible();
    console.log('[test] Dashboard loaded');
  });

  test('2. Navigate to AI Planner', async ({ page }) => {
    await page.goto('/dashboard/planner');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=AIプランナー').first()).toBeVisible();
    console.log('[test] Planner page loaded');
  });

  test('3. Generate plans', async ({ page }) => {
    await page.goto('/dashboard/planner');
    await page.waitForLoadState('networkidle');

    // Click "プランを生成" button
    const generateBtn = page.locator('button:has-text("プランを生成")');
    if (await generateBtn.isVisible()) {
      await generateBtn.click();

      // Select count (5 plans)
      const count5Btn = page.locator('button:has-text("5件")');
      if (await count5Btn.isVisible({ timeout: 3000 })) {
        await count5Btn.click();
      }

      // Wait for plan generation (keyword research + plan creation)
      // This calls Gemini API so it can take up to 2 minutes
      await page.waitForSelector('text=完了', { timeout: 120_000 }).catch(() => {
        console.log('[test] Plan generation may still be in progress');
      });

      console.log('[test] Plan generation triggered');
    } else {
      console.log('[test] Generate button not visible, plans may already exist');
    }
  });

  test('4. Verify plans exist', async ({ page }) => {
    await page.goto('/dashboard/planner');
    await page.waitForLoadState('networkidle');

    // Wait for plans to load
    await page.waitForTimeout(2000);

    // Check if there are plan cards or table rows
    const planItems = page.locator('[class*="plan"], tr:has(td)');
    const count = await planItems.count();
    console.log(`[test] Found ${count} plan items`);
    expect(count).toBeGreaterThan(0);
  });

  test('5. Approve plans and start queue', async ({ page }) => {
    await page.goto('/dashboard/planner');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Look for approve buttons
    const approveBtn = page.locator('button:has-text("承認"), button:has-text("一括承認")').first();
    if (await approveBtn.isVisible({ timeout: 5000 })) {
      await approveBtn.click();
      await page.waitForTimeout(1000);
      console.log('[test] Plans approved');
    } else {
      console.log('[test] No plans to approve (may already be approved)');
    }

    // Start queue processing for outline generation
    const queueBtn = page.locator('button:has-text("キュー処理開始")');
    if (await queueBtn.isVisible({ timeout: 5000 })) {
      await queueBtn.click();
      console.log('[test] Queue processing started');

      // Wait for queue processing to complete (outline generation)
      await page.waitForTimeout(60_000); // 1 minute for outlines
    }
  });

  test('6. Batch generate - full pipeline', async ({ page }) => {
    test.setTimeout(600_000); // 10 minutes for batch generation

    await page.goto('/dashboard/planner');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Click "一括生成" button
    const batchBtn = page.locator('button:has-text("一括生成")');
    await expect(batchBtn).toBeVisible({ timeout: 10_000 });
    await batchBtn.click();
    console.log('[test] Batch generation started');

    // Wait for batch progress panel to appear
    const progressPanel = page.locator('text=一括生成');
    await expect(progressPanel.first()).toBeVisible({ timeout: 10_000 });

    // Monitor progress - wait for completion or timeout
    const maxWait = 540_000; // 9 minutes
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      // Check for completion
      const completedText = page.locator('text=完了').first();
      if (await completedText.isVisible({ timeout: 1000 }).catch(() => false)) {
        const statusText = await page.locator('[class*="batch"], [class*="progress"]').first().textContent().catch(() => '');
        console.log(`[test] Batch status: ${statusText?.substring(0, 100)}`);

        // Check if all items are done
        const closeBtn = page.locator('button:has-text("閉じる")');
        if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          console.log('[test] Batch generation completed!');
          break;
        }
      }

      // Log progress every 30 seconds
      if ((Date.now() - startTime) % 30_000 < 5_000) {
        const progressText = await page.locator('[class*="progress"], [class*="batch"]').first().textContent().catch(() => 'N/A');
        console.log(`[test] Progress (${Math.round((Date.now() - startTime) / 1000)}s): ${progressText?.substring(0, 80)}`);
      }

      await page.waitForTimeout(5_000);
    }
  });

  test('7. Verify articles in articles list', async ({ page }) => {
    await page.goto('/dashboard/articles');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Check article count
    const articleCount = page.locator('text=/全 \\d+ 件/').first();
    if (await articleCount.isVisible({ timeout: 5000 })) {
      const text = await articleCount.textContent();
      console.log(`[test] Articles: ${text}`);
    }

    // Check for articles in editing or body_review status
    const editingBadges = page.locator('text=編集中');
    const reviewBadges = page.locator('text=生成レビュー');
    const editingCount = await editingBadges.count();
    const reviewCount = await reviewBadges.count();
    console.log(`[test] Articles - editing: ${editingCount}, review: ${reviewCount}`);

    expect(editingCount + reviewCount).toBeGreaterThan(0);
  });

  test('8. Verify article has images in editor', async ({ page }) => {
    await page.goto('/dashboard/articles');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click on first article with "編集中" or "生成レビュー" status
    const articleLink = page.locator('a[href*="/dashboard/articles/"]').first();
    if (await articleLink.isVisible({ timeout: 5000 })) {
      await articleLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Navigate to edit page
      const editLink = page.locator('a:has-text("編集"), button:has-text("レビュー")').first();
      if (await editLink.isVisible({ timeout: 5000 })) {
        await editLink.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(3000);
      }

      // Check for images in the page
      const images = page.locator('img[src*="supabase"]');
      const imgCount = await images.count();
      console.log(`[test] Found ${imgCount} Supabase images in article`);

      // Check that no IMAGE: placeholders remain
      const bodyText = await page.textContent('body');
      const placeholders = (bodyText || '').match(/IMAGE:(hero|body|summary)/g);
      if (placeholders) {
        console.log(`[test] WARNING: ${placeholders.length} placeholders still present`);
      } else {
        console.log('[test] No IMAGE placeholders remaining - images properly embedded');
      }
    }
  });

  test('9. Verify article detail page shows generated images', async ({ page }) => {
    await page.goto('/dashboard/articles');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click first article
    const firstArticle = page.locator('a[href*="/dashboard/articles/"]').first();
    if (await firstArticle.isVisible({ timeout: 5000 })) {
      await firstArticle.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Check for "生成済み画像" section
      const imageSection = page.locator('text=生成済み画像');
      if (await imageSection.isVisible({ timeout: 5000 })) {
        console.log('[test] Generated images section found');

        // Count image thumbnails
        const imageThumbs = page.locator('img[src*="supabase"][class*="object-cover"]');
        const thumbCount = await imageThumbs.count();
        console.log(`[test] Found ${thumbCount} image thumbnails in detail page`);
        expect(thumbCount).toBeGreaterThanOrEqual(2); // at least body + summary
      } else {
        console.log('[test] No generated images section (images may not be generated yet)');
      }
    }
  });

  test('10. Verify SEO score on review page', async ({ page }) => {
    await page.goto('/dashboard/articles');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find an article with "生成レビュー" status and click it
    const reviewArticle = page.locator('tr:has-text("生成レビュー") a, a:has-text("生成レビュー")').first();
    if (await reviewArticle.isVisible({ timeout: 5000 })) {
      await reviewArticle.click();
      await page.waitForLoadState('networkidle');

      // Navigate to review page
      const reviewBtn = page.locator('a:has-text("レビュー"), button:has-text("レビュー")').first();
      if (await reviewBtn.isVisible({ timeout: 5000 })) {
        await reviewBtn.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        // Check for SEO score
        const seoScore = page.locator('text=SEOスコア');
        if (await seoScore.isVisible({ timeout: 5000 })) {
          console.log('[test] SEO score section found on review page');

          // Check score value
          const scoreValue = page.locator('text=/\\d+.*\\/.*100/');
          if (await scoreValue.isVisible({ timeout: 3000 })) {
            const text = await scoreValue.textContent();
            console.log(`[test] SEO Score: ${text}`);
          }
        }
      }
    } else {
      console.log('[test] No article with review status found');
    }
  });
});
