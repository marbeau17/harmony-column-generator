/**
 * Zero-Generation E2E "real form" suite (J16 / spec §13.2 ZG-FORM)
 *
 * 既存の zero-generation.spec.ts は API 直叩きで /zero-generate-full の
 * 統合パイプラインを検証する。本 spec はもう一段上のレイヤとして、
 *
 *   "ユーザがブラウザでフォームに入力 → /api/articles/zero-generate-full に
 *    UUID 形式の theme_id / persona_id を含む body が POST されること"
 *
 * を保証する。実 Gemini は呼ばず、page.route で fulfill してしまう。
 *
 * 想定セットアップ:
 *   - shadow Supabase に test/e2e/fixtures/zero-generation-seed.sql が適用済み。
 *     固定 UUID:
 *       テーマ        : 00000000-0000-0000-0001-000000000001 (zg_self_love)
 *                       … name は seed では `zg_self_love` 固定だが、
 *                       本 spec は『テスト由起子テーマ A』というラベルを
 *                       /api/themes のレスポンスを fulfill して与えることで
 *                       UI 上の選択肢として再利用する。
 *       ペルソナ      : 00000000-0000-0000-0002-000000000001 (zg_persona_a_seeker)
 *                       同上、ラベルは『テスト由起子ペルソナ A』として fulfill。
 *
 * 検証ポイント:
 *   1. /api/themes と /api/personas が fulfill されたモックで描画される
 *   2. theme select / persona select / keyword chip / intent radio / target_length
 *      が想定通り操作できる
 *   3. 「生成」クリックで /api/articles/zero-generate-full に POST されたとき、
 *      body.theme_id と body.persona_id が UUID v? 形式 (8-4-4-4-12) であること
 *   4. POST の他フィールド (keywords / intent / target_length) も期待値通り
 *   5. レスポンスを 201 + lead_summary 等で fulfill すると、UI が完了モードへ遷移
 *      する（『記事生成が完了しました』が可視）
 *
 * 注意:
 *   - production code は触らない (テストのみ)
 *   - マイグレ追加なし
 *   - 実 fetch/Gemini 呼び出しは route.fulfill で全遮断
 *   - shadow E2E 実機実行は J18 担当。本タスクは spec 作成のみで、
 *     env 不在時は test.skip(condition) で skip する。
 */
import { test, expect, type Route } from '@playwright/test';
import { ensureLoggedIn } from './helpers/auth';
import { PROD_SUBSTRINGS } from './helpers/zero-generation-fixtures';

// =============================================================================
// 固定 UUID — zero-generation-seed.sql の J12 安定化と同じ値。
// テストは UI 経由でこの UUID を select させ、API ボディに乗ってくることを検証する。
// =============================================================================
const TEST_THEME_ID_A   = '00000000-0000-0000-0001-000000000001';
const TEST_PERSONA_ID_A = '00000000-0000-0000-0002-000000000001';

// 表示ラベル (本タスクの要求どおり、UI 上では『テスト由起子◯◯◯ A』を選ばせる)
const TEST_THEME_LABEL_A   = 'テスト由起子テーマ A';
const TEST_PERSONA_LABEL_A = 'テスト由起子ペルソナ A';

// UUID v1〜v5 を許容する (8-4-4-4-12 hex)
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// =============================================================================
// env チェック — TEST_USER_PASSWORD と MONKEY_BASE_URL のどちらかが無い場合は skip。
// shadow Supabase / FTP_DRY_RUN は本 spec ではモック前提のため必須にしない。
// （J18 が実機で回す際は zero-generation-fixtures.ts と同じ env 群を使う）
// =============================================================================
function shouldSkip(): { skip: boolean; reason: string } {
  if (!process.env.TEST_USER_PASSWORD) {
    return { skip: true, reason: 'TEST_USER_PASSWORD not set' };
  }
  // 本番への漏洩防止: baseURL に prod が混じっていれば skip
  const baseUrl = process.env.MONKEY_BASE_URL || process.env.TEST_BASE_URL || '';
  if (baseUrl.includes('blogauto-pi.vercel.app')) {
    return { skip: true, reason: 'baseURL targets production; refuse to run' };
  }
  if (
    process.env.MONKEY_SUPABASE_URL &&
    PROD_SUBSTRINGS.some((p) => process.env.MONKEY_SUPABASE_URL!.includes(p))
  ) {
    return { skip: true, reason: 'MONKEY_SUPABASE_URL looks like prod' };
  }
  return { skip: false, reason: '' };
}

