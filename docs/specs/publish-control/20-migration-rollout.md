# 20. Migration & Rollout Plan — 確認 Checkbox → Single Confirm Button

Date: 2026-04-19
Status: PLAN ONLY — no code or data changes during authoring of this document.
Scope: the migration path that swaps the `確認` column checkbox on
`/dashboard/articles` for a single-button confirm/publish system, without
touching any of the existing **45 articles** already in production.

Prior art in this spec folder:
- `03-confirm-checkbox-behavior.md` — current checkbox semantics
- `04-publish-api-endpoints.md` — API surface that will be extended
- `05-hub-page-generation.md` — downstream hub rebuild pipeline
- `10-revision-system.md` — audit trail contract any HTML-touching step must honor

This doc answers one question per section:
- §0 What must be true **before** we cut the first line of code?
- §1 In what order do the 7 migration steps run, and what is the rollback for each?
- §2 What are the blast-radius risks and their mitigations?
- §3 What **mechanical guardrail** prevents this session (or any implementation
  session) from writing to existing articles while the spec is still active?

---

## 0. Pre-implementation checklist

All of these must be green before Step 1 begins. Treat this list as a PR
description template — the implementer checks each box in the PR body.

### 0.1 Branch hygiene
- [ ] Cut a new branch off `develop`: `feat/publish-control-single-button`.
- [ ] `main` and `develop` are both clean (no uncommitted files that touch
      `src/app/(dashboard)/dashboard/articles/**` or `src/lib/generators/**`).
- [ ] Open a draft PR immediately so CI runs from commit #1 (required for the
      guardrail in §3 to fire on every push).

### 0.2 Feature flag registered
- [ ] Add a single flag `PUBLISH_CONTROL_V2` (env-var backed) with three values:
  - `off` — old checkbox only (default on all environments until Step 6)
  - `shadow` — new API reachable, new UI hidden, old UI authoritative
  - `on` — new UI authoritative, old UI hidden but still deletable
- [ ] Flag reader lives at `src/lib/flags/publish-control.ts` (new file). The
      reader **must** be pure and synchronous; no network, no DB.
- [ ] Every new code path added in Steps 1–3 reads the flag at the **entry
      point** (API route handler top, React component top). No branching deeper
      in the call graph — that makes rollback harder to reason about.

### 0.3 Local dev env
- [ ] `.env.local` has `PUBLISH_CONTROL_V2=off` committed to an example file
      (`.env.example`) and set to `shadow` locally for the implementer.
- [ ] `npm run dev` boots cleanly with flag `off` — proves default behavior
      is unchanged.
- [ ] `npm run test` passes on a fresh clone of the branch.

### 0.4 Test Supabase project (NOT prod)
- [ ] A **separate** Supabase project is provisioned (`harmony-column-staging`)
      with a `articles` table whose schema matches prod.
- [ ] Seeded with a **synthetic copy** of 3 articles cloned from prod (with
      regenerated UUIDs and slugs `staging-test-{1,2,3}`) — never a raw copy.
- [ ] The staging Supabase URL/key are stored in `.env.staging` and are the
      ONLY credentials the implementer has during Steps 1–5.
- [ ] Prod Supabase service-role key is **removed** from the implementer's
      `.env.local` during this work (verified by §3.1 guardrail).

### 0.5 FTP credentials
- [ ] Staging FTP target is a disposable subdirectory
      (`/public_html/_staging_publish_control/`) — never
      `/public_html/column/columns/`.
- [ ] `FTP_REMOTE_BASE_PATH` env var points at the staging subdir in
      `.env.staging`. A unit test asserts this path does not equal the prod
      path (see §3.3).

### 0.6 Backup snapshot
- [ ] Before Step 1 merges, take a Supabase point-in-time backup tag
      `pre-publish-control-v2-YYYYMMDD` and a one-time `pg_dump` of the
      `articles` and `article_revisions` tables stored in
      `backups/pre-publish-control-v2/`.
- [ ] FTP snapshot: `column/columns/` tarballed and stored alongside the DB
      dump.

---

## 1. Migration steps (in order)

Each step is a separate PR. No step may be merged until its rollback has been
rehearsed (at minimum, written down and reviewed).

### Step 1 — Add new API endpoint (no UI change)

