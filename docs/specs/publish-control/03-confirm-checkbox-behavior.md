# 03 - 確認 (Review) Checkbox Behavior — Current State

Target surface: the dashboard article list at `/dashboard/articles`, the "確認"
column checkbox and the sibling review filter tabs.

Purpose of this doc: trace **exactly** what happens when the user toggles the
checkbox (and what the `確認:全て / 確認済み / 未確認` tabs read), so we can
safely delete it and replace it with a single action button.

---

## 1. Components involved

- Article list page (renders the checkbox, the filter tabs, and the bulk
  "サーバーに更新" button):
  - `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/(dashboard)/dashboard/articles/page.tsx`
- Article detail page (renders a parallel "由起子さん確認" button — not the
  checkbox, but writes the same field via the same API):
  - `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/(dashboard)/dashboard/articles/[id]/page.tsx`
    (lines ~590–625)
- API endpoint the onChange handler calls:
  - `PUT /api/articles/[id]`
  - `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/api/articles/[id]/route.ts`
- Second API the handler fires-and-forgets:
  - `POST /api/hub/deploy`
  - `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/api/hub/deploy/route.ts`
- DB column:
  - `articles.reviewed_at TIMESTAMPTZ`, `articles.reviewed_by TEXT`
  - migration: `/Users/yasudaosamu/Desktop/codes/blogauto/supabase/migrations/20260415000000_add_reviewed_columns.sql`
- Validator allowlist for the PUT payload:
  - `/Users/yasudaosamu/Desktop/codes/blogauto/src/lib/validators/article.ts`
    (lines 89–90: `reviewed_at` and `reviewed_by` are both nullable/optional)

No other component writes `reviewed_at` from the UI. The only two writers are
the list-row checkbox and the detail-page toggle button — both hit the same PUT
route with the same payload shape.

---

## 2. What the checkbox renders

`articles/page.tsx` lines 604–671:

- Table header column titled `確認` (line 605).
- Each row renders:
  - A green ✅ badge next to the title when `article.reviewed_at` is truthy
    (line 623–625 — purely decorative).
  - A single `<input type="checkbox">` bound to `Boolean(article.reviewed_at)`
    (line 642), inside a `<td onClick={e => e.stopPropagation()}>` so that
    clicking the checkbox does NOT trigger the row-navigation handler.

The checkbox is the ONLY way to flip `reviewed_at` from the list page.

---

## 3. Click → DB sequence diagram (text form)

```
User clicks the checkbox on row N
  │
  ▼
onChange handler (articles/page.tsx:645-669)
  │  e.stopPropagation()
  │  wasReviewed = Boolean(article.reviewed_at)
  │  newVal     = wasReviewed ? null : new Date().toISOString()
  │
  ├── if (wasReviewed) → window.confirm(
  │       "「<title>」の確認を取り消しますか？
  │        ハブページから非表示になります。")
  │     on cancel → return (no state change)
  │
  ▼
fetch PUT /api/articles/<id>
  body = {
    reviewed_at: newVal,               // ISO string OR null
    reviewed_by: newVal ? '小林由起子' : null,
  }
  (handler does NOT await the response for errors — it only awaits the
   promise, then proceeds unconditionally; there is no .ok check, no
   rollback on failure.)
  │
  ▼
API: src/app/api/articles/[id]/route.ts PUT
  │  auth check (Supabase cookie)
  │  validate(updateArticleSchema, body) → accepts reviewed_at/reviewed_by
  │  updateArticle(id, { reviewed_at, reviewed_by })
  │    → UPDATE articles SET reviewed_at=…, reviewed_by=…, updated_at=now()
  │       WHERE id = <id>
  │  returns { data: updated }
  │
  ▼
Client: optimistic local state patch
  setArticles(prev => prev.map(a =>
    a.id === article.id ? { ...a, reviewed_at: newVal } : a))
  (The UI flips even if the PUT silently failed.)
  │
  ▼
Client: fire-and-forget POST /api/hub/deploy
  fetch('/api/hub/deploy', { method: 'POST' }).catch(() => {})
  │  (no await, no user feedback, errors swallowed)
  │
  ▼
API: src/app/api/hub/deploy/route.ts POST (maxDuration 120s)
  │  auth check
  │  buildArticleCards()
  │    → SELECT … FROM articles
  │       WHERE status='published' AND reviewed_at IS NOT NULL
  │       ORDER BY published_at DESC
  │  generateAllHubPages(…)
  │  getFtpConfig()
  │  uploadToFtp(config, pages)
  │    → FTP PUTs /column/index.html, category pages, etc.
  │  returns { success, uploaded, … }
  │
  ▼
UI does not refresh; user sees no indication the hub redeployed
(or failed).
```

