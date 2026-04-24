# 04. Publish-Control API Endpoints Inventory

**Status:** Investigation snapshot (read-only analysis)
**Date:** 2026-04-19
**Scope:** All API routes under `src/app/api/` that can mutate an article's
publish / visibility state, trigger a hub-rebuild, or push files to FTP.

---

## 0. TL;DR Summary Table

| Endpoint | Method | writes_db | writes_ftp | rebuilds_hub | touches_related | creates_revision |
|---|---|---|---|---|---|---|
| `/api/articles/[id]` | PUT | yes (articles row, incl. `reviewed_at`) | no | **indirectly via checkbox handler** (client fires `/api/hub/deploy` after toggle) | no | **yes** (auto-snapshot when `stage2/3_body_html`, `title`, `meta_description` change) |
| `/api/articles/[id]` | DELETE | yes (deletes articles row) | no | no | no | no |
| `/api/articles/[id]/transition` | POST | yes (`status`, `published_at` on `published`) | no | **yes** (fires `/api/hub/rebuild`, HTML-only) when transitioning to `published` | **yes** (computeAndSaveRelatedArticles + updateAllRelatedArticles when `published`) | no |
| `/api/articles/[id]/deploy` | POST | no (reads only; gated on `reviewed_at`) | **yes** (article `index.html` + `images/*.jpg` per slug) | **yes** (fires `/api/hub/deploy` fire-and-forget) | no | no |
| `/api/articles/[id]/quality-check` | POST | yes (writes `quality_check` JSON if column exists) | no | no | no | no |
| `/api/articles/[id]/revisions/[revisionId]/restore` | POST | yes (overwrites article body from revision + snapshots current) | no | no | no | yes (saves `pre_restore` snapshot) |
| `/api/articles/update-related` | POST | yes (updates `related_articles` JSON on many rows) | no | no | **yes (bulk)** | no |
| `/api/articles/batch-update-cta` | POST | yes (rewrites `stage2_body_html` / `stage3_final_html`) | no | no | no | no (bypasses revision helper) |
| `/api/articles/batch-add-toc` | POST | yes (rewrites body HTML) | no | no | no | no |
| `/api/articles/batch-add-highlights` | POST | yes (rewrites body HTML) | no | no | no | no |
| `/api/hub/deploy` | POST | no | **yes** (hub pages only — `index.html`, category/paginated pages) | **yes** (itself) | no | no |
| `/api/hub/rebuild` | POST | no | no | **yes (in-memory only, no write)** | no | no |
| `/api/ftp/test` | POST | no | no (just lists root) | no | no | no |

`writes_ftp = yes` means the route actually opens an FTP connection and uploads
files. `rebuilds_hub = yes` means the hub HTML is regenerated (either in memory
or via a cascaded call to `/api/hub/deploy`).

---

## 1. `PUT /api/articles/[id]`
**File:** `src/app/api/articles/[id]/route.ts`

- **Body:** `updateArticleSchema` — arbitrary subset of article columns,
  including `reviewed_at: string | null`, `reviewed_by`, titles, body HTML,
  image metadata.
- **Supabase writes:** `articles` row via `updateArticle()` in
  `src/lib/db/articles.ts`. Adds `updated_at`.
- **FTP writes:** none.
- **Hub rebuild:** not from this route. But the **list-page checkbox** that
  toggles `reviewed_at` fires `/api/hub/deploy` right after the PUT
  (`src/app/(dashboard)/dashboard/articles/page.tsx:668`), so in practice
  a reviewed-at toggle does cause a hub FTP push.
- **Related articles:** no.
- **Revision snapshot:** **yes, automatic.** `updateArticle()` inspects whether
  `stage2_body_html`, `stage3_final_html`, `title`, or `meta_description` are
  changing and calls `saveRevision(..., 'auto_snapshot')` before the UPDATE
  (silently swallowed on failure).
- **Error handling:** 400 on zod failure, 404 on missing row, 500 on generic
  throw; no transactional rollback — the revision save is best-effort and the
  update proceeds even if it fails.

