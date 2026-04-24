# 13. "Stuck Display" Bug — Root-Cause Hypotheses

Context
-------
User report (2026-04-19): 「表示がされっぱなしになっていたり、表示されないままになっていたりする」
Two failure modes, both seen in the wild:

- **A. Stuck-visible** — an article keeps appearing on the live hub / article URL even
  after the operator un-reviewed it, un-published it, or deleted it.
- **B. Stuck-invisible** — an article that is `status='published' AND reviewed_at IS NOT NULL`
  in the database never shows up on the live hub, or shows up on some sub-page but not others.

This document traces the code paths (read-only), lists the untracked `scripts/fix-*.ts`
salvage tools as evidence of past incidents, and enumerates concrete hypotheses. It does
**not** propose the final fix; it enumerates the bugs that the upcoming single-button
design must close.

---

Canonical publication gate (reminder)
-------------------------------------
`src/lib/generators/hub-generator.ts:427-432` — `buildArticleCards()`:

```ts
.from('articles')
.select(...)
.eq('status', 'published')        // gate #1
.not('reviewed_at', 'is', null)   // gate #2
.order('published_at', ...)
```

Every hub-rendering route (`/api/hub/rebuild`, `/api/hub/deploy`) goes through this.
`/api/articles/:id/deploy` additionally enforces a 422 short-circuit when
`reviewed_at` is null (`src/app/api/articles/[id]/deploy/route.ts:42-47`).

**But**: the hub gate only controls what the *hub* listing shows. Individual per-article
HTML files already uploaded to `/public_html/column/columns/<slug>/index.html` are
**never deleted** anywhere in the codebase (see `ftp-uploader.ts` — no `remove()` /
`unlink` calls; same for `/api/articles/:id/deploy/route.ts`). The two gates therefore
interact with stale FTP artifacts in surprising ways. That is the core of variant A.

---

Evidence from untracked salvage scripts (git-status)
----------------------------------------------------
Each of these untracked scripts is a forensic marker of a past incident. They are
itemized here because each one hints at a distinct class of drift:

| Script | What it implies |
|---|---|
| `scripts/fix-all-articles.ts` | Bulk sanitizer that rewrites `stage3_final_html` for every `status='published'` row (no `reviewed_at` filter) and patches `out/column/<slug>/index.html`. Implies that DB content and static FTP copy have diverged repeatedly. |
| `scripts/fix-remaining-5.ts` | Per-slug hardcoded repair of 5 articles with truncated CTAs / disclaimers / FAQs. Confirms Gemini generations occasionally produce truncated HTML that passes to FTP unnoticed. |
| `scripts/fix-broken-links.ts` | Walks `out/column/*/index.html` and strips `<a href="../<slug>/index.html">` whose target directory does not exist locally. Direct evidence that related-articles cross-links get stale when a sibling article is later removed/un-reviewed. |
| `scripts/regenerate-failed-articles.ts` | List of 17 slugs that "failed" quality; they were re-run through stage2/CTA/TOC but there is no record of the corresponding FTP redeploy being automated. |
| `scripts/redeploy-affected.ts` | Sanitizes 5 specific slugs' DB HTML + `out/` files, then prints "Re-deploy these articles via the dashboard". Implies a recurring pattern where DB gets fixed but the public site does not follow unless an operator manually re-clicks. |
| `scripts/recover-article-10.ts` | Recovers article #10 (`spiritual-healing-pet-loss`) after Claude "accidentally overwrote" it. Proves that direct DB updates bypass the revision flow and that the FTP copy can be hours out of date. |
| `scripts/regenerate-all-html.ts` | Queries `status='published'` only (**does not filter `reviewed_at`**), writes regenerated HTML locally. If this output is later pushed, it can resurrect articles that the operator had un-reviewed. |
| `scripts/ftp-deploy-all.ts`, `scripts/ftp-redeploy-affected.ts` | Ad-hoc push tools; bypass the review gate entirely. |

Taken together, these scripts show the team routinely falling back to the DB+FTP
parallel-state model because the UI workflow cannot guarantee the two stay in sync.

---

## Hypothesis 1 — Un-review / un-publish leaves FTP orphan (variant A, stuck-visible)
### Scenario
Operator un-ticks 「確認済み」 on a published article (or flips status back to `editing`).
The hub regenerates and the card disappears from `/public_html/column/columns/index.html`,
but the article's own HTML at `/public_html/column/columns/<slug>/index.html` is never
removed. Anyone with a bookmark, Google cache, or inbound link still sees the article
unchanged. Sitemap-based crawlers also keep re-hitting it because the URL still resolves.