---

## 4. Side-effects inventory

On check (null → timestamp):

1. DB: `articles.reviewed_at = now()`, `articles.reviewed_by = '小林由起子'`,
   `updated_at = now()` (handled inside `updateArticle`).
2. Client UI: row gains the ✅ next to the title; `確認済み` filter starts
   including the row.
3. Background: a `POST /api/hub/deploy` is fired-and-forgotten, which
   regenerates and FTP-uploads the hub index + category pages. The uploaded
   pages now include this article card.
4. Individual article HTML at `/column/<slug>/index.html` is **NOT** touched.
   That file only gets uploaded by `POST /api/articles/[id]/deploy`, which is
   a separate flow triggered either by the per-article deploy button or by
   the list page's `サーバーに更新` bulk button.

On uncheck (timestamp → null):

1. DB: `reviewed_at = null`, `reviewed_by = null`.
2. Client UI: ✅ disappears; the `確認済み` filter stops including the row;
   the `未確認` filter starts including it.
3. `confirm()` dialog warns the user "ハブページから非表示になります".
4. Background: the same fire-and-forget `POST /api/hub/deploy` rebuilds the
   hub. Since the row is no longer `reviewed_at IS NOT NULL`, its card is
   **removed from the hub index and category pages**.
5. The article's own page `/column/<slug>/index.html` remains on FTP and is
   still reachable by direct URL. Its removal would require a separate FTP
   delete which is NOT performed here.

---

## 5. What the three filter tabs read

`articles/page.tsx` lines 478–495 render the tabs. Lines 211–217 apply them:

```ts
if (reviewFilter === 'reviewed')   filtered = articles.filter(a => a.reviewed_at != null);
if (reviewFilter === 'unreviewed') filtered = articles.filter(a => a.reviewed_at == null);
// 'all' → no filter
```

Key property: the filter is **client-side only**. `GET /api/articles` does NOT
accept a `reviewed` query param (see `src/app/api/articles/route.ts` and
`listArticlesQuerySchema` — only `status`, `keyword`, `limit`, `offset`).
The page fetches up to `PER_PAGE=20` rows and then filters in JS, which means
if page 1 has 20 rows and only 3 are reviewed, the "確認済み" tab shows only 3
— not "the first 20 reviewed rows from the DB". This is an independent bug
surface worth noting when we replace the checkbox.

---

## 6. Where `reviewed_at` is read elsewhere

- Hub generator (`src/lib/generators/hub-generator.ts` line 431):
  `buildArticleCards()` includes `.not('reviewed_at', 'is', null)`. This is
  the ONLY place the flag actually gates public output. Used by
  `POST /api/hub/deploy` and indirectly by the per-article deploy endpoint
  (which fires `/api/hub/deploy` after uploading).
- Public column pages (`src/app/column/page.tsx` line 80,
  `src/app/column/[slug]/page.tsx` line 31): both filter out articles where
  `reviewed_at IS NULL`. These are the Next.js rendered versions — they exist
  but are not the primary user surface (harmony-mc.com serves the FTP'd
  static HTML).
- `src/app/sitemap.ts` line 37: same filter, so unreviewed articles are
  excluded from the sitemap.
- `POST /api/articles/[id]/deploy` lines 42–47: **hard gate**. If
  `article.reviewed_at` is null it returns 422 and refuses to upload. This
  is the only server-side enforcement point for the flag.