**What:** ship `POST /api/articles/:id/publish` and
`POST /api/articles/:id/unpublish`. These call a new service function
`setHubVisibility(articleId, visible, actor)` that (a) writes
`is_hub_visible`, (b) writes an `article_revisions` row per §10 rules, and
(c) schedules a hub rebuild.

**Flag gating:** both endpoints return `404` when `PUBLISH_CONTROL_V2=off`.
This is intentional — we want the URL space reserved but dead.

**Exit criteria:**
- Endpoints return `404` on prod (flag is `off`).
- Endpoints return `200` on staging with flag `shadow` against the 3 seeded
  staging articles.
- Integration test covers 404-when-off.

**Rollback:**
- Revert the PR. No data migration happened, no old code was deleted.
- The endpoint had no callers in prod (flag was `off` → 404), so there are
  no broken clients.

---

### Step 2 — Back-fill `is_hub_visible` column

**What:** one migration file
`supabase/migrations/YYYYMMDDHHMMSS_add_is_hub_visible.sql` that:

```sql
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS is_hub_visible BOOLEAN NOT NULL DEFAULT false;

-- Back-fill: an article is hub-visible today iff it was already on the hub.
-- The current hub inclusion rule (per 05-hub-page-generation.md §2) is
-- published_at IS NOT NULL AND stage3_final_html IS NOT NULL.
UPDATE articles
   SET is_hub_visible = true
 WHERE published_at IS NOT NULL
   AND stage3_final_html IS NOT NULL;
```

Critically: this UPDATE **does not** modify `stage2_body_html`,
`stage3_final_html`, `reviewed_at`, `published_at`, or any field that the hub
generator reads for rendering. Only `is_hub_visible` is written. Per §3.2
this must be the ONLY write authorized during Step 2.

**Exit criteria:**
- `SELECT COUNT(*) FROM articles WHERE is_hub_visible = true` equals the
  number of articles currently rendered on
  `https://harmony-mc.com/column/` (expected: the full set of the 45 that
  are currently on the hub).
- A follow-up `SELECT pg_relation_size('article_revisions')` shows no
  growth (this migration must NOT write revisions — see risk §2.3).
- Schema change is reviewed against `src/lib/validators/article.ts` — the
  validator allowlist is **not** updated yet, so the new column is still
  read-only from the API perspective.

**Rollback:**
- `ALTER TABLE articles DROP COLUMN is_hub_visible;` — safe because no code
  reads the column yet (the Step 1 endpoint is still 404 in prod).
- Restore from the §0.6 Supabase snapshot if anything looked wrong in the
  COUNT check above.

---

### Step 3 — Ship new UI behind the feature flag

**What:** replace the `確認` column in
`src/app/(dashboard)/dashboard/articles/page.tsx` with a
`<PublishButton article={a} />` component, mounted **only when** the flag
reader returns `shadow` or `on`. When the flag returns `off`, the old
checkbox column renders unchanged.

**Flag gating:** component-level branch at the top of the page component:

```tsx
const flag = usePublishControlFlag();
const cols = flag === 'off' ? LEGACY_COLUMNS : V2_COLUMNS;
```

No other files change. The old checkbox code stays on disk — deletion is
Step 7.

**Exit criteria:**
- On prod (flag `off`): visual regression test shows zero pixel diff vs.
  `main`.
- On staging (flag `shadow`): the new button renders, clicks are disabled
  or shadow-only (see Step 4).

**Rollback:**
- Flip the env var to `off` (no redeploy required if the flag reader reads
  env on every request; if it caches, a single Vercel redeploy is needed).
- If the code itself is broken, revert the PR — old checkbox is untouched
  and becomes authoritative again.

---

### Step 4 — Shadow test in staging against real 45 articles' metadata (READ-ONLY)

**What:** point the staging Supabase project at a **read replica** of the
prod articles table, OR import a CSV dump of prod metadata (title, slug,
theme, published_at, is_hub_visible computed per Step 2 rule) into
`harmony-column-staging.articles`. No `stage2_body_html` or
`stage3_final_html` is copied — only the columns the new UI needs to
render the list. This prevents the staging env from ever being able to
deploy real article bodies.

Flag on staging is `shadow`. The new PublishButton:
- Logs what it **would** do (publish / unpublish) to
  `console.info` and a staging-only table `shadow_publish_log`.
