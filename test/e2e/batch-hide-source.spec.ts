/**
 * E2E: BatchHideButton（既存ソース記事の一括非表示）動作検証
 *
 * 検証対象:
 *   - UI: src/components/articles/BatchHideButton.tsx
 *   - API: POST /api/articles/batch-hide-source
 *   - 純ロジック: src/lib/articles/batch-hide.ts
 *
 * シナリオ (BH-1):
 *   1. shadow 環境で is_hub_visible=true の zg_ 記事を 3 件 seed
 *   2. ログイン → /dashboard/articles
 *   3. ツールバーの「既存ソースを一括非表示」ボタンをクリック
 *   4. モーダル表示確認
 *   5. HIDE_ALL_SOURCE と入力
 *   6. 「dry-run で確認」クリック → candidates: 3 を確認
 *   7. 「実行」クリック → hidden: 3 を確認
 *   8. DB 直接クエリで該当 3 件が is_hub_visible=false になっていることを確認
 *   9. publish_events に action='unpublish' reason='batch-hide-source' が 3 件あることを確認
 *
 * 防御層:
 *   - shadow Supabase project ガード（zero-generation-fixtures と同等）
 *   - zg_ プレフィックス強制で本番データから完全分離
 *   - 既存（非 zg_）記事カウントを pre/post で不変アサート
 *   - Playwright route blocklist（harmony-mc.com / 本番 Supabase へ到達禁止）
 *
 * 必要な環境変数（不足時は skip）:
 *   - MONKEY_SUPABASE_URL
 *   - MONKEY_SUPABASE_SERVICE_ROLE
 *   - MONKEY_BASE_URL
 *   - TEST_USER_PASSWORD
 *   - FTP_DRY_RUN=true
 *   - MONKEY_TEST=true
 *   - PUBLISH_CONTROL_V2=on   (server-side feature flag — API 404 回避)
 *
 * 起動例:
 *   FTP_DRY_RUN=true MONKEY_TEST=true PUBLISH_CONTROL_V2=on \
 *   MONKEY_SUPABASE_URL=... MONKEY_SUPABASE_SERVICE_ROLE=... \
 *   MONKEY_BASE_URL=http://localhost:3000 \
 *   TEST_USER_PASSWORD=... \
 *   npx playwright test batch-hide-source
 */

import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';

import { login } from './helpers/auth';
import {
  ZG_PREFIX,
  cleanupZeroFixtures,
  countNonZeroArticles,
  loadZeroGenEnv,
  makeZeroGenAdminClient,
  PROD_SUBSTRINGS,
} from './helpers/zero-generation-fixtures';

// ─── 環境変数チェック（不足時は suite ごと skip）──────────────────────────────

const REQUIRED_ENV = [
  'MONKEY_SUPABASE_URL',
  'MONKEY_SUPABASE_SERVICE_ROLE',
  'MONKEY_BASE_URL',
  'TEST_USER_PASSWORD',
  'FTP_DRY_RUN',
  'MONKEY_TEST',
  'PUBLISH_CONTROL_V2',
] as const;

const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);

test.skip(
  missingEnv.length > 0,
  `batch-hide-source E2E: missing env vars: ${missingEnv.join(', ')}`,
);

// ─── seed/teardown ヘルパ（zg_ プレフィックス強制）──────────────────────────

interface SeededArticle {
  id: string;
  slug: string;
  title: string;
}

/**
 * zg_ プレフィックスかつ is_hub_visible=true の articles を `count` 件作成する。
 * batch-hide-source の対象抽出条件 (is_hub_visible=true AND
 * generation_mode='source' OR NULL) に合致するよう、generation_mode は明示的に
 * 'source' を入れる（テーブル DEFAULT も 'source' なのでフェイルセーフ）。
 */
async function seedHidableZeroArticles(
  sb: SupabaseClient,
  count: number,
): Promise<SeededArticle[]> {
  const out: SeededArticle[] = [];
  const stamp = Date.now();
  for (let i = 0; i < count; i++) {
    const slug = `${ZG_PREFIX}batch-hide-${stamp}-${i}`;
    const title = `${ZG_PREFIX}batch-hide-target-${i}`;
    const { data, error } = await sb
      .from('articles')
      .insert({
        title,
        slug,
        status: 'published',
        stage3_final_html: `<html><body>zg batch-hide ${i}</body></html>`,
        published_at: new Date().toISOString(),
        reviewed_at: new Date().toISOString(),
        is_hub_visible: true,
        visibility_state: 'live',
        generation_mode: 'source',
      })
      .select('id, slug, title')
      .single();
    if (error) throw new Error(`seedHidableZeroArticles[${i}] failed: ${error.message}`);
    out.push({
      id: data.id as string,
      slug: data.slug as string,
      title: data.title as string,
    });
  }
  return out;
}

// ─── suite 共通セットアップ ────────────────────────────────────────────────
// 注: loadZeroGenEnv() は環境変数が無いと throw するため、test.skip ガードを
// 効かせるべく、env / supabase クライアントは「最初に必要になった時に」遅延
// 初期化する。これにより `npx playwright test --list` 等でも env 不在時に
// suite ごと skip 表示で collect できる。

let env: ReturnType<typeof loadZeroGenEnv> | null = null;
let sb: SupabaseClient | null = null;
let preNonZeroCount = 0;

function getSb(): SupabaseClient {
  if (!env) env = loadZeroGenEnv();
  if (!sb) sb = makeZeroGenAdminClient(env);
  return sb;
}