---

## 7. Does the checkbox gate publication?

Short answer: **partially, and only through two indirect paths**.

- Path A (hub listing): `reviewed_at IS NOT NULL` is required for an article
  to appear in the hub's generated HTML (via `buildArticleCards`). So
  unchecking the box → next `/api/hub/deploy` rebuild → card disappears from
  hub index/category pages. The checkbox itself triggers that rebuild as a
  side-effect (fire-and-forget), so in practice unchecking does cause the hub
  to hide the card within ~30–120 seconds.
- Path B (per-article deploy): The POST `/api/articles/[id]/deploy` endpoint
  refuses to run when `reviewed_at` is null (422). Both the per-article
  button and the list's bulk `サーバーに更新` button respect this gate
  (the list's `handleBulkDeploy` filters with `a.reviewed_at` **client-side
  first** before even calling the endpoint — see lines 108–118).

What the checkbox does **NOT** do:

- It does not change `articles.status`. A `published`-status article remains
  `published` regardless of `reviewed_at`. The two flags are orthogonal in
  DB terms.
- It does not upload or delete any individual article HTML on FTP.
  `/column/<slug>/index.html` is unaffected. If the article was previously
  deployed with `reviewed_at` set, then unchecking only removes it from the
  hub listing — the direct URL keeps working, and Google's cache / external
  links still resolve to the old page.
- It does not trigger `/api/articles/[id]/deploy` (the per-article full
  upload). Initial publication of the article page itself requires the user
  to click a deploy button separately.
- It does not provide any user feedback on the hub rebuild result — errors
  are swallowed by `.catch(() => {})`.

---

## 8. Discrepancy: "marked reviewed" vs. "actually published on hub"

There are several gaps between the mental model ("I check the box → it's
live") and the real behavior:

1. **Check is not a deploy trigger for the article itself.** If the article
   has never been through `/api/articles/[id]/deploy`, checking the box only
   adds it to the hub listing, but clicking the hub card will 404 because
   `/column/<slug>/index.html` was never uploaded.
2. **Check triggers a hub redeploy that can silently fail.** `fetch(...)
   .catch(() => {})` swallows FTP failures, 401s (auth), 422s, and network
   errors. The UI still flips to ✅ and the user assumes it is live. If the
   hub deploy failed, the previous hub HTML on FTP still shows the old
   content (without this article).
3. **Optimistic UI hides PUT failures too.** The onChange handler does not
   check `res.ok` before `setArticles(...)`. If the PUT itself 4xx's (e.g.
   auth expired), the UI shows ✅ but the DB is unchanged; the next page
   refresh will revert.
4. **Uncheck does not unpublish the article HTML.** The warning text
   "ハブページから非表示になります" is accurate — it says *hub page* — but
   users easily misread it as "the article goes down". The article's own
   page at `/column/<slug>/` stays reachable.
5. **Client-side filter tabs are paginated-scoped.** The `確認済み` tab
   shows only reviewed rows within the 20-row page the API returned, not
   "all reviewed rows in the DB". Counts in the header
   (`statusCounts`) are also computed over the current page only.
6. **Two writers, one field.** The detail page button and the list-row
   checkbox both write `reviewed_at` via the same PUT endpoint with the
   same payload, but only the list-row checkbox fires the hub-deploy
   side-effect. Toggling from the detail page leaves the hub stale until
   something else triggers a rebuild.

---

## 9. Summary for the replacement design

When we remove the checkbox and the three tabs:

- Preserve the underlying column `reviewed_at` — it is a real publication
  gate inside `buildArticleCards` and inside `POST /api/articles/[id]/deploy`.
- Preserve (or replace) the ability to uncheck. Today, uncheck is the only
  way to pull an article back out of the hub listing without deleting it.
- The replacement action button should probably be an explicit "公開する /
  公開を取り消す" that does **both** sides of the operation atomically:
  set `reviewed_at` + per-article deploy + hub redeploy, with visible
  error reporting. That closes all six discrepancies above in one change.
