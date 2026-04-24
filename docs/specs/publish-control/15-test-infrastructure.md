# 15. Test Infrastructure Inventory (for Single-Confirm Publish Flow)

Last updated: 2026-04-19
Scope: Catalog existing test tooling in `blogauto` so we can plan a monkey-test
for the new "single confirm button" publish flow without duplicating scaffolding.

---

## 1. Summary (TL;DR)

- **Unit runner**: Vitest 2.1 (`vitest.config.ts`) — already wired, `@/` alias works.
- **E2E runner**: Playwright 1.48 (`playwright.config.ts`) — already wired, Chromium only, serial execution, 2-minute default timeout. Used today for full batch-generation flows.
- **CI**: GitHub Actions `.github/workflows/ci.yml` runs lint → type-check → `npm run test` (Vitest) → `next build`. **Playwright E2E is NOT in CI** (runs locally only).
- **Mocks/fixtures**: None. Existing E2E tests hit the **real** Supabase project (`khsorerqojgwbmtiqrac`) and the real dev server; unit tests operate on pure logic only.
- **Recommendation for the new publish-flow monkey test**: add a new Playwright spec under `test/e2e/publish-control/` (headed for dev, headless in CI), gated behind the same `TEST_USER_PASSWORD` env used by existing E2E tests. Back it with small Vitest unit tests around the pure guard/state-machine logic.

---

## 2. Existing Test Layout

```
test/
├── e2e/
│   ├── batch-api.spec.ts              # Playwright — hits Supabase REST directly
│   ├── batch-generation.spec.ts       # Playwright — full UI journey (login → batch gen)
│   └── helpers/
│       └── auth.ts                    # login / ensureLoggedIn helpers
├── integration/                       # EMPTY (placeholder dir, never populated)
└── unit/
    ├── cta-generator.test.ts          # modified in current WIP
    ├── perspective-transform.test.ts
    ├── seo-score.test.ts
    ├── source-analyzer.test.ts
    └── validators.test.ts
```

### 2.1 package.json scripts
```
"test":     "vitest run"          # unit tests, used by CI
"test:e2e": "playwright test"     # not used by CI, local only
```

### 2.2 vitest.config.ts (current)
```ts
environment: 'node'
include: ['test/**/*.test.ts']
globals: true
alias: { '@': ./src }
```
Picks up `test/unit/**/*.test.ts` and would also pick up any `test/integration/**/*.test.ts` if added. **Note**: Playwright spec files use `*.spec.ts`, so they are naturally excluded — no conflict.

### 2.3 playwright.config.ts (current)
```ts
testDir: './test/e2e'
fullyParallel: false   // serial (they share DB state)
workers: 1
reporter: 'html'
timeout: 120_000       // 2 min; AI-heavy tests bump to 600_000 inline
baseURL: process.env.TEST_BASE_URL || 'https://blogauto-pi.vercel.app'
projects: [chromium]
// NOTE: no webServer block → dev server must already be running
```

Key observations:
- Default `baseURL` points to the **production Vercel deployment**. Set `TEST_BASE_URL=http://localhost:3000` for local work.
- No `webServer` config means Playwright will NOT spawn `next dev` — the caller must.
- Only Chromium is configured; no Firefox/WebKit projects, no mobile viewports.
- Screenshots on failure, traces on first retry (but `retries: 0` globally, so traces effectively off).

---

## 3. Directories Shown in `git status`

| Path | Tracked? | Purpose |
|---|---|---|
| `test-results/` | Untracked (no `.gitignore` entry yet, but should be) | Playwright HTML reporter output. Currently contains `.last-run.json` and a leftover `test-article-output.html`. |
| `out/` | Untracked (no `.gitignore` entry) | Static HTML mirror of the public column site (`out/column/*.html`, `out/css/`, `out/js/`, `sitemap.xml`, etc.). **This is a content artifact, not a test artifact** — used by the FTP deploy scripts in `scripts/ftp-deploy-*.ts`. It is NOT Playwright output. |
| `tmp/` | Untracked | Misc scratch output from the many `scripts/*.ts` one-shots. |

Relevant gaps in `.gitignore` (current content):
```
node_modules/   .env   .env.local   .env*.local   .next/   dist/   .vercel/   *.log   .DS_Store
```
Missing: `test-results/`, `playwright-report/`, `out/`, `tmp/`. Worth adding when we land the new test — otherwise `test-results/` will keep leaking into commits.

---

## 4. CI Configuration

Only `.github/workflows/ci.yml` exists:
- Trigger: push/PR to `main`
- Node 20, `npm ci`
- Steps: `npm run lint`, `npm run type-check`, `npm run test` (Vitest only), `npm run build`
- Secrets wired: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **No Playwright install step, no E2E run**.