## 2. `DELETE /api/articles/[id]`
Same file. Hard-deletes the row via `deleteArticle()`. No revision, no FTP,
no hub rebuild. Row is gone; any deployed `column/<slug>/` files on the host
remain orphaned until the next full hub deploy rewrites the index listing
(which will exclude it because it's no longer in the DB).

## 3. `POST /api/articles/[id]/transition`
**File:** `src/app/api/articles/[id]/transition/route.ts`

- **Body:** `{ status: ArticleStatus }` — one of `draft | outline_pending |
  outline_approved | body_generating | body_review | editing | published`.
- **Pre-flight:** when transitioning to `published`, runs
  `runQualityChecklist()` against `published_html || stage2_body_html`; 422 on
  fail.
- **Supabase writes:** `articles.status`, `updated_at`, and on
  `status='published'` also `published_at=now()`. Uses
  `transitionArticleStatus()` in `src/lib/db/articles.ts`, which validates
  `VALID_TRANSITIONS`.
- **FTP writes:** **no** (common misconception). It only fires
  `/api/hub/rebuild`, which generates HTML **in memory** and does not upload.
- **Hub rebuild:** indirectly — on `published`, fire-and-forget
  `fetch(NEXT_PUBLIC_APP_URL + '/api/hub/rebuild')`. Failures are logged but
  do not roll back the transition.
- **Related articles:** yes — on `published`, kicks off
  `computeAndSaveRelatedArticles(id)` then `updateAllRelatedArticles()`
  (writes `related_articles` JSON to many rows). Fire-and-forget; logged on
  failure; does not roll back the transition.
- **Static export:** also fires `exportArticleToOut(id)` + `exportHubPageToOut()`
  when not on Vercel (local `out/` dir), fire-and-forget.
- **Revision snapshot:** no (status-only change; the content-based auto-snapshot
  in `updateArticle` is bypassed here).
- **Error handling:** 400 on invalid status string or disallowed transition,
  404 on missing article, 422 on quality-check fail, 500 otherwise.

## 4. `POST /api/articles/[id]/deploy`  ← the actual "push to live site" call
**File:** `src/app/api/articles/[id]/deploy/route.ts`

- **Body:** none (article id comes from the URL).
- **Pre-flight gates (all return 422 on fail, no DB/FTP side effects):**
  1. Must have `article.reviewed_at` set (由起子さん確認ゲート).
  2. `runDeployChecklist(html, slug)` — content quality gate.
  3. `runTemplateCheck(html)` — template integrity gate.
- **Supabase writes:** none. It reads the row via service-role client only.
- **FTP writes:** **yes.** Uses `basic-ftp` directly:
  - `<basePath>/<slug>/index.html` — freshly re-generated from
    `generateArticleHtml()` with path-rewriting for static hosting.
  - `<basePath>/<slug>/images/{hero,body,summary}.jpg` — downloaded from
    Supabase Storage URLs listed in `article.image_files`, re-uploaded.
- **Hub rebuild:** **yes.** Fire-and-forget
  `fetch(origin + '/api/hub/deploy', { headers: { cookie } })` **before** the
  article's own FTP upload begins. That means the hub can be rebuilt even if
  the article upload later fails; no rollback.
- **Related articles:** no.
- **Revision snapshot:** no.
- **Error handling:** wraps the `basic-ftp` session in `try/finally` to
  always `client.close()`. Per-image errors are collected into an `errors[]`
  array but the overall response is still 200 with `errors` populated. A
  thrown error at any other point returns 500 with no rollback — partial
  uploads persist on the FTP host.
- **maxDuration:** 120s.

## 5. `POST /api/articles/[id]/quality-check`
**File:** `src/app/api/articles/[id]/quality-check/route.ts`
Runs `runQualityChecklist` and writes the JSON into `articles.quality_check`
(best-effort, catches column-missing errors). Pure pre-publish diagnostic,
no publish state mutation, no FTP, no hub.

## 6. `POST /api/articles/[id]/revisions/[revisionId]/restore`
**File:** `src/app/api/articles/[id]/revisions/[revisionId]/restore/route.ts`
Calls `restoreRevision()` in `src/lib/db/article-revisions.ts`, which
snapshots current state as a new `pre_restore` revision and then writes
back the selected revision's `html_snapshot`/title/meta into the articles
row. **Does not re-deploy** — the live FTP copy and the DB diverge until
`/api/articles/[id]/deploy` (and `/api/hub/deploy`) are called again.

## 7. `POST /api/articles/update-related`  ← "関連記事を一括更新" button
**File:** `src/app/api/articles/update-related/route.ts`
- **Body:** none.
- **Supabase writes:** updates `related_articles` JSON on every published
  article via `updateAllRelatedArticles()`.
- **FTP writes:** none. (The `related_articles` field is only reflected on
  the live site after a subsequent article deploy regenerates its HTML.)
- **Hub rebuild:** no.
- **Revision:** no.
- **maxDuration:** 60s.
- **Called from:** `handleBulkUpdateRelated` in list page (line 276).

## 8. `POST /api/articles/batch-update-cta`
**File:** `src/app/api/articles/batch-update-cta/route.ts`
Rewrites every article's `stage2_body_html` / `stage3_final_html` with the
current CTA settings. Writes `articles` rows via service-role client directly
(bypasses `updateArticle()`, so **no auto revision snapshot**). No FTP, no
hub. `maxDuration: 120`.

## 9. `POST /api/articles/batch-add-toc` & `/api/articles/batch-add-highlights`
Same shape as batch-update-cta: bulk HTML rewrite on `stage2/3_body_html`,
direct service-role update, no revision, no FTP, no hub. Highlights also
syncs `published_html` when `stage2_body_html` is rewritten and the article
already had a `published_html`.

## 10. `POST /api/hub/deploy`  ← "サーバーに更新" button's hub partner
**File:** `src/app/api/hub/deploy/route.ts` (commit `4a89037` unified here).
- **Body:** none.
- **Supabase writes:** none — reads published articles via
  `buildArticleCards()`.
- **FTP writes:** **yes.** Generates every hub page variant
  (`generateAllHubPages`) — root `index.html`, category pages, paginated
  pages — and uploads all of them via `uploadToFtp()`.
- **Hub rebuild:** yes (this is it).
- **Related articles:** no.
- **Revision:** no.
- **Error handling:** per-file errors are returned in the response body but
  the route still returns 200 with `success:false`. A top-level throw
  returns 500.
- **maxDuration:** 120s.
- **Called from:**
  1. List-page `handleBulkDeploy` flow **indirectly** — each article's
     `/api/articles/[id]/deploy` fires `/api/hub/deploy` fire-and-forget.
  2. List-page checkbox toggle for `reviewed_at`
     (`articles/page.tsx:668`) — fire-and-forget after the PUT.
  3. Article-detail deploy button, same chained call.

## 11. `POST /api/hub/rebuild`
**File:** `src/app/api/hub/rebuild/route.ts`
In-memory hub HTML generation only. Returns the list of generated paths in
the JSON response. **Does not FTP, does not write to Supabase.** The only
caller is the transition-to-published flow (route 3).

## 12. `POST /api/ftp/test`
Connection test only; lists the FTP root. No side effects.

---

## "サーバーに更新" button flow (list page)
`handleBulkDeploy` in `src/app/(dashboard)/dashboard/articles/page.tsx:99-140`:

1. `GET /api/articles?status=published&limit=200` — fresh fetch.
2. Filter client-side to `reviewed_at != null`.
3. For each: `POST /api/articles/[id]/deploy`.
4. Each of those in turn fires `POST /api/hub/deploy` fire-and-forget.

So one click triggers N deploys + N (coalesced, fire-and-forget) hub pushes.
There is no transactional guarantee; a mid-loop failure leaves the site in
a mixed state.

## "関連記事を一括更新" button flow
Single call: `POST /api/articles/update-related`. DB-only, no FTP push, so
the live site reflects the new related lists only after the next article
deploy.

## The reviewed_at checkbox flow (current UX being replaced)
`articles/page.tsx:642-671`: local optimistic state → `PUT /api/articles/[id]`
with `{ reviewed_at, reviewed_by }` → fire-and-forget `POST /api/hub/deploy`.
Notable: it pushes the **hub** index but never uploads the article itself;
the article HTML on FTP stays stale until someone hits "サーバーに更新".

---

## Candidate endpoints for the new single-button flow
When replacing the checkbox + "サーバーに更新" pair with one button, the
natural target is **`POST /api/articles/[id]/deploy`** — it is the only
endpoint that (a) enforces the `reviewed_at` gate, (b) uploads the article
itself, and (c) cascades a hub rebuild. To make the single button fully
consistent, it would additionally need to either:

- set `reviewed_at` first via `PUT /api/articles/[id]` (current two-step
  pattern), or
- introduce a new endpoint (e.g. `POST /api/articles/[id]/publish`) that
  sets `reviewed_at`, runs the quality/template gates, uploads to FTP, and
  triggers `/api/hub/deploy` in a single transactional handler — which is
  the cleanest option given that today's deploy route already wraps those
  three concerns.

`POST /api/articles/update-related` and `POST /api/hub/deploy` remain as
explicit bulk buttons for the site-wide refresh case and are not on the
per-article single-button path.