- Does NOT call `POST /api/articles/:id/publish`. The button's onClick is
  intercepted; the real fetch is replaced by a log write.

**Exit criteria:**
- For all 45 imported rows, clicking "unpublish" then "publish" produces
  the expected log entry.
- Sampling 10 random rows, the button's rendered state matches the
  current hub's inclusion of that article (verified manually by loading
  `harmony-mc.com/column/` and searching for the slug).
- Zero writes to the prod DB during the entire shadow window (verified by
  the prod audit log — see §3.4).

**Rollback:**
- Shadow test is pure read + log. Rollback = turn off staging.
- If the comparison in the second exit criterion fails, **do not** proceed
  to Step 5. File a bug against Step 2's back-fill rule and rerun.

---

### Step 5 — Monkey tests

**What:** on staging (flag `shadow` → flip to `on` against the **synthetic**
3-article set, not the 45-row imported metadata), run a headless script
that rapidly:
- toggles publish/unpublish 200× on each article
- double-clicks the button (race condition)
- publishes an article with a 500ms network stall injected
- calls the API directly with malformed bodies
- calls the API with a valid body but a stale `updated_at` (optimistic
  concurrency check)

**Exit criteria:**
- `article_revisions` for the 3 synthetic articles grows by **at most**
  one row per real state change (see risk §2.3).
- No hub rebuild is triggered more than once per quiet window of 5s
  (debouncing contract from `05-hub-page-generation.md`).
- No row in `articles` was modified outside the intended
  `is_hub_visible` + `updated_at` columns (diff-check via `pg_dump`
  before/after).

**Rollback:**
- Truncate the 3 synthetic articles and re-seed from the staging fixture.
- Disable the flag on staging.

---

### Step 6 — Flip feature flag on (prod)

**What:** set `PUBLISH_CONTROL_V2=on` in Vercel prod env. The new button
becomes authoritative. The old checkbox column is hidden by the flag
branch in Step 3 but its code still exists on disk.

**Order of operations inside Step 6 (atomic — do NOT split):**
1. Announce a 30-minute freeze window on the dashboard (banner via
   feature-flag config).
2. Take a fresh Supabase snapshot `post-step-6-pre-flip-YYYYMMDD`.
3. Flip env var.
4. Hit the dashboard as an authenticated user; publish and unpublish ONE
   test article that was specifically created for this flip (slug
   `flip-test-YYYYMMDD`, not one of the 45).
5. Verify the hub picks it up / drops it within 60s.
6. Delete the test article.
7. Lift the freeze banner.

**Exit criteria:**
- The test article round-trip succeeded.
- The 45 existing articles are untouched (verified by
  `SELECT id, updated_at FROM articles WHERE id IN (<the 45>)` before and
  after the flip — `updated_at` must be identical).

**Rollback:**
- Single env-var flip back to `off` (or `shadow`). Because Step 3 kept the
  old checkbox code on disk and behind the same flag, flipping the env
  var immediately restores the old UI.
- If the DB looks corrupted (the 45 `updated_at` check fails), restore
  from `post-step-6-pre-flip` snapshot and revert Steps 1–3.

---

### Step 7 — Remove old 確認 checkbox code after N days

**N = 14 days** minimum. Recommend 30 days for safety given the user's
regression sensitivity (per MEMORY).

**What:** delete:
- The checkbox `<td>` in `articles/page.tsx` (the `LEGACY_COLUMNS` branch).
- The detail-page "由起子さん確認" button in
  `articles/[id]/page.tsx` if it is no longer the only way to set
  `reviewed_at` (check first — this spec does NOT assume that button also
  migrates).
- The `PUBLISH_CONTROL_V2 === 'off'` branch in the flag reader. The flag
  itself stays in code but has only `shadow` and `on` values, allowing a
  last-minute shadow re-enable.
- The legacy `POST /api/hub/deploy` fire-and-forget inside the checkbox
  onChange handler (removed together with the checkbox).

**Critically NOT deleted:**
- The `reviewed_at` / `reviewed_by` DB columns — they carry historical
  data and are independent of the publish toggle.
- The `article_revisions` rows written during Steps 1–6.

