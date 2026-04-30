/**
 * Zero-Generation E2E suite (spec §13.2 / ZG-1〜ZG-5)
 *
 * 現状: F1-F9 (production code) が未完のため、ZG-1〜ZG-5 はすべて test.skip で
 * 骨組み (アサーション + fixture 配線) のみを定義する。
 * `/api/articles/zero-generate` が実装され次第、各テストの `test.skip` を
 * `test` に切り替えるだけで起動可能な状態にしておく。
 *
 * 既存 monkey-publish-control / hub-rebuild へのデグレを起こさないために:
 *   - prod-DB ガード (PROD_SUBSTRINGS) を共有
 *   - FTP_DRY_RUN=true / MONKEY_TEST=true 必須
 *   - すべての fixture は `zg_` プレフィックスで名前空間分離
 *   - 後始末は cleanupZeroFixtures() で zg_* のみを削除
 *
 * 実行例 (実装後):
 *   FTP_DRY_RUN=true MONKEY_TEST=true PUBLISH_CONTROL_V2=on \
 *   MONKEY_SUPABASE_URL=... MONKEY_SUPABASE_SERVICE_ROLE=... \
 *   MONKEY_BASE_URL=http://localhost:3000 \
 *   TEST_USER_PASSWORD=... \
 *   npx playwright test zero-generation
 *
 * ストレス系 (ZG-5) のみ:
 *   npx playwright test zero-generation --grep @zg-stress
 */
import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers/auth';
import {
  cleanupZeroFixtures,
  countNonZeroArticles,
  createZeroPersona,
  createZeroTheme,
  loadZeroGenEnv,
  makeZeroGenAdminClient,
  PROD_SUBSTRINGS,
  ZG_PREFIX,
} from './helpers/zero-generation-fixtures';

// =============================================================================
// 環境ロード — describe の外で評価。env が無いと即時 throw する設計だが、
// CI で list 表示だけしたい場合に備え try/catch でログのみに留める。
// =============================================================================

let envOk = false;
try {
  loadZeroGenEnv();
  envOk = true;
} catch (e) {
  // list 時 (--list) 等で env 未セットでも collect だけは通す。
  // 各 test 内の beforeAll でもう一度ガードする。
  // eslint-disable-next-line no-console
  console.warn(`[zero-generation.spec] env not ready, tests will skip at runtime: ${(e as Error).message}`);
}

// =============================================================================
// ZG-1〜ZG-4: 通常フロー
// =============================================================================

