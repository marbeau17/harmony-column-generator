# 19. Monkey Test Plan — Confirm Button / Publish Control Flow

**Status:** Plan (no tests executed yet)
**Scope:** End-to-end proof that the new "confirm checkbox → deploy" flow is correct, idempotent, and safe to ship.
**HARD CONSTRAINT:** The 45 existing published articles on `harmony-mc.com/column/` and their rows in the production Supabase project MUST NOT be touched by this test suite. Ever.

---

## 1. Framework Choice

| Candidate | Decision | Why |
|---|---|---|
| **Playwright (TypeScript, headed + headless)** | **CHOSEN** | Same language as the app, can drive real `/admin` UI, can read/write Supabase via our existing `lib/db` module from within the test process, has built-in tracing for flake diagnosis. |
| Cypress | Rejected | Harder to run Node-level assertions against Supabase in-process; we'd have to shell out. |
| Pure Vitest + fetch | Rejected | Confirm button is a UI interaction with optimistic state; we want the real React render path. |
| Manual clicking | Rejected | Monkey = randomness + volume. Humans don't produce reliable rapid double-clicks. |

**Modes:**
- `npm run test:monkey` → headless (CI gate).
- `npm run test:monkey:headed` → headed (`--headed --slowmo=250`) for debugging.
- Tracing (`--trace on`) always enabled; trace zips go to `test-results/monkey/`.

**Seed control:** every test run accepts `MONKEY_SEED=<int>` so "random" click sequences are reproducible. Default seed logged on first line of the run.

---

## 2. Environment Isolation (the critical piece)

We use **four independent layers** so the real 45 articles cannot be reached.

### Layer A — Separate Supabase project
- A dedicated **"harmony-dev"** Supabase project (separate URL + anon/service keys) is used.
- `.env.test` contains only dev keys. The test runner **refuses to start** if `NEXT_PUBLIC_SUPABASE_URL` contains `harmony-prod` or if the URL matches the value in `.env.local` / `.env.production`.
- Guard in `test/monkey/setup.ts`:
  ```ts
  if (process.env.SUPABASE_URL === PROD_URL) throw new Error("REFUSING: prod URL detected");
  if (!process.env.SUPABASE_URL?.includes("dev")) throw new Error("REFUSING: dev URL required");
  ```

### Layer B — FTP client is mocked, always
- `lib/ftp/client.ts` is swapped via a Vitest/Playwright module alias to `test/mocks/ftp-mock.ts`.
- The mock writes to `test-results/monkey/fake-ftp/<path>` on disk. **Zero network traffic** to `harmony-mc.com`.
- The mock exposes `getUploads()`, `getDeletes()`, `reset()` for assertions.
- Belt-and-suspenders: real FTP module checks `process.env.DRY_RUN === "true"` and no-ops if set. Test env sets `DRY_RUN=true` globally.

### Layer C — Article ID namespace
- All fixtures use slugs prefixed with `monkey-` (e.g. `monkey-article-001`).
- Every test starts with `DELETE FROM articles WHERE slug LIKE 'monkey-%'` in dev DB, then seeds 10 fresh monkey articles.
- Production article IDs are UUIDs assigned by real pipeline; monkey IDs are deterministic (`00000000-0000-0000-0000-0000000000NN`). A DB constraint check in `beforeAll` verifies `COUNT(*) WHERE slug NOT LIKE 'monkey-%'` returns `0` on dev — if dev somehow has real articles, the suite aborts.

### Layer D — Local hub server for HTML assertions
- A tiny `next start -p 3099` (test-only) renders the hub + article pages against dev DB.
- Playwright navigates to `http://localhost:3099`, never to `harmony-mc.com`.
- Assertions on "hub HTML contents" read the rendered DOM from this local server, not from prod.

**If any one of these four layers is misconfigured, the run aborts before the first click.**

---

## 3. Fixture Strategy

`test/monkey/fixtures.ts` builds the world:

| Fixture | Count | State | Purpose |
|---|---|---|---|
| `monkey-draft-*` | 3 | `status=draft`, `reviewed_at=NULL` | Gate test: cannot be confirmed. |
| `monkey-reviewed-*` | 3 | `status=reviewed`, `reviewed_at=<ts>` | Happy-path confirm. |
| `monkey-published-*` | 5 | `status=published`, `visible=true` | Unpublish/republish flows. |
| `monkey-hub-popular-*` | 1 | `status=published`, referenced by 4 others as "related" | Ripple-effect test. |
| `monkey-revisions-seed` | 1 | 3 existing rows in `article_revisions` | Revision-count baseline. |

All fixtures are seeded via a single `seedMonkeyWorld({ seed })` helper that wipes the `monkey-` namespace first. Images are referenced but not uploaded (URLs are placeholders served by the local hub).

---

## 4. Random-Action Scenarios (the "monkey")

The monkey is a generator that produces a sequence of weighted random actions from a fixed vocabulary, then executes them against the UI via Playwright. Each run defaults to **200 actions** over the seeded 13-article world.

### Vocabulary