**Exit criteria:**
- `grep -r "reviewed_at" src/app/\(dashboard\)/dashboard/articles/` returns
  zero occurrences (the checkbox is fully gone from the UI).
- All tests pass.

**Rollback:**
- `git revert` the deletion PR. Because the flag reader still supports
  `shadow`, the old checkbox can be brought back by reverting Step 3 as
  well (two-revert rollback).

---

## 2. Risks and mitigations

### 2.1 Accidental mass-unpublish

**Risk:** a buggy `UPDATE articles SET is_hub_visible = false WHERE ...`
with a wrong WHERE clause (or missing WHERE) empties the hub.

**Mitigations:**
- The Step 2 migration UPDATE is the ONLY DB write authorized before Step 6.
  Any other UPDATE issued during Steps 1–5 is a guardrail violation (§3.2).
- Add a DB-level trigger for Steps 1–5:
  ```sql
  CREATE OR REPLACE FUNCTION reject_mass_unpublish()
  RETURNS TRIGGER AS $$
  BEGIN
    IF (SELECT COUNT(*) FROM articles WHERE is_hub_visible = false) > 5
       AND TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'mass-unpublish guard: >5 rows would become hidden';
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;
  ```
  Install on staging from Step 2 onward. Remove at Step 6.
- The new endpoint is strictly single-article (takes `:id`, never a bulk
  payload). No batch publish/unpublish endpoint is added in this migration.

### 2.2 FTP bulk-delete

**Risk:** the hub rebuild pipeline (`05-hub-page-generation.md` §5) uploads
pages by `remoteBasePath`. A misconfigured path could overwrite or delete
the wrong directory.

**Mitigations:**
- `FTP_REMOTE_BASE_PATH` is read from env, and a startup assertion refuses
  to boot if the value matches a blacklist: `/`, `/public_html`,
  `/public_html/`, `/public_html/column`, and any path shorter than
  `/public_html/column/columns/`.
- The ftp-uploader in Steps 1–5 uploads to the staging subdir only (see
  §0.5). Prod-path uploads only happen after Step 6.
- Uploader never issues recursive `RMD` / `DELE` during the publish flow.
  Verify with a grep in the Step 1 PR review:
  `grep -n "rmdir\|removeDir\|remove" src/lib/deploy/`.

### 2.3 `article_revisions` filling up

**Risk:** every publish/unpublish toggle writes a revision row. A user who
rapidly toggles 20× creates 20 rows, multiplied across 45 articles.

**Mitigations:**
- The `setHubVisibility` service de-duplicates: if the current
  `is_hub_visible` value already equals the requested value, no revision
  row is written and no hub rebuild is scheduled.
- Monkey tests (Step 5) measure revision growth against real state
  changes; exit criterion is "at most one row per real state change".
- The `article_revisions` retention policy of "current + 3" already
  in place (per MEMORY) applies to HTML-touching revisions. Add a
  separate `change_type = 'visibility_toggle'` value that is excluded
  from the "keep 4" limit and instead retained indefinitely (these rows
  are small — they carry no `html_snapshot`).
  - Explicitly: for `visibility_toggle` rows, `html_snapshot` is `NULL`
    (or an empty marker) and `comment` holds
    `{ "from": false, "to": true }`. This needs a schema tweak to allow
    `html_snapshot` NULL — out of scope for this doc; tracked in a
    follow-up spec.

### 2.4 Stale read on the hub

**Risk:** user publishes article, hub rebuild is queued, but the user
reloads `harmony-mc.com/column/` before the FTP upload finishes and
assumes the system is broken.

**Mitigations:**
- UI shows a pending state on the PublishButton until the rebuild returns
  `200`.
- Eventual-consistency disclaimer in the button tooltip.

---

## 3. Guardrails: "never modify existing articles this session"

The user's core constraint: **while this spec is being authored and during
any implementation that happens in the same session, the 45 prod articles
must not be written to**. Below are layered mechanical checks, not
conventions.

### 3.1 Env-flag guardrail (session-scoped)

Add to the repo root a file `.claude/session-guard.json`:

```json
{
  "forbid_prod_supabase": true,
  "forbid_prod_ftp": true,
  "allowed_envs": ["staging", "local"],
  "reason": "publish-control spec session — 45 articles must remain untouched"
}
```