test.describe('Zero-Generation E2E (spec §13.2)', () => {
  let preCount = 0;

  test.beforeAll(async () => {
    if (!envOk) test.skip(true, 'zero-generation env not configured');
    const env = loadZeroGenEnv();
    const sb = makeZeroGenAdminClient(env);
    preCount = await countNonZeroArticles(sb);
  });

  test.afterAll(async () => {
    if (!envOk) return;
    await cleanupZeroFixtures();
    const env = loadZeroGenEnv();
    const sb = makeZeroGenAdminClient(env);
    const postCount = await countNonZeroArticles(sb);
    if (postCount !== preCount) {
      throw new Error(
        `non-zg article row count drifted: pre=${preCount} post=${postCount}. Existing articles MUST NOT be touched.`,
      );
    }
  });

  test.beforeEach(async ({ page }) => {
    // 本番への漏洩防止。monkey-publish-control と同じ blocklist。
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.includes('harmony-mc.com')) return route.abort('blockedbyclient');
      if (PROD_SUBSTRINGS.some((p) => url.includes(p))) return route.abort('blockedbyclient');
      return route.continue();
    });
    await ensureLoggedIn(page);
  });

  // ---------------------------------------------------------------------------
  // ZG-1: テーマ + ペルソナ選択 → 生成 → preview に hero/body/summary + CTA×3
  // ---------------------------------------------------------------------------
  test.skip('ZG-1: theme+persona → generate → preview shows hero/body/summary + 3 CTAs', async ({ page }) => {
    const theme = await createZeroTheme(`${ZG_PREFIX}theme_zg1_${Date.now()}`);
    const persona = await createZeroPersona(`${ZG_PREFIX}persona_zg1_${Date.now()}`);
    const env = loadZeroGenEnv();

    // 1. ゼロ生成 API を呼び出す (sync mode)
    const res = await page.request.post(`${env.baseUrl}/api/articles/zero-generate`, {
      data: {
        theme_id: theme.id,
        persona_id: persona.id,
        keywords: ['自己受容', '内なる声'],
        intent: 'empathy',
        target_length: 2000,
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.article_id).toBeTruthy();
    expect(body.status).toBe('completed');

    // 2. プレビュー画面を開く
    await page.goto(`/dashboard/articles/${body.article_id}/preview`);
    await page.waitForLoadState('networkidle');

    // 3. hero / body / summary の 3 セクションが描画されている
    await expect(page.locator('[data-section="hero"]')).toBeVisible();
    await expect(page.locator('[data-section="body"]')).toBeVisible();
    await expect(page.locator('[data-section="summary"]')).toBeVisible();

    // 4. CTA は必ず 3 箇所 (https://harmony-booking.web.app/)
    const ctas = page.locator('a[href="https://harmony-booking.web.app/"]');
    await expect(ctas).toHaveCount(3);
  });

  // ---------------------------------------------------------------------------
  // ZG-2: critical hallucination 注入 → PublishButton disabled + tooltip
  // ---------------------------------------------------------------------------
  test.skip('ZG-2: critical hallucination → PublishButton disabled with tooltip', async ({ page }) => {
    const theme = await createZeroTheme(`${ZG_PREFIX}theme_zg2_${Date.now()}`);
    const persona = await createZeroPersona(`${ZG_PREFIX}persona_zg2_${Date.now()}`);
    const env = loadZeroGenEnv();
    const sb = makeZeroGenAdminClient(env);

    // 1. 通常生成
    const res = await page.request.post(`${env.baseUrl}/api/articles/zero-generate`, {
      data: { theme_id: theme.id, persona_id: persona.id, keywords: ['断定'], intent: 'info' },
    });
    expect(res.status()).toBe(200);
    const { article_id } = await res.json();

    // 2. critical claim を直接 INSERT (DB-direct: ハルシネーション再評価を経ずに状態を作る)
    const { error } = await sb.from('article_claims').insert({
      article_id,
      sentence_idx: 0,
      claim_text: 'これは絶対に治る病気である',
      claim_type: 'spiritual',
      risk: 'critical',
      similarity_score: 0.12,
      evidence: { reason: 'no source backing', injected_for: 'ZG-2' },
    });
    if (error) throw error;

    // 3. 記事ページで PublishButton が disabled
    await page.goto(`/dashboard/articles/${article_id}`);
    const publishBtn = page.locator('[data-testid="publish-button"]');
    await expect(publishBtn).toBeDisabled();

    // 4. tooltip に critical 警告が出る
    await publishBtn.hover();
    await expect(page.locator('[role="tooltip"]')).toContainText(/critical|ハルシネーション/);
  });

  // ---------------------------------------------------------------------------
  // ZG-3: 再生成ループ最大 3 回 → article_revisions に履歴 INSERT、4 件超で最古削除
  // ---------------------------------------------------------------------------
  test.skip('ZG-3: regenerate up to 3 times → article_revisions retains last 3 + current', async ({ page }) => {
    const theme = await createZeroTheme(`${ZG_PREFIX}theme_zg3_${Date.now()}`);
    const persona = await createZeroPersona(`${ZG_PREFIX}persona_zg3_${Date.now()}`);
    const env = loadZeroGenEnv();
    const sb = makeZeroGenAdminClient(env);

    // 1. 初回生成
    const initial = await page.request.post(`${env.baseUrl}/api/articles/zero-generate`, {
      data: { theme_id: theme.id, persona_id: persona.id, keywords: ['再生成'], intent: 'introspect' },
    });
    expect(initial.status()).toBe(200);
    const { article_id } = await initial.json();

    // 2. 再生成 3 回 (segment scope=full)
    for (let i = 0; i < 3; i++) {
      const r = await page.request.post(`${env.baseUrl}/api/articles/${article_id}/regenerate-segment`, {
        data: { scope: 'full' },
      });
      expect(r.status()).toBe(200);
    }

    // 3. article_revisions は 3 件 (現在の published_html とは別に履歴 3 件保持)
    //    spec §14: 再生成ループ最大 3 回。MEMORY: バージョン履歴(4保持) は current+3 revisions。
    const { data: revs, error } = await sb
      .from('article_revisions')
      .select('id, revision_number, created_at')
      .eq('article_id', article_id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    expect(revs?.length).toBeLessThanOrEqual(3);
    expect(revs?.length).toBeGreaterThanOrEqual(1);

    // 4. 4 回目で最古が削除されることを確認
    const fourth = await page.request.post(`${env.baseUrl}/api/articles/${article_id}/regenerate-segment`, {
      data: { scope: 'full' },
    });
    expect(fourth.status()).toBe(200);
    const { data: revs2 } = await sb
      .from('article_revisions')
      .select('id, created_at')
      .eq('article_id', article_id)
      .order('created_at', { ascending: false });
    expect(revs2?.length).toBeLessThanOrEqual(3);
  });

  // ---------------------------------------------------------------------------
  // ZG-4: ペルソナ A/B 切替で tone-scoring 差分 > 0.25
  // ---------------------------------------------------------------------------
  test.skip('ZG-4: persona A vs B yields tone-score diff > 0.25', async ({ page }) => {
    const theme = await createZeroTheme(`${ZG_PREFIX}theme_zg4_${Date.now()}`);
    const personaA = await createZeroPersona(`${ZG_PREFIX}persona_zg4_a_${Date.now()}`);
    const personaB = await createZeroPersona(`${ZG_PREFIX}persona_zg4_b_${Date.now()}`);
    const env = loadZeroGenEnv();

    const genA = await page.request.post(`${env.baseUrl}/api/articles/zero-generate`, {
      data: { theme_id: theme.id, persona_id: personaA.id, keywords: ['共通テーマ'], intent: 'empathy' },
    });
    const genB = await page.request.post(`${env.baseUrl}/api/articles/zero-generate`, {
      data: { theme_id: theme.id, persona_id: personaB.id, keywords: ['共通テーマ'], intent: 'solve' },
    });
    expect(genA.status()).toBe(200);
    expect(genB.status()).toBe(200);

    const a = await genA.json();
    const b = await genB.json();
    const diff = Math.abs((a.yukiko_tone_score ?? 0) - (b.yukiko_tone_score ?? 0));
    expect(diff).toBeGreaterThan(0.25);
  });
});

// =============================================================================
// ZG-5: 50 記事連続生成耐久 (CI のみ。`--grep @zg-stress` 必要)
// =============================================================================

test.describe('@zg-stress Zero-Generation stress (spec §13.2 ZG-5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.includes('harmony-mc.com')) return route.abort('blockedbyclient');
      if (PROD_SUBSTRINGS.some((p) => url.includes(p))) return route.abort('blockedbyclient');
      return route.continue();
    });
    await ensureLoggedIn(page);
  });

  test.afterAll(async () => {
    if (envOk) await cleanupZeroFixtures();
  });

  test.skip('ZG-5: 50 sequential generations — no memory leak, p95 < 90s', async ({ page }) => {
    test.setTimeout(60 * 60_000); // 1 時間まで許容

    const theme = await createZeroTheme(`${ZG_PREFIX}theme_zg5_${Date.now()}`);
    const persona = await createZeroPersona(`${ZG_PREFIX}persona_zg5_${Date.now()}`);
    const env = loadZeroGenEnv();

    const durations: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = Date.now();
      const res = await page.request.post(`${env.baseUrl}/api/articles/zero-generate`, {
        data: {
          theme_id: theme.id,
          persona_id: persona.id,
          keywords: [`${ZG_PREFIX}stress_${i}`],
          intent: 'info',
          target_length: 2000,
        },
      });
      expect(res.status()).toBe(200);
      durations.push(Date.now() - t0);
    }

    const sorted = [...durations].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    expect(p95).toBeLessThan(90_000);
  });
});