### Reproduction path
1. DB: article with `status='published'`, `reviewed_at=timestamp`, already deployed.
2. List-page checkbox → PUT `/api/articles/:id` with `{ reviewed_at: null }` (src/app/(dashboard)/dashboard/articles/page.tsx:652–658).
3. Fire-and-forget `POST /api/hub/deploy` (src/app/(dashboard)/dashboard/articles/page.tsx:668).
4. `buildArticleCards` now excludes the article (gate #2 fails), hub `index.html` is
   re-uploaded without the card.
5. **No FTP `remove()` is ever issued against `<slug>/index.html`.**

### Evidence in the code
- `src/lib/deploy/ftp-uploader.ts` — only `uploadFrom` / `ensureDir`; **no deletion primitives**.
- `src/app/api/articles/[id]/deploy/route.ts` — only uploads, never cleans up stale slugs.
- `src/app/api/articles/[id]/route.ts:109-138` — `DELETE /api/articles/:id` deletes the
  DB row via `deleteArticle`, but does **not** call any FTP cleanup. Row is gone from
  DB; orphan HTML remains served.
- `src/lib/db/articles.ts:288-299` — `deleteArticle` is a plain `supabase.delete()` —
  no side effect on storage / FTP.

### Required fix (to be designed, not in scope here)
Single-button design must (a) keep a DB-side `intended_on_site` flag, (b) reconcile by
issuing explicit FTP deletions for any slug that is present remotely but absent from
the gated query. Needs a "remote snapshot" table or a list-directory check.

---

## Hypothesis 2 — Transition-to-published triggers `/api/hub/rebuild` (no FTP), not `/api/hub/deploy` (variant B, stuck-invisible)
### Scenario
Operator promotes `editing → published` via the normal UI flow. DB flips to `published`,
the transition route kicks off `/api/hub/rebuild` in the background. That endpoint only
generates HTML in-memory and returns file-paths; it **never uploads to FTP**. If the
operator does not separately click "ハブをデプロイ" or `/api/articles/:id/deploy`, the
article is in the DB as `published + reviewed_at=…` but the live hub page is still the
version from the previous deploy → invisible to users.

### Reproduction path
1. Article finishes editing; operator toggles 確認 and clicks 公開へ.
2. `POST /api/articles/:id/transition` with `status=published`.
3. Route runs `transitionArticleStatus(…)` → DB updated (`src/app/api/articles/[id]/transition/route.ts:104`).
4. Background `fetch(${appUrl}/api/hub/rebuild, { method: 'POST' })` (line 115).
5. `/api/hub/rebuild` builds pages in memory, returns JSON, **exits without FTP upload**
   (`src/app/api/hub/rebuild/route.ts:20-72` — no call to `uploadToFtp`).
6. Operator sees "公開しました" and leaves. Live site = unchanged.

### Evidence in the code
- `src/app/api/hub/rebuild/route.ts` — imports `buildArticleCards`, `generateAllHubPages`;
  **no import of `uploadToFtp` / `getFtpConfig`**.
- `src/app/api/hub/deploy/route.ts` is a separate endpoint that *does* upload, but
  transition/route.ts never calls it.
- `src/app/api/articles/[id]/deploy/route.ts:114-118` calls the deploy endpoint only
  for the article-level deploy button; promoting status alone does not.
- The Article detail page 確認 toggle (`src/app/(dashboard)/dashboard/articles/[id]/page.tsx:602-624`)
  per doc 05 §3b also does not trigger any hub rebuild — same invisible-promote risk.

### Required fix
Either (a) make transition-to-published call `/api/hub/deploy` (not `/api/hub/rebuild`)
and await result before returning success, or (b) collapse transition + hub-deploy into
one atomic action behind the single button.

---

## Hypothesis 3 — Fire-and-forget hub deploy swallowed by Vercel (variant B, stuck-invisible)
### Scenario
`/api/articles/:id/deploy` fires `fetch('/api/hub/deploy')` and returns immediately
without awaiting the result (see `deploy/route.ts:114-118`). Similarly the list-page
checkbox does `fetch('/api/hub/deploy').catch(() => {})` (articles/page.tsx:668).
On Vercel, a serverless function that has already returned a response is frozen; any
unfinished `fetch` started inside it can be killed before the receiving lambda even
warms up. `maxDuration=120` on the target won't save you if the *caller* lambda is
already gone. Result: DB says "reviewed, published", but hub HTML on FTP is stale.

### Reproduction path
1. Operator clicks checkbox on list page.
2. PUT succeeds, DB updated.
3. Background `fetch('/api/hub/deploy', { method: 'POST' })` fires.
4. React unmounts or user navigates → parent request's execution context may be
   reclaimed before the POST resolves.
5. `/api/hub/deploy` lambda never receives the call (or starts but dies before FTP
   `uploadFrom` flushes).
6. Logger line 96 `FTPアップロード一部エラー` only records partial errors; outright
   cancellation has no log line at all.

### Evidence in the code
- `src/app/(dashboard)/dashboard/articles/page.tsx:668` — `.catch(() => {})` actively
  swallows errors. No user-facing toast on failure.
- `src/app/api/articles/[id]/deploy/route.ts:115-118` — same pattern, only a
  `logger.warn` on error, never bubbled to operator.
- `src/app/api/articles/[id]/transition/route.ts:115-128` — `fetch(…)` with `.catch`
  only, no `await`.
- `FTP_HOST` / `FTP_USER` resolution in `getFtpConfig` does two async lookups (DB
  settings, then env) — adds latency that can exceed the lambda budget.

### Required fix
Caller must `await` the hub deploy and surface the result to the UI. Single-button
design should treat "deploy" as a foreground operation (loading spinner + error
banner), not a background effect.

---

## Hypothesis 4 — `scripts/regenerate-all-html.ts` + `ftp-deploy-all.ts` ignore `reviewed_at` (variant A, stuck-visible)
### Scenario
A maintenance script queries `status='published'` only (no `reviewed_at` filter),
regenerates HTML, writes to `out/column/<slug>/`, and a subsequent bulk FTP push
uploads whatever is in `out/`. Any article that was `published` but *un-reviewed*
(by intent) gets re-uploaded, resurrecting it even though the hub page itself
correctly excludes it. Worse, `scripts/fix-all-articles.ts` runs the same query and
*writes the DB* — which means even the DB copy of un-reviewed articles gets
regenerated content.

### Reproduction path
1. Op A un-ticks 確認 on article X (to hide it) — hub re-deploys without the card,
   but `<slug>/index.html` stays on FTP (see Hypothesis 1).
2. Days later, op B runs `npx tsx scripts/regenerate-all-html.ts` followed by one of
   the bulk FTP scripts.
3. Script pulls every `status='published'` row — X included.
4. X's `<slug>/index.html` gets overwritten with fresh content. URL is still live.
5. If a related-articles recalculation follows, other published-but-not-reviewed
   articles start pointing at X's URL again.

### Evidence in the code
- `scripts/regenerate-all-html.ts:30-35` — `.eq('status', 'published')` with no
  `.not('reviewed_at', 'is', null)`.
- `scripts/fix-all-articles.ts:78-82` — same, and then updates DB.
- `scripts/regenerate-failed-articles.ts:15-33` — hardcoded slug list, no
  `reviewed_at` check.
- `src/lib/publish/auto-related.ts:39-47` — `fetchPublishedArticleCards` likewise
  filters only on `status='published'`. So `computeAndSaveRelatedArticles` can
  insert links pointing at articles the user has un-reviewed.

### Required fix
Unify the "what is live" predicate in one exported helper (e.g. `isLivePublished(row)`
or a DB view) and route every script, every hub query, every related-articles
calculation through it. After the single-button redesign, `reviewed_at` may be
merged with `status` — in which case the helper still exists as the one place to
change.

---

## Hypothesis 5 — Silent per-file FTP failure inside `uploadToFtp` (both variants)
### Scenario
`uploadToFtp` (`ftp-uploader.ts:153-194`) wraps each file upload in its own try/catch,
pushes the error message into `errors[]`, and then returns `{ success: errors.length === 0, uploaded, errors }`. The caller (`/api/hub/deploy/route.ts:95-99`) logs a warning
on partial failure but still returns `success: result.success` + HTTP 200. If the
**hub `index.html` succeeds** but a **per-page `page/N/index.html` fails**, the hub
root looks fine while pagination pages are stale — articles on those pages appear
missing (variant B) or articles removed from those pages persist (variant A). Same
goes if a single article's image upload fails but the HTML succeeds — article loads
with a broken hero image, which users perceive as "表示されない".

### Reproduction path
1. 5-minute FTP session times out mid-batch (common when 45 articles × 4 images each
   are pushed in one session).
2. `uploadFile` throws on the 23rd file; loop continues.
3. `errors` contains one line; `uploaded` is 22.
4. Response JSON returns 200, `success: false`, but the list-page's `.catch(() => {})`
   swallows it.

### Evidence in the code
- `src/lib/deploy/ftp-uploader.ts:173-181` — per-file try/catch, accumulates but
  does not reopen the connection on failure.
- No retry logic anywhere. `basic-ftp` disconnects are fatal.
- `src/app/api/articles/[id]/deploy/route.ts:125-177` uses a *direct* `new Client()`
  inline, not `uploadToFtp`. That path has **no error collection at all** —
  `await client.uploadFrom(...)` throws kill the whole route (500), but if an image
  upload fails inside the loop it silently skips via outer `try/catch` on line 168
  and only pushes a string into `errors[]` that is returned but never displayed.

### Required fix
(a) Upload in a single transactional batch per article; (b) retry failed files up to
3 times with fresh connection; (c) bubble partial failure to the UI (status badge =
"部分デプロイ失敗" or similar) rather than a silent toast.

---

## Summary — where the single-button design must close the loop

| Gap | Current behavior | Required |
|---|---|---|
| G1 | Un-review does not delete FTP artifacts (H1) | Explicit remote-deletion step |
| G2 | Transition-to-published calls rebuild, not deploy (H2) | Call deploy; await |
| G3 | Fire-and-forget deploys silently fail on Vercel (H3) | Foreground await + UI feedback |
| G4 | Scripts + related-articles ignore `reviewed_at` (H4) | Single `isLive` predicate |
| G5 | Partial FTP failures swallowed (H5) | Retry + surface errors |

All five must be addressed for the new single-button to make the display state
*deterministic*; otherwise the user will continue to see either mode of the bug.
