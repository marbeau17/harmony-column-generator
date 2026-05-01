/**
 * E2E: 生成モード（generation_mode）UI フラグ検証 (K14)
 * --------------------------------------------------------
 * 検証対象:
 *   - dashboard 一覧ページ (/dashboard/articles) の各行に
 *     <GenerationModeBadge data-testid="generation-mode-badge" /> が存在し、
 *     data-mode 属性が 'zero' または 'source' のいずれかに必ずなること。
 *     'unknown' は P5-10 以降は許容しない（マイグレ済み）。
 *   - モードフィルタ Dropdown（aria-label="生成モードで絞り込み"）で
 *     『ゼロ生成』を選ぶと、表示される全 badge が data-mode="zero" になること。
 *
 * 環境:
 *   - 実 dev サーバ + DB が必要なので CI では skip（必須 env が無いとき）。
 *   - 本 spec は spec ファイル作成のみで、実機実行は別タスクで行う。
 *
 * 既存の zero-generation-form.spec.ts / batch-hide-source.spec.ts と同じ
 * 防御プロトコルを踏襲（prod 遮断 / 環境変数チェック / shadow DB 前提）。
 */

import { test, expect, type Page } from '@playwright/test';

import { ensureLoggedIn } from './helpers/auth';
import { PROD_SUBSTRINGS } from './helpers/zero-generation-fixtures';

// ─── 環境変数チェック（不足時は suite ごと skip）──────────────────────────────

const REQUIRED_ENV = ['TEST_USER_PASSWORD'] as const;
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);

test.skip(
  missingEnv.length > 0,
  `generation-mode-flag E2E: missing env vars: ${missingEnv.join(', ')}`,
);

// 本番 baseURL を踏んだら絶対に走らせない
function isTargetingProd(): boolean {
  const baseUrl =
    process.env.MONKEY_BASE_URL || process.env.TEST_BASE_URL || '';
  if (baseUrl.includes('blogauto-pi.vercel.app')) return true;
  if (
    process.env.MONKEY_SUPABASE_URL &&
    PROD_SUBSTRINGS.some((p) => process.env.MONKEY_SUPABASE_URL!.includes(p))
  ) {
    return true;
  }
  return false;
}

test.skip(isTargetingProd(), 'baseURL/Supabase looks like prod; refuse to run');

// ─── prod 遮断ガード ────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.includes('harmony-mc.com')) return route.abort('blockedbyclient');
    if (PROD_SUBSTRINGS.some((p) => url.includes(p))) {
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
});

// ─── ヘルパ ────────────────────────────────────────────────────────────────

async function gotoArticles(page: Page): Promise<void> {
  await page.goto('/dashboard/articles');
  await page.waitForLoadState('networkidle');
}

// ─── テスト本体 ─────────────────────────────────────────────────────────────

test.describe('Generation mode badge & filter (K14)', () => {
  test('一覧の各 badge は data-mode="zero" または "source" を持つ', async ({
    page,
  }) => {
    await ensureLoggedIn(page);
    await gotoArticles(page);

    const badges = page.locator('[data-testid="generation-mode-badge"]');

    // 少なくとも 1 件は描画されているはず（DB が空のときは skip）
    const count = await badges.count();
    test.skip(count === 0, '一覧に記事が 1 件も無い（DB 空）。badge 検証を skip');

    // 全 badge が zero / source のいずれか。'unknown' は許容しない。
    for (let i = 0; i < count; i++) {
      const mode = await badges.nth(i).getAttribute('data-mode');
      expect(
        mode,
        `badge[${i}] の data-mode は 'zero' または 'source' のはず（unknown 不可）`,
      ).not.toBeNull();
      expect(['zero', 'source']).toContain(mode);
    }
  });

  test('モードフィルタで「ゼロ生成」を選ぶと、表示 badge は全て zero になる', async ({
    page,
  }) => {
    await ensureLoggedIn(page);
    await gotoArticles(page);

    // 初期描画を待つ
    const initialBadges = page.locator('[data-testid="generation-mode-badge"]');
    const initialCount = await initialBadges.count();
    test.skip(
      initialCount === 0,
      '一覧に記事が 1 件も無い。フィルタ検証を skip',
    );

    // Dropdown を選択
    const modeSelect = page.getByLabel('生成モードで絞り込み');
    await expect(modeSelect).toBeVisible({ timeout: 10_000 });
    await modeSelect.selectOption('zero');

    // 再描画後の badge 取得（網羅的に取得する）
    // ※ ゼロ生成記事が DB に 1 件も無い shadow 環境では空表示になりうるので、
    //   その場合は skip して False Negative を避ける。
    await page.waitForTimeout(500); // フィルタ反映待ち
    const filteredBadges = page.locator('[data-testid="generation-mode-badge"]');
    const filteredCount = await filteredBadges.count();
    test.skip(
      filteredCount === 0,
      'ゼロ生成記事が 0 件のため、絞り込み後の badge 検証を skip',
    );

    for (let i = 0; i < filteredCount; i++) {
      const mode = await filteredBadges.nth(i).getAttribute('data-mode');
      expect(
        mode,
        `絞り込み後 badge[${i}] は data-mode="zero" のはず`,
      ).toBe('zero');
    }
  });
});