// =============================================================================
// ZG-FORM-1
// =============================================================================
test.describe('Zero-Generation E2E real form (spec §13.2 ZG-FORM)', () => {
  test('ZG-FORM-1: form submits UUID theme_id/persona_id to /zero-generate-full and shows completion UI', async ({
    page,
  }) => {
    const guard = shouldSkip();
    test.skip(guard.skip, guard.reason);

    test.setTimeout(60_000);

    // -------------------------------------------------------------------------
    // 1. 本番遮断 (zero-generation.spec.ts と同じ blocklist)
    // -------------------------------------------------------------------------
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.includes('harmony-mc.com')) return route.abort('blockedbyclient');
      if (PROD_SUBSTRINGS.some((p) => url.includes(p))) {
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });

    // -------------------------------------------------------------------------
    // 2. /api/themes と /api/personas を fulfill
    //    seed の固定 UUID を再利用しつつ、UI 上のラベルだけ
    //    『テスト由起子テーマ A』『テスト由起子ペルソナ A』に差し替えて
    //    select option として描画させる。
    // -------------------------------------------------------------------------
    await page.route('**/api/themes', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          themes: [
            {
              id: TEST_THEME_ID_A,
              name: TEST_THEME_LABEL_A,
              category: 'spiritual',
            },
          ],
        }),
      });
    });

    await page.route('**/api/personas', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          personas: [
            {
              id: TEST_PERSONA_ID_A,
              name: TEST_PERSONA_LABEL_A,
              age_range: '30-40',
            },
          ],
        }),
      });
    });

    // -------------------------------------------------------------------------
    // 3. /api/articles/zero-generate-full を intercept
    //    - 受信 body の UUID 形式と内容を検証
    //    - レスポンスは 201 + lead_summary 等で fulfill (Gemini 呼出は走らない)
    //    - article_id は適当な UUID を返す（後続 enrichResult 用）
    // -------------------------------------------------------------------------
    let capturedBody: unknown = null;
    const FAKE_ARTICLE_ID = '00000000-0000-0000-0003-00000000face';

    await page.route('**/api/articles/zero-generate-full', async (route: Route) => {
      const req = route.request();
      // body は string で受け取り、JSON.parse する (postDataJSON は型情報無し)
      const raw = req.postData() ?? '{}';
      try {
        capturedBody = JSON.parse(raw);
      } catch {
        capturedBody = { __unparsed__: raw };
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          article_id: FAKE_ARTICLE_ID,
          status: 'draft',
          generation_mode: 'zero',
          partial_success: false,
          lead_summary: 'テスト用のリードサマリ',
          narrative_arc: 'discover -> accept -> integrate',
          scores: {
            hallucination: 92.5,
            yukiko_tone: 0.81,
            centroid_similarity: 0.74,
          },
          claims_count: 6,
          criticals: 0,
          tone_passed: true,
          cta_variants_count: 3,
          duration_ms: 12345,
          stages: {
            outline: 'ok',
            writing: 'ok',
            insert_article: 'ok',
          },
        }),
      });
    });

    // 後続 enrichResult が呼ぶ /api/articles/[id] と /hallucination-check も
    // 実 DB に到達させたくないので fulfill しておく。
    await page.route(`**/api/articles/${FAKE_ARTICLE_ID}`, async (route: Route) => {
      // GET のみ反応すれば良い（POST/PATCH は通さなくても本テストの assert に影響しない）
      if (route.request().method() !== 'GET') return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            id: FAKE_ARTICLE_ID,
            title: 'テスト由起子テーマ A の生成記事',
            html_body: '<p>本文ダミー</p>',
            stage2_body_html: '<p>stage2 ダミー</p>',
            meta_description: 'テスト用',
            hallucination_score: 92.5,
            yukiko_tone_score: 0.81,
          },
        }),
      });
    });

    await page.route(
      `**/api/articles/${FAKE_ARTICLE_ID}/hallucination-check`,
      async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            hallucination_score: 92.5,
            criticals: 0,
            claims_count: 0,
            claims: [],
          }),
        });
      },
    );

    // -------------------------------------------------------------------------
    // 4. ログイン → new-from-scratch へ
    // -------------------------------------------------------------------------
    await ensureLoggedIn(page);
    await page.goto('/dashboard/articles/new-from-scratch');
    await page.waitForLoadState('domcontentloaded');

    // -------------------------------------------------------------------------
    // 5. テーマ select で『テスト由起子テーマ A』を選ぶ
    //    new-from-scratch/page.tsx の <select id="theme"> を直接触る。
    // -------------------------------------------------------------------------
    const themeSelect = page.locator('#theme');
    await expect(themeSelect).toBeVisible({ timeout: 15_000 });
    // option が描画されるのを待つ（fulfill 反映後）
    await expect(themeSelect.locator(`option:has-text("${TEST_THEME_LABEL_A}")`)).toHaveCount(1, {
      timeout: 10_000,
    });
    await themeSelect.selectOption({ label: TEST_THEME_LABEL_A });
    await expect(themeSelect).toHaveValue(TEST_THEME_ID_A);

    // -------------------------------------------------------------------------
    // 6. ペルソナ select で『テスト由起子ペルソナ A』を選ぶ
    // -------------------------------------------------------------------------
    const personaSelect = page.locator('#persona');
    await expect(personaSelect).toBeVisible();
    await expect(personaSelect.locator(`option:has-text("${TEST_PERSONA_LABEL_A}")`)).toHaveCount(1, {
      timeout: 10_000,
    });
    await personaSelect.selectOption({ label: TEST_PERSONA_LABEL_A });
    await expect(personaSelect).toHaveValue(TEST_PERSONA_ID_A);

    // -------------------------------------------------------------------------
    // 7. キーワード『チャクラ』を Enter で追加
    // -------------------------------------------------------------------------
    const keywordInput = page.locator('#keywords');
    await keywordInput.fill('チャクラ');
    await keywordInput.press('Enter');
    // chip としてレンダリングされることを確認
    await expect(page.getByText('チャクラ', { exact: true })).toBeVisible();

    // -------------------------------------------------------------------------
    // 8. intent ラジオで『情報提供』を選択
    //    IntentRadioCard は role="radio" + aria-label テキストで描画される。
    // -------------------------------------------------------------------------
    const infoRadio = page.getByRole('radio', { name: /情報提供/ });
    await expect(infoRadio).toBeVisible();
    await infoRadio.click();
    await expect(infoRadio).toHaveAttribute('aria-checked', 'true');

    // -------------------------------------------------------------------------
    // 9. 目標文字数 = 2000
    // -------------------------------------------------------------------------
    const targetLengthInput = page.locator('#targetLength');
    await targetLengthInput.fill('2000');
    await expect(targetLengthInput).toHaveValue('2000');

    // -------------------------------------------------------------------------
    // 10. 「生成」クリック
    //     button[type="submit"] かつテキスト『生成』を含むものを取得。
    // -------------------------------------------------------------------------
    const submitBtn = page.locator('button[type="submit"]', { hasText: '生成' });
    await expect(submitBtn).toBeEnabled();

    // POST 完了を待つために waitForResponse を仕掛けてから click
    const postPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/articles/zero-generate-full') &&
        resp.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await submitBtn.click();
    const postResp = await postPromise;
    expect(postResp.status()).toBe(201);

    // -------------------------------------------------------------------------
    // 11. capturedBody が UUID 形式 + 期待値で POST されたことを assert
    // -------------------------------------------------------------------------
    expect(capturedBody, 'POST body should have been captured by route handler').not.toBeNull();
    const body = capturedBody as Record<string, unknown>;

    // theme_id / persona_id が UUID 形式
    expect(typeof body.theme_id).toBe('string');
    expect(typeof body.persona_id).toBe('string');
    expect(body.theme_id as string).toMatch(UUID_RE);
    expect(body.persona_id as string).toMatch(UUID_RE);

    // 値そのものも seed の固定 UUID と一致
    expect(body.theme_id).toBe(TEST_THEME_ID_A);
    expect(body.persona_id).toBe(TEST_PERSONA_ID_A);

    // その他フィールド
    expect(Array.isArray(body.keywords)).toBe(true);
    expect((body.keywords as string[]).includes('チャクラ')).toBe(true);
    expect(body.intent).toBe('info');
    expect(body.target_length).toBe(2000);

    // -------------------------------------------------------------------------
    // 12. UI で完了表示が出ること
    //     new-from-scratch/page.tsx は 'done' stage で
    //     "記事生成が完了しました" のヘッダーをレンダリングする。
    // -------------------------------------------------------------------------
    await expect(page.getByText('記事生成が完了しました')).toBeVisible({
      timeout: 15_000,
    });

    // 「記事ページへ」リンクに mock article_id が反映されていることも軽く確認
    const articleLink = page.getByRole('link', { name: /記事ページへ/ });
    await expect(articleLink).toBeVisible();
    await expect(articleLink).toHaveAttribute(
      'href',
      `/dashboard/articles/${FAKE_ARTICLE_ID}`,
    );
  });
});
