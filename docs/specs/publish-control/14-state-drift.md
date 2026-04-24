# 14 - State Drift: Supabase vs. FTP

Scope: the two stores that together define "what the public sees".

- **DB (Supabase)**: `articles.status`, `articles.reviewed_at`, `articles.published_at`, `articles.related_articles`, `articles.image_files`, `articles.stage3_final_html` / `stage2_body_html`, and the `article-images` storage bucket.
- **FTP (harmony-mc.com)**: physical files under `/public_html/column/columns/`:
  - `columns/index.html` and `columns/page/N/index.html` — the hub index (one file per pagination page)
  - `columns/{slug}/index.html` — per-article HTML
  - `columns/{slug}/images/{hero,body,summary}.jpg` — per-article images

The hub is generated **entirely from DB state at deploy time** (`buildArticleCards` filters `status='published' AND reviewed_at IS NOT NULL`, see `src/lib/generators/hub-generator.ts:424–432`). The per-article HTML is generated from DB state at the moment of deploy and then becomes **frozen on disk** — it embeds the related-article list, hero image path, meta description, published date, and category label as literal strings.

This asymmetry (hub = regenerated every deploy, article = snapshot on disk) is the root cause of most drift classes below.

---

## 1. The 4 combinations (DB × FTP)

| # | DB state | FTP state | Is it drift? | Expected fix |
|---|---|---|---|---|
| A | `status='published'` AND `reviewed_at IS NOT NULL` | File present at `/column/{slug}/index.html` AND referenced by hub index | **Consistent** — no action. Reconciler must still verify content hash matches latest DB HTML. | — |
| B | `status='published'` AND `reviewed_at IS NOT NULL` | File missing (never uploaded, or upload failed mid-flight) | **Drift — visible as "published but 404"** | Re-run `/api/articles/[id]/deploy` for the article, then rebuild hub. |
| C | `status!='published'` OR `reviewed_at IS NULL` | File present on FTP (and/or listed on hub) | **Drift — "ghost article"**. The app has no code path that deletes anything from FTP, so every article ever deployed stays forever, even after being rolled back to `editing`. | Delete `/{slug}/index.html` and `/{slug}/images/*` from FTP, then rebuild hub. Requires building the deletion primitive that does not currently exist. |
| D | `status!='published'` OR `reviewed_at IS NULL` | File missing | **Consistent** — no action. | — |

Combinations A and D are the two good states. B and C are the only two real drift classes — but C has many sub-cases because the hub, the article HTML, and the image files can each independently drift.

---

## 2. Drift sub-cases (the ones that actually bite)

### 2.1 DB-says-published, file-not-on-FTP (class B)

1. **Upload failure mid-deploy.** `/api/articles/[id]/deploy` uploads HTML then loops per image. If the FTP connection drops after the HTML upload but before all images, the article page 200s but hero/body images 404. Nothing in DB records this partial state.
2. **Hub-rebuild fetch failed silently.** The deploy route does `fetch(hubRebuildUrl, ...).catch(logger.warn)` — a rejected promise is swallowed. Article page exists, but it is not listed on the hub and no link from `/column/` reaches it.
3. **`published` transition without deploy.** `POST /api/articles/[id]/transition` to `'published'` flips `status` and fires `POST /api/hub/rebuild` in the background, but **does not** call `/api/articles/[id]/deploy`. If the author never clicked the article deploy button, the hub lists the article but the article URL 404s.

### 2.2 FTP-has-it, DB-says-not-published (class C)

1. **Status rolled back.** `VALID_TRANSITIONS` in `src/lib/db/articles.ts:16–24` defines `published: []` — there is no transition out of `published`. But `updateArticle` (PUT `/api/articles/[id]`) can set any field including `status` without going through `transitionArticleStatus`, so a manual revert is possible. When that happens, the FTP file stays.
2. **`reviewed_at` cleared.** Toggling the review checkbox off (`reviewed_at = null`) removes the article from the hub query but leaves `/column/{slug}/index.html` on disk. This is the single most likely cause of the "stuck display" report — the article page still works, the hub just forgets about it, and the user sees stale behavior depending on how they navigated in.
3. **Article deleted from DB.** `DELETE /api/articles/[id]` removes the row, leaves all FTP files. Permanent ghost.
4. **Slug changed.** `articles.slug` is editable via the PUT route. New slug → next deploy writes `/column/{new}/index.html`, old slug is never cleaned up. Both URLs are live and both look published.

### 2.3 Hub index stale vs. article HTML (cross-class)

The hub is regenerated only when something triggers `/api/hub/rebuild` or `/api/hub/deploy`. Triggers today:

- `transition` → `published`: fires `/api/hub/rebuild` as fire-and-forget.
- `/api/articles/[id]/deploy`: fires `/api/hub/deploy` as fire-and-forget.
- Settings page "ハブ再生成" button.

No trigger fires on: `reviewed_at` toggle (except indirectly — `03-confirm-checkbox-behavior.md` says the checkbox fires `/api/hub/deploy`, but a failure is swallowed), slug change, title change, image regeneration, or direct `UPDATE articles` via SQL. Any of these can leave the hub card showing stale title / date / thumbnail while the article itself is correct.

### 2.4 Related-article partials stale

Related-article links are **inlined into `{slug}/index.html`** at generation time (see `src/lib/generators/article-html-generator.ts:297`). `articles.related_articles` is recomputed by `updateAllRelatedArticles()` after every `transition → published`, which updates DB rows — but the corresponding FTP `index.html` files are **not re-uploaded** unless each affected article is individually re-deployed. Net effect: after publishing article N, articles 1..N-1 have correct `related_articles` in DB and wrong `related_articles` in HTML on disk.

