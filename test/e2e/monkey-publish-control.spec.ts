import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers/auth';
import {
  cleanupMonkeyArticles,
  countNonMonkeyArticles,
  loadMonkeyEnv,
  makeAdminClient,
  mulberry32,
  seedMonkeyArticles,
  ulid,
  PROD_SUBSTRINGS,
} from './helpers/monkey-fixtures';

// Monkey publish-control suite.
// Run: `FTP_DRY_RUN=true MONKEY_TEST=true PUBLISH_CONTROL_V2=on \
//       MONKEY_SUPABASE_URL=... MONKEY_SUPABASE_SERVICE_ROLE=... \
//       MONKEY_BASE_URL=http://localhost:3000 npm run test:e2e -- monkey-publish-control`
//
// Spec: docs/specs/publish-control/19-monkey-test-plan.md

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
  // Layer 5: route blocklist.
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.includes('harmony-mc.com')) return route.abort('blockedbyclient');
    if (PROD_SUBSTRINGS.some((p) => url.includes(p))) return route.abort('blockedbyclient');
    return route.continue();
  });
  await login(page);
});

async function visibility(page: Page, articleId: string, visible: boolean, reqId: string) {
  return page.request.post(`${env.baseUrl}/api/articles/${articleId}/visibility`, {
    data: { visible, requestId: reqId },
  });
}

test('S1: visible=true on draft → 422 NOT_PUBLISHED', async ({ page }) => {
  const [id] = await seedMonkeyArticles(sb, 1);
  await sb.from('articles').update({ status: 'draft' }).eq('id', id);
  const rng = mulberry32(env.seed + 1);
  const res = await visibility(page, id, true, ulid(rng));
  expect(res.status()).toBe(422);
});

test('S2: publish then unpublish a monkey article flips is_hub_visible', async ({ page }) => {
  const [id] = await seedMonkeyArticles(sb, 1);
  const rng = mulberry32(env.seed + 2);

  const pub = await visibility(page, id, true, ulid(rng));
  expect([200, 207]).toContain(pub.status());

  const { data: mid } = await sb.from('articles').select('is_hub_visible,visibility_state').eq('id', id).single();
  expect(mid?.is_hub_visible).toBe(true);

  const unpub = await visibility(page, id, false, ulid(rng));
  expect([200, 207]).toContain(unpub.status());

  const { data: after } = await sb.from('articles').select('is_hub_visible,visibility_state').eq('id', id).single();
  expect(after?.is_hub_visible).toBe(false);
});

test('S3: double-click same requestId is idempotent', async ({ page }) => {
  const [id] = await seedMonkeyArticles(sb, 1);
  const rng = mulberry32(env.seed + 3);
  const rid = ulid(rng);
  const a = await visibility(page, id, true, rid);
  const b = await visibility(page, id, true, rid);
  expect([200, 207]).toContain(a.status());
  expect(b.status()).toBe(200);
  const { count } = await sb
    .from('publish_events')
    .select('id', { head: true, count: 'exact' })
    .eq('article_id', id)
    .eq('request_id', rid);
  expect(count).toBe(1);
});

test('S4: noop when already visible returns 200 noop', async ({ page }) => {
  const [id] = await seedMonkeyArticles(sb, 1);
  const rng = mulberry32(env.seed + 4);
  const first = await visibility(page, id, true, ulid(rng));
  expect([200, 207]).toContain(first.status());
  const second = await visibility(page, id, true, ulid(rng));
  expect(second.status()).toBe(200);
  const body = await second.json();
  expect(body.status === 'noop' || body.visible === true).toBeTruthy();
});

test('S5: invalid requestId → 400', async ({ page }) => {
  const [id] = await seedMonkeyArticles(sb, 1);
  const res = await page.request.post(`${env.baseUrl}/api/articles/${id}/visibility`, {
    data: { visible: true, requestId: 'not-a-ulid' },
  });
  expect(res.status()).toBe(400);
});

test('S6: concurrent toggles on two different articles both succeed', async ({ page, context }) => {
  const [a, b] = await seedMonkeyArticles(sb, 2);
  const rng = mulberry32(env.seed + 6);
  const [ra, rb] = await Promise.all([
    visibility(page, a, true, ulid(rng)),
    context.request.post(`${env.baseUrl}/api/articles/${b}/visibility`, {
      data: { visible: true, requestId: ulid(rng) },
    }),
  ]);
  expect([200, 207]).toContain(ra.status());
  expect([200, 207]).toContain(rb.status());
});

test('S7: random monkey burst — 50 mixed operations on 5 articles, row-count invariant holds', async ({ page }) => {
  const ids = await seedMonkeyArticles(sb, 5);
  const rng = mulberry32(env.seed + 7);
  const midNonMonkey = await countNonMonkeyArticles(sb);
  expect(midNonMonkey).toBe(preCount);

  for (let i = 0; i < 50; i++) {
    const id = ids[Math.floor(rng() * ids.length)];
    const visible = rng() < 0.5;
    const res = await visibility(page, id, visible, ulid(rng));
    expect([200, 207, 400, 409, 422, 423]).toContain(res.status());
  }

  const afterNonMonkey = await countNonMonkeyArticles(sb);
  expect(afterNonMonkey).toBe(preCount);
});