test.beforeAll(async () => {
  if (missingEnv.length > 0) return; // skip 経路では何もしない
  // 念のため過去の zg_ ゴミを掃除しておく（前回 suite 異常終了時の保険）
  await cleanupZeroFixtures();
  preNonZeroCount = await countNonZeroArticles(getSb());
});

test.afterAll(async () => {
  if (missingEnv.length > 0) return;
  await cleanupZeroFixtures();
  const postNonZeroCount = await countNonZeroArticles(getSb());
  if (postNonZeroCount !== preNonZeroCount) {
    throw new Error(
      `non-zg article row count drifted: pre=${preNonZeroCount} post=${postNonZeroCount}. ` +
        '既存本番データへの副作用が疑われる。',
    );
  }
});

test.beforeEach(async ({ page }) => {
  // route blocklist: prod へ絶対に到達させない
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.includes('harmony-mc.com')) return route.abort('blockedbyclient');
    if (PROD_SUBSTRINGS.some((p) => url.includes(p))) return route.abort('blockedbyclient');
    return route.continue();
  });
});

// ─── テスト本体 ───────────────────────────────────────────────────────────

test.describe('BatchHideButton (BH-1)', () => {
  test('zg_ 記事 3 件を一括非表示にし、DB と publish_events に正しく反映される', async ({
    page,
  }) => {
    const dbClient = getSb();

    // --- 1. seed: is_hub_visible=true の zg_ 記事を 3 件作成 -----------------
    const seeded = await seedHidableZeroArticles(dbClient, 3);
    expect(seeded).toHaveLength(3);

    const seededIds = new Set(seeded.map((s) => s.id));

    // --- 2. ログイン → 一覧画面 --------------------------------------------
    await login(page);
    await page.goto('/dashboard/articles');
    await page.waitForLoadState('networkidle');

    // --- 3. ツールバーのボタンをクリック → モーダル表示 --------------------
    const trigger = page.getByRole('button', { name: /既存ソースを一括非表示/ });
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: /既存記事を一括非表示にしますか/ });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // --- 4. 確認文字列入力 -------------------------------------------------
    await dialog.getByPlaceholder('HIDE_ALL_SOURCE').fill('HIDE_ALL_SOURCE');

    // --- 5. dry-run で確認 → API レスポンスから candidates を取得 -----------
    const dryRunResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/articles/batch-hide-source') &&
        res.request().method() === 'POST',
      { timeout: 30_000 },
    );

    await dialog.getByRole('button', { name: /dry-run で確認/ }).click();
    const dryRunResp = await dryRunResponsePromise;
    expect([200, 207]).toContain(dryRunResp.status());

    const dryRunBody = (await dryRunResp.json()) as {
      dry_run: boolean;
      candidates: number;
      hidden: number;
      ids: string[];
      hub_rebuild_status: string;
    };
    expect(dryRunBody.dry_run).toBe(true);
    // 既存の非 zg_ 公開記事も candidates に含まれうるが、最低でも seed 分（3）は超える
    expect(dryRunBody.candidates).toBeGreaterThanOrEqual(3);
    // dry-run 時点では DB は変わらない（hidden=0）
    expect(dryRunBody.hidden).toBe(0);
    // seed した 3 件の id は必ず含まれる
    for (const s of seeded) {
      expect(dryRunBody.ids).toContain(s.id);
    }

    // モーダルの dry-run 結果バナーが表示されること（UX 検証）
    await expect(
      dialog.getByText('[dry-run] 対象件数を確認しました'),
    ).toBeVisible({ timeout: 10_000 });

    // --- 6. 実行 → API レスポンスから hidden を確認 -----------------------
    const realResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/articles/batch-hide-source') &&
        res.request().method() === 'POST',
      { timeout: 60_000 },
    );

    await dialog.getByRole('button', { name: /^実行$/ }).click();
    const realResp = await realResponsePromise;
    expect([200, 207]).toContain(realResp.status());

    const realBody = (await realResp.json()) as {
      dry_run: boolean;
      candidates: number;
      hidden: number;
      ids: string[];
      succeeded_ids: string[];
      hub_rebuild_status: string;
    };
    expect(realBody.dry_run).toBe(false);
    // seed した 3 件は必ず非表示化に成功している
    for (const s of seeded) {
      expect(realBody.succeeded_ids).toContain(s.id);
    }
    expect(realBody.hidden).toBeGreaterThanOrEqual(3);

    // 実行結果バナー
    await expect(
      dialog.getByText('一括非表示を実行しました'),
    ).toBeVisible({ timeout: 10_000 });

    // --- 7. DB 直接クエリで is_hub_visible=false になっていることを確認 ----
    const { data: afterRows, error: afterErr } = await dbClient
      .from('articles')
      .select('id, is_hub_visible, visibility_state')
      .in('id', Array.from(seededIds));
    if (afterErr) throw afterErr;

    expect(afterRows).toHaveLength(3);
    for (const row of afterRows ?? []) {
      expect(row.is_hub_visible).toBe(false);
      expect(row.visibility_state).toBe('unpublished');
    }

    // --- 8. publish_events に action='unpublish' reason='batch-hide-source' が 3 件 ---
    const { data: events, error: evErr } = await dbClient
      .from('publish_events')
      .select('article_id, action, reason')
      .in('article_id', Array.from(seededIds))
      .eq('action', 'unpublish')
      .eq('reason', 'batch-hide-source');
    if (evErr) throw evErr;

    expect(events).toHaveLength(3);
    const eventArticleIds = new Set((events ?? []).map((e) => e.article_id as string));
    for (const s of seeded) {
      expect(eventArticleIds.has(s.id)).toBe(true);
    }
  });
});