A pre-push git hook (`.githooks/pre-push`, registered via
`core.hooksPath`) reads this file and:
1. Greps staged changes for strings matching
   `SUPABASE_URL=.*(?!staging)` (prod URL pattern) and
   `FTP_REMOTE_BASE_PATH=/public_html/column/columns/?` — rejects the push
   if found.
2. Greps staged SQL migrations for `UPDATE articles SET` or
   `DELETE FROM articles` — rejects the push if the migration does not
   also contain a comment `-- guard-approved: <reason>`.

This guardrail is **not** just a nicety — it is the primary mechanical
defense against a script (or Claude) writing to prod during Steps 1–5.

### 3.2 CI check: no writes to `articles` in Steps 1–5

A GitHub Action `.github/workflows/no-article-writes.yml` runs on every
push to `feat/publish-control-*`:

```yaml
- name: Reject writes to articles table
  run: |
    BAD=$(grep -rn --include='*.ts' --include='*.sql' \
      -E "\.update\(|\.delete\(|UPDATE articles|DELETE FROM articles" \
      src/ supabase/migrations/ | \
      grep -v "is_hub_visible" | \
      grep -v "// guard-approved:" || true)
    if [ -n "$BAD" ]; then
      echo "::error::Write to articles detected without is_hub_visible scope:"
      echo "$BAD"
      exit 1
    fi
```

The only permitted writes during Steps 1–5 are ones that touch
`is_hub_visible` and nothing else. This rule is mechanical: `grep -v
is_hub_visible` catches anyone who adds a broader UPDATE by accident.

The rule is lifted for Step 6 (the flip) and Step 7 (the deletion), which
happen on a different branch.

### 3.3 FTP path assertion (runtime)

In `src/lib/deploy/ftp-uploader.ts`, add a module-level assert that runs
before the first upload:

```ts
const base = process.env.FTP_REMOTE_BASE_PATH ?? '';
if (process.env.PUBLISH_CONTROL_V2 !== 'on' &&
    base.startsWith('/public_html/column/columns')) {
  throw new Error(
    'FTP guard: cannot upload to prod hub path while PUBLISH_CONTROL_V2 != on'
  );
}
```

This ensures Steps 1–5 cannot accidentally overwrite the prod hub even if
someone copies prod FTP creds into `.env.local`.

### 3.4 Prod DB audit-log watcher (observability, not enforcement)

Enable Supabase's built-in `pgaudit` (or Supabase dashboard query logs)
on the prod project for the duration of this work. Implementer subscribes
to a daily digest. Any `UPDATE articles` row in the log during Steps 1–5
triggers a manual investigation before Step 6 proceeds.

### 3.5 "Strongest" guardrail summary

If only one of the above is implemented, it must be **§3.2 — the CI check
on `no-article-writes.yml`**. It is the only guardrail that runs
automatically on every push, cannot be bypassed by flipping an env var,
and rejects code at review time rather than at runtime. The session-guard
file (§3.1) can be deleted by a careless `rm`; the FTP runtime assert
(§3.3) only fires after code is deployed; the audit watcher (§3.4) is
post-hoc. The CI check is pre-merge and mechanical.

---

## 4. Go/No-go gates between steps

| Transition | Gate |
|---|---|
| Step 1 → Step 2 | New endpoint returns 404 on prod (flag off) verified by curl. |
| Step 2 → Step 3 | `is_hub_visible` count matches live hub inclusion count. |
| Step 3 → Step 4 | Visual regression diff = 0 on prod dashboard. |
| Step 4 → Step 5 | Shadow log matches expected state for all 45 rows. |
| Step 5 → Step 6 | Monkey test report attached to the PR; `article_revisions` growth within bound. |
| Step 6 → Step 7 | 14 days elapsed with no support tickets mentioning the hub. |

Any failing gate pauses the rollout. Reverting is always an option — the
feature flag makes every step independently reversible.

---

## 5. Out of scope for this document

- The visual design of the new PublishButton — see `30-ui-design.md` (not
  yet authored).
- The contract of `POST /api/articles/:id/publish` — see
  `04-publish-api-endpoints.md`.
- The `reviewed_at` column's future (it survives this migration
  unchanged).
- Any change to the 1,499 source aMbblog records — this migration is
  purely dashboard + hub, not ingest.