`vercel.json` is purely runtime config (function `maxDuration` overrides, region `hnd1`) — nothing test-related.

---

## 5. Mocks / Fixtures for Supabase or FTP

**There are none.** Specifically:

- No `vi.mock(...)`, `vi.fn(...)`, or `jest.fn(...)` anywhere under `test/` (grep returned zero hits).
- `test/e2e/batch-api.spec.ts` hardcodes a **real service-role key** and queries the live Supabase project. This is a smell (leaked key in repo) but it's the status-quo pattern we inherit.
- `test/e2e/batch-generation.spec.ts` logs in as a real user (`TEST_USER_EMAIL` / `TEST_USER_PASSWORD`) against the real Supabase Auth endpoint.
- No FTP mocking. `basic-ftp` is used by `scripts/ftp-deploy-*.ts` only; never invoked from any test today.
- No Supabase local emulator (`supabase start`) usage in tests — `package.json` has `db:migrate` via `npx supabase` but nothing wires a test DB.

Unit tests (`test/unit/*.test.ts`) sidestep all of this by testing **pure functions** from `src/lib/content/*` and `src/lib/seo/*`. They import and call functions directly with hand-built inputs; no DB, no network.

---

## 6. Coverage Gaps Relevant to the Publish Flow

The upcoming single-confirm-button publish flow touches:
1. UI state machine (confirm button enabled/disabled, modal, double-click guards)
2. `article-revisions` INSERT before any HTML overwrite (per MEMORY.md `feedback_html_history` rule)
3. `articles.status` transitions (e.g. `body_review` → `ready` → `published`)
4. FTP deploy of `published_html` + hub regeneration (`/api/hub/deploy`)
5. `published_at` stamping and idempotency if user clicks twice