### 2.5 Article HTML present but linked hub metadata outdated

Each article HTML embeds breadcrumb (`../index.html`), category label, published date, and hero image path. If the hub's pagination shifts (e.g. new page 2 created), the article's own breadcrumb still points to `../index.html` which is fine, but if theme labels change or if `THEME_LABEL_MAP` is edited, every deployed article displays the old label until individually redeployed.

---

## 3. Invariants the system should enforce

Naming each so the reconciler can check them by ID.

- **INV-1** For every FTP file `/column/{slug}/index.html`, there exists a DB row with `slug=<slug>` AND `status='published'` AND `reviewed_at IS NOT NULL`.
- **INV-2** For every DB row matching the INV-1 predicate, the FTP file `/column/{slug}/index.html` exists.
- **INV-3** For every DB row matching INV-1, each entry in `image_files[]` has a corresponding uploaded file under `/column/{slug}/images/`.
- **INV-4** The hub index's list of slugs is exactly the set of slugs satisfying INV-1, in `published_at DESC` order.
- **INV-5** For every deployed article HTML, the embedded related-articles block equals the current `articles.related_articles` JSON for that row (modulo template rendering).
- **INV-6** For every deployed article HTML, the embedded theme label and meta description equal the current DB values.

Today the system enforces none of these at write time. The reconciler described below is the compensating mechanism.

### Schema additions that would make enforcement cheap

- `articles.deployed_at TIMESTAMPTZ` — set by deploy route on success.
- `articles.deployed_html_hash TEXT` — SHA-256 of the HTML we last uploaded. A mismatch between the hash of the current-generated HTML and this value means the on-disk copy is stale (detects INV-5 and INV-6 drift without re-downloading the file).
- `articles.deployed_slug TEXT` — if this differs from `slug`, a rename happened and the old-slug file is a ghost.

None of these exist today.

---

## 4. Proposed "reconcile now" operation

Endpoint: `POST /api/admin/reconcile` — guarded by the same auth as other admin routes, idempotent, safe to run against prod.

### 4.1 Phases (all read-only unless `mode=apply`)

1. **List FTP.** Walk `/public_html/column/columns/` one level deep; collect the set of `slug` directories and whether each has `index.html`.
2. **Query DB.** Fetch all articles (not just published) with `id, slug, status, reviewed_at, published_at, deployed_at` and the full HTML.
3. **Diff.** For each slug, produce a row with DB state, FTP state, and the drift class (A/B/C/D from section 1) plus sub-case (2.1.1, 2.2.2, ...).
4. **Report.** Always return the diff as JSON. If `mode=dry-run` (default), stop here.
5. **Apply** (only when `mode=apply` AND caller passes a `confirm` token matching the diff's hash):
   - Class B sub-case 1/3 → re-run deploy for that article.
   - Class B sub-case 2 → rebuild hub.
   - Class C sub-case 1/2/3 → FTP-delete the ghost (requires a new `deleteFromFtp(slug)` primitive — does not exist).
   - Class C sub-case 4 (slug rename) → FTP-delete the old-slug directory, deploy the new slug, rebuild hub.
   - After all per-article actions → rebuild hub one final time.
   - Re-deploy every published article whose generated-HTML hash differs from `deployed_html_hash` (covers 2.4 and 2.5).

### 4.2 Safety properties required

- **Two-phase commit style.** Compute the full diff first, echo a hash of it to the caller, require the caller to POST the same hash back to trigger apply. This prevents races where the DB changes between diff and apply.
- **Never delete FTP without DB confirmation.** A missing DB row is ambiguous (could be "deleted" or "service role query failed"); default to log-and-skip, not delete.
- **Always rebuild hub last.** So that if the per-article fixes fail partway, the hub still reflects the DB truth rather than a partially-fixed FTP.
- **Write `article_revisions` for every re-deploy** (per the HTML history rule in MEMORY.md).
- **Rate-limit.** FTP connections are serial today; reconciling 45 articles over one FTP session takes minutes. Do not invoke from a UI click without a background job.

---

## 5. Does the new confirm-button design need to address this?

Yes, for two of the three top drift scenarios — but the button alone cannot fix drift. It can only (a) stop creating new drift and (b) surface existing drift so the reconciler is actually run.

Minimum the button must do to avoid creating new drift:

- When the user clicks "公開する" (confirm + publish), do **not** fire-and-forget the hub rebuild. Await it, and if it fails, mark the article with a `needs_redeploy` flag so the list page can show a warning.
- When the user clicks "非公開にする" (the inverse action, which does not exist today), the button must call an FTP-delete endpoint **before** clearing `reviewed_at` / flipping `status`. Otherwise drift class C is created every time.
- The list page should display a "drift detected" badge when `articles.deployed_html_hash` differs from the hash of freshly generated HTML, so users know to re-deploy.

Drift scenario 2.1.3 (published-without-deploy) is fully within the button's scope — the button should refuse to set `status='published'` without also performing the FTP deploy in the same transaction.

---

## 6. Top 3 scenarios causing the reported "stuck display" bug

Ranked by likelihood given current code paths:

1. **`reviewed_at` toggled off → hub forgets article, but FTP file remains.** User navigates to `/column/` hub, article is gone. User navigates to `/column/{slug}/` directly (or from a bookmark), article is still there. Looks "stuck".
2. **Published transition without subsequent article deploy.** Hub lists the article because the DB predicate is satisfied, but clicking the card 404s. Looks "stuck" as a broken link.
3. **Related-articles staleness after a new publish.** Older articles' deployed HTML keeps linking to pre-new-publish related articles; DB says otherwise; re-running `updateAllRelatedArticles()` doesn't change what the visitor sees until every article is re-uploaded.