| Action | Weight | Description |
|---|---|---|
| `CLICK_CONFIRM(article)` | 30 | Toggle the confirm checkbox on a random article row. |
| `DOUBLE_CLICK_CONFIRM(article)` | 10 | Two clicks within 80ms — idempotency probe. |
| `CONCURRENT_TOGGLE(a, b)` | 10 | `Promise.all` two different article toggles. |
| `EDIT_BODY(article)` | 10 | Open editor, change one word, save (creates revision). |
| `NAVIGATE_HUB` | 10 | Load hub page, assert it renders. |
| `OPEN_ARTICLE(article)` | 10 | Load public article URL on local hub. |
| `NETWORK_FAIL_DEPLOY(article)` | 5 | Force FTP mock to throw on next upload. |
| `REFRESH_ADMIN` | 10 | Full page reload of `/admin`. |
| `NOOP_WAIT` | 5 | 0–300ms sleep — lets React settle. |

The monkey picks actions until it hits the action budget. Arguments are drawn uniformly from the monkey-namespace fixtures.

### Named scenarios (always run in addition to the random walk)

1. **Confirm-a-draft gate:** `CLICK_CONFIRM(monkey-draft-1)` → expect a toast/error `"レビュー承認が必要です"` (or whatever the gate copy is) and **no** FTP calls, **no** status change.
2. **Publish ripple:** `CLICK_CONFIRM(monkey-reviewed-1)` → expect `visible=true`, hub HTML lists the article, revision count +1, FTP mock saw exactly one `column/<slug>.html` upload + one `column/index.html` upload.
3. **Unpublish ripple on the popular one:** `CLICK_CONFIRM(monkey-hub-popular-1)` (toggle off) → all 4 articles that list it in their "related" block must be re-rendered and re-uploaded. Assert `ftpMock.getUploads()` contains exactly those 4 related slugs + 1 hub.
4. **Rapid double-click idempotency:** `DOUBLE_CLICK_CONFIRM(monkey-reviewed-2)` → exactly ONE deploy; `article_revisions` gains exactly ONE row; `ftpMock.getUploads()` has no duplicates for that slug.
5. **Concurrent toggles:** `CONCURRENT_TOGGLE(monkey-reviewed-3, monkey-published-1)` → both succeed, final DB state matches both intents, no interleaved hub corruption (hub HTML reflects BOTH).
6. **Toggle → edit → toggle:** publish → edit body → unpublish → publish. `article_revisions` should have 3 new rows (one per state-changing or body-changing op per the HTML-history rule), kept at max 4 total as per retention policy.
7. **Network fail mid-deploy:** enable `NETWORK_FAIL_DEPLOY` once, then `CLICK_CONFIRM`. Expect:
   - DB `status`/`visible` rolled back to pre-click state.
   - `article_revisions` not incremented (or marked `failed` — whichever the spec dictates; monkey asserts both rows are consistent).
   - User-facing error surfaced in UI.
   - No partial hub upload (hub either old or new, never mid-write).

---

## 5. Assertion Surfaces

After every action and at the end of the full random walk, the harness checks:

### DB state (dev Supabase)
- `articles.status`, `articles.visible`, `articles.reviewed_at` match the expected state machine.
- `article_revisions` row count per article never exceeds 4 (retention).
- `html_snapshot` in the latest revision matches what FTP mock last uploaded for that slug.
- Row count of `WHERE slug NOT LIKE 'monkey-%'` is **unchanged** from `beforeAll` snapshot — production-shaped rows untouched even in dev.

### FTP mock
- `ftpMock.getUploads()` equals the expected set for each scenario (exact match, ordered or unordered depending on case).
- `ftpMock.getDeletes()` matches unpublish expectations.
- No upload path ever starts with `/public_html/column/` for a slug outside the `monkey-` namespace.

### Hub HTML
- Fetch `http://localhost:3099/column/` DOM after each scenario.
- Visible articles appear in index; hidden ones do not.
- Ordering matches `published_at DESC` (per spec 05).

### Related-block HTML
- For each article A, fetch `http://localhost:3099/column/<A.slug>`, parse the related-articles block, assert every linked slug is currently `visible=true` in DB.

### Invariants (checked continuously)
- No article outside `monkey-` namespace ever appears in `ftpMock.getUploads()`.
- No HTTP request from the test process goes to `harmony-mc.com` or the prod Supabase host (Playwright `route` interceptor blocks+fails the test if it sees either hostname).

---

## 6. Isolation Summary — How We Guarantee the 45 Articles Are Not Touched

1. **Dev Supabase project only** — refuse-to-start guards on prod URL.
2. **FTP mock** — real FTP module is module-aliased out; additionally `DRY_RUN=true` no-ops the real module if it somehow loads.
3. **`monkey-` slug namespace** — fixtures, assertions, and a pre-flight check that dev DB has zero non-monkey rows.
4. **Hostname interceptor** — Playwright fails the test instantly on any request to `harmony-mc.com` or the prod Supabase hostname.
5. **Pre-flight assertion** — before the first click, the harness snapshots the row count of non-monkey articles; after the last click, re-asserts equality. Any drift fails the suite loudly.

All five must pass `beforeAll` or the suite aborts with exit code 2 (distinct from ordinary test failure exit 1).

---

## 7. Run / CI Wiring (plan)

- `npm run test:monkey` — headless, seed=CI build number, 200 actions.
- `npm run test:monkey:long` — 2000 actions, nightly.
- Artifacts uploaded: Playwright trace, `fake-ftp/` tree, DB snapshot JSON before/after.
- Flake policy: re-run once with the same seed; if still red, fail.

---

## 8. Out of Scope (for this doc)

- Visual regression of the hub (covered by spec 05 tests).
- Load/perf testing.
- Auth/RBAC fuzzing (separate spec).
- Real FTP smoke test — done manually against a staging subdirectory, not in monkey.