Current coverage of those surfaces: **essentially zero**.
- No unit test on any API route under `src/app/api/` (routes aren't imported anywhere in `test/`).
- No test for revision history invariants.
- No test for the "click → navigate → confirm" modal flow.
- FTP path is completely untested in any automated way.

---

## 7. Recommendation: Framework Choice for the Monkey Test

Three layers, pick where each assertion belongs:

### 7.1 Playwright headed — the monkey test itself  (PRIMARY)
Best fit for "single confirm button" because the whole point of the flow is a UI affordance. Playwright is already installed (`@playwright/test ^1.48.0`), already configured for the repo, and existing helpers (`ensureLoggedIn`) work out of the box.
- **Use headed locally** (`npx playwright test --headed`) for the dry-run / random-click "monkey" phase.
- Use headless in CI (when/if we wire E2E into CI — currently not).
- Random-click loops can use `page.locator('button').all()` + a seedable PRNG, with an allow-list so we don't click "Delete Article" 200 times against the real DB.
- Run against `TEST_BASE_URL=http://localhost:3000` with `next dev` started separately (matches today's convention — no `webServer` in config).

### 7.2 Integration tests against a test Supabase project  (DEFER)
Would catch RLS / trigger / revision-INSERT regressions. But:
- No test Supabase project exists today.
- Spinning up `supabase start` locally + seed fixtures is a meaningful project of its own.
- **Recommendation**: skip for this iteration. Instead, have the Playwright monkey test run against a **dedicated "test" article row** (created in `beforeAll`, deleted in `afterAll`) in the real Supabase, same pattern used by `batch-api.spec.ts` today. Scope its destructive actions to that row's id.

### 7.3 Vitest unit tests around pure logic  (COMPLEMENT)
For everything that can be extracted away from the UI and DB:
- Guard function: "given article in status X with flags Y, can it be published?" → pure predicate, trivial to test.
- Revision-history wrapper: test that calling `overwriteHtml(...)` always calls `insertRevision(...)` first (use a spy/mock on an injected client — introduce DI if not already there).
- State-machine transitions: table-driven test of legal/illegal status edges.

These catch 80% of regressions cheaply and run in CI today without any infra changes.

---

## 8. Required Additions / Dependencies

No new npm dependencies are needed for the recommended approach:
- `@playwright/test` — already installed.
- `vitest` — already installed.
- `@supabase/supabase-js` — already installed, usable directly in Playwright specs (as `batch-api.spec.ts` demonstrates via raw `fetch` + REST, which also works).

Suggested small additions (config only, no install):
- Add `test-results/` and `playwright-report/` to `.gitignore`.
- Optionally add a `webServer` block to `playwright.config.ts` so new contributors don't have to remember to start `next dev`:
  ```ts
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  }
  ```
  (Opt-in; existing specs will keep working either way.)
- When E2E is finally added to CI, add a separate job with `npx playwright install --with-deps chromium` — don't bolt it onto the existing fast Vitest job.

---

## 9. Skeleton — Where the New Monkey Test Lives

Proposed layout:

```
test/
└── e2e/
    └── publish-control/
        ├── single-confirm-happy-path.spec.ts   # scripted: login → edit → confirm → verify published
        ├── single-confirm-monkey.spec.ts       # random-click allowlisted loop, N iterations
        ├── single-confirm-regressions.spec.ts  # specific bugs once they're fixed
        └── helpers/
            ├── publish-fixtures.ts             # creates & tears down a test article row
            └── safe-clickables.ts              # allowlist of button selectors the monkey may click
```

Sibling unit tests:
```
test/unit/
├── publish-guard.test.ts        # pure predicate: canPublish(article, user) → boolean
├── publish-state-machine.test.ts # status transition table
└── revision-insert-wrapper.test.ts # overwriteHtml always inserts revision first
```

Skeleton for `single-confirm-monkey.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from '../helpers/auth';
import { createTestArticle, deleteTestArticle } from './helpers/publish-fixtures';
import { SAFE_SELECTORS } from './helpers/safe-clickables';

test.describe('Single-confirm publish — monkey', () => {
  let articleId: string;

  test.beforeAll(async () => {
    articleId = await createTestArticle({ status: 'body_review' });
  });

  test.afterAll(async () => {
    await deleteTestArticle(articleId);
  });

  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page);
  });

  test('200 random clicks on publish page do not break invariants', async ({ page }) => {
    await page.goto(`/dashboard/articles/${articleId}`);

    const seed = Number(process.env.MONKEY_SEED ?? Date.now());
    const rng = mulberry32(seed);
    console.log('[monkey] seed =', seed);

    for (let i = 0; i < 200; i++) {
      const candidates = await page.locator(SAFE_SELECTORS.join(', ')).all();
      if (candidates.length === 0) break;
      const target = candidates[Math.floor(rng() * candidates.length)];
      await target.click({ trial: false, timeout: 1000 }).catch(() => {});

      // Invariants that must ALWAYS hold:
      //  - no duplicate publish: publish button disabled while in-flight
      //  - no overwrite without a revision row (check via Supabase REST)
      //  - status never regresses from 'published'
    }

    // Final assertions go here.
  });
});

function mulberry32(a: number) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
```

Skeleton for `publish-guard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canPublish } from '@/lib/publish/guard'; // to be created alongside the feature

describe('canPublish', () => {
  it('blocks when status is draft', () => {
    expect(canPublish({ status: 'draft', reviewed_at: null } as any)).toBe(false);
  });
  it('blocks when reviewed_at is null', () => {
    expect(canPublish({ status: 'body_review', reviewed_at: null } as any)).toBe(false);
  });
  it('allows when status is body_review and reviewed_at is set', () => {
    expect(canPublish({ status: 'body_review', reviewed_at: '2026-04-19' } as any)).toBe(true);
  });
  it('blocks re-publishing', () => {
    expect(canPublish({ status: 'published', reviewed_at: '2026-04-19' } as any)).toBe(false);
  });
});
```

---

## 10. Open Questions for the Feature Spec

These affect how the monkey test is authored — resolve before implementation:

1. **Double-click idempotency**: does the confirm button disable optimistically on click, or does the server enforce a single-publish constraint? (Monkey test must know which to assert.)
2. **Destructive allowlist**: should the monkey click "Delete article" at all? Current lean: **no** — explicitly denylist it to avoid torching the fixture row mid-run.
3. **FTP in tests**: do we stub FTP for the monkey run (preferred — FTP to production on every `npm run test:e2e` is wrong) or point it at a staging FTP host?
4. **Revision history assertion**: check via direct Supabase REST query (like `batch-api.spec.ts` does) or expose an internal `/api/_test/revisions/:articleId` route guarded by `NODE_ENV !== 'production'`?

---

## 11. Referenced Files

- `/Users/yasudaosamu/Desktop/codes/blogauto/package.json`
- `/Users/yasudaosamu/Desktop/codes/blogauto/vitest.config.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/playwright.config.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/.github/workflows/ci.yml`
- `/Users/yasudaosamu/Desktop/codes/blogauto/.gitignore`
- `/Users/yasudaosamu/Desktop/codes/blogauto/vercel.json`
- `/Users/yasudaosamu/Desktop/codes/blogauto/test/e2e/batch-generation.spec.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/test/e2e/batch-api.spec.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/test/e2e/helpers/auth.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/test/unit/cta-generator.test.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/test/unit/seo-score.test.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/test/unit/perspective-transform.test.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/test/unit/source-analyzer.test.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/test/unit/validators.test.ts`
