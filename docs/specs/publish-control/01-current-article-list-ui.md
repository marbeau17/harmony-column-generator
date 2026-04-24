# 01 — Current Article List UI (As-Is)

Snapshot date: 2026-04-19
Scope: the dashboard article list page at `/dashboard/articles`
(production URL: https://blogauto-pi.vercel.app/dashboard/articles)

This document captures exactly what exists today so the upcoming
publish-control redesign (replace the per-row checkbox with a single
explicit "confirm" button that toggles hub-page visibility) has a
baseline to diff against.

---

## 1. File layout

Next.js 14 App Router. The relevant page lives in the `(dashboard)`
route group:

| Role                    | Path                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Route group layout      | `src/app/(dashboard)/layout.tsx`                                                       |
| Dashboard index         | `src/app/(dashboard)/dashboard/page.tsx`                                               |
| **Article list page**   | `src/app/(dashboard)/dashboard/articles/page.tsx`                                      |
| Article detail sub-tree | `src/app/(dashboard)/dashboard/articles/[id]/{edit,outline,review}`                    |
| New article wizard      | `src/app/(dashboard)/dashboard/articles/new/`                                          |
| Shared status pill      | `src/components/common/StatusBadge.tsx`                                                |
| GET/POST articles       | `src/app/api/articles/route.ts`                                                        |
| PUT/DELETE single       | `src/app/api/articles/[id]/route.ts`                                                   |
| Hub rebuild             | `src/app/api/hub/deploy/route.ts`                                                      |
| Article deploy          | `src/app/api/articles/[id]/deploy/route.ts`                                            |
| Bulk related refresh    | `src/app/api/articles/update-related/route.ts`                                         |
| Bulk export (ZIP)       | `src/app/api/export/article/route.ts`                                                  |
| DB access layer         | `src/lib/db/articles.ts`                                                               |
| Hub generator           | `src/lib/generators/hub-generator.ts`                                                  |
| Update payload schema   | `src/lib/validators/article.ts`                                                        |
| Reviewed columns DDL    | `supabase/migrations/20260415000000_add_reviewed_columns.sql`                          |

The page is a **Client Component** (`'use client'` at
`src/app/(dashboard)/dashboard/articles/page.tsx:1`) and drives the whole
list through client-side fetches against `/api/articles`.

---

## 2. State model (in the page component)

Declared inside `ArticlesPage()`
(`src/app/(dashboard)/dashboard/articles/page.tsx:78`–`162`):

| State                | Type                                     | Line | Purpose                                       |
| -------------------- | ---------------------------------------- | ---- | --------------------------------------------- |
| `articles`           | `ArticleItem[]`                          | 82   | Current page of rows fetched from API          |
| `totalCount`         | `number`                                 | 83   | Header counter (reads `meta.total` or `count`) |
| `loading` / `error`  | `boolean` / `string \| null`             | 84–85| Fetch lifecycle                               |
| `bulkUpdating` / `bulkUpdateResult` | `boolean` / `string \| null` | 88–89 | "関連記事を一括更新" state                     |
| `bulkExporting` / `bulkExportResult` | `boolean` / `string \| null` | 92–93 | "全記事エクスポート" state                     |
| `bulkDeploying` / `bulkDeployResult` | `boolean` / `string \| null` | 96–97 | "サーバーに更新" state                         |
| `statusFilter`       | `string`                                 | 153  | Persisted from `?status=` URL param           |
| `reviewFilter`       | `'all' \| 'reviewed' \| 'unreviewed'`    | 154  | **Client-side only**, not in URL              |
| `keyword` / `searchInput` | `string` / `string`                  | 155–156 | Search box                                   |
| `page`               | `number` (1-based)                       | 157  | Pagination                                    |
| `sortKey` / `sortDir`| `'updated_at' \| 'status' \| null` / `'asc'\|'desc'` | 160–161 | Column sort |

`ArticleItem` (interface at line 11) only carries:
`id, title, slug, keyword, status, updated_at, reviewed_at`. Notably it
does **not** carry `reviewed_by`, `published_at`, or `related_articles`
— the list is intentionally narrow.

### Interesting quirks

- `reviewFilter` is **not** pushed into the URL query, whereas
  `statusFilter` is initialized from `useSearchParams().get('status')`
  (`:152`). Reloading the page always resets the review filter to
  `'all'`.
- `PER_PAGE = 20` (`:41`) is a module constant. The API default is also
  20 (see `src/app/api/articles/route.ts:65`).
- `sortKey` defaults to `null`, which is described in a Japanese comment
  at line 219 as "API 返却順をそのまま維持（自動ソートしない）". DB-level
  order is `created_at DESC` (`src/lib/db/articles.ts:116`).
- Third click on a sort header *resets* sort (`:236`–`:240`).

---

## 3. Filter tab bar

Rendered at `page.tsx:455`–`511`. There are actually **two rows of
pills rendered side-by-side**, separated by a thin `|` glyph on `sm+`
viewports (`:475`).

### 3a. Status pills (`STATUS_FILTERS`, `:33`–`:39`)

| Label       | `status` value       | Target server filter                                  |
| ----------- | -------------------- | ----------------------------------------------------- |
| 全て        | `''` (omitted)       | No `status` query param                               |
| 下書き      | `draft`              | `?status=draft`                                       |
| レビュー中  | `outline_pending`    | `?status=outline_pending`                             |
| 編集中      | `editing`            | `?status=editing`                                     |
| 公開済み    | `published`          | `?status=published`                                   |

**Gap vs DB enum**: `src/lib/db/articles.ts:6–13` defines seven
`ArticleStatus` values (`draft`, `outline_pending`, `outline_approved`,
`body_generating`, `body_review`, `editing`, `published`). The UI only
surfaces 5 of them; `outline_approved`, `body_generating`, and
`body_review` are reachable (e.g. via the header counter) but cannot be
filtered directly. `StatusBadge.tsx:11`–`40` has labels for all seven.

Active pill style: `bg-brand-500 text-white`; inactive:
`bg-white text-brand-700 ... border border-brand-200`
(`:463`–`:468`).

### 3b. Review pills (inline-defined, `:478`–`:495`)

| Label       | `reviewFilter` value | Behaviour                                            |
| ----------- | -------------------- | ---------------------------------------------------- |
| 確認: 全て  | `'all'`              | No filter                                            |
| 確認済み    | `'reviewed'`         | Keeps rows where `reviewed_at != null`               |
| 未確認      | `'unreviewed'`       | Keeps rows where `reviewed_at == null`               |

This filter is **applied client-side inside `sortedArticles` useMemo**
(`:210`–`:217`), *after* the API response lands. It filters **only the
current page's 20 rows** — so "確認済み" on page 1 can show e.g. 3
reviewed articles even though there are 20 total reviewed across the
dataset. Pagination still uses the server's `totalCount`
(unfiltered-by-review), which causes misleading page counters.

Active review pill style uses `bg-emerald-500 text-white` rather than
brand color (`:489`), intentionally echoing the green check icon and
green `✅` title prefix used elsewhere for reviewed state.

---

## 4. The 確認 checkbox column (the feature being replaced)

### 4a. Wire-up

Rendered at `page.tsx:604`–`606` (header) and `:639`–`:671` (body).

```tsx
// header
<th ...>確認</th>

// cell
<td ... onClick={(e) => e.stopPropagation()}>
  <input
    type="checkbox"
    checked={Boolean(article.reviewed_at)}
    title={article.reviewed_at
      ? `確認済み (${new Date(article.reviewed_at).toLocaleDateString('ja-JP')})`
      : '未確認 — クリックで確認'}
    className="h-4 w-4 cursor-pointer accent-emerald-500"
    onChange={async (e) => { ... }}
  />
</td>
```

The outer `<td>` stops click-propagation so clicking the box does *not*
trigger `handleRowClick(article)` (the row-wide navigation handler at
`:268`).

### 4b. DB column it reads/writes

Source table column: `articles.reviewed_at` (`timestamptz`, nullable),
defined in
`supabase/migrations/20260415000000_add_reviewed_columns.sql:2`:

```sql
ALTER TABLE articles ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
CREATE INDEX IF NOT EXISTS idx_articles_reviewed_at
  ON articles (reviewed_at) WHERE reviewed_at IS NOT NULL;
```

- The checkbox is `checked` when `reviewed_at` is truthy (non-null).
- `reviewed_at` is the single source of truth. `reviewed_by` is set to
  the string `'小林由起子'` on check, `null` on uncheck.

### 4c. The onChange handler (`:645`–`:669`)

1. Captures `wasReviewed = Boolean(article.reviewed_at)`.
2. Computes `newVal = wasReviewed ? null : new Date().toISOString()`.
3. If un-checking, shows `confirm(...)` dialog warning "ハブページから
   非表示になります" (hub page visibility will be revoked).
4. Fires `PUT /api/articles/{id}` with body:
   ```json
   { "reviewed_at": newVal, "reviewed_by": newVal ? "小林由起子" : null }
   ```
   No `await` on the response body, no status check, no rollback.
5. Optimistically patches `articles` local state:
   ```ts
   setArticles(prev => prev.map(a =>
     a.id === article.id ? { ...a, reviewed_at: newVal } : a));
   ```
6. **Fire-and-forget** `POST /api/hub/deploy` to rebuild the hub
   (`fetch('/api/hub/deploy', { method: 'POST' }).catch(() => {})`). No
   user feedback on success/failure; no loading spinner; no error
   toast.

### 4d. Downstream visibility consequence

`buildArticleCards()` at `src/lib/generators/hub-generator.ts:424`–`475`
is the canonical filter that feeds the hub:

```ts
.from('articles')
.select('id, title, slug, ... image_files')
.eq('status', 'published')
.not('reviewed_at', 'is', null)
.order('published_at', { ascending: false });
```

So the rule is: **only `status = published` AND `reviewed_at IS NOT
NULL` articles appear on the hub.** Toggling the checkbox therefore
directly gates hub visibility — which aligns with what the user wants
the new "confirm" button to do.

Per-article FTP deploy (`src/app/api/articles/[id]/deploy/route.ts:42`)
has a second, independent gate: if `reviewed_at` is falsy it returns
HTTP 422 with message "由起子さんの確認が完了していません". The bulk
"サーバーに更新" path (see §5) pre-filters on the client before calling
this endpoint.

### 4e. Row also shows a secondary indicator

At `page.tsx:621`–`625` the title cell renders a small green `✅` after
the title when `reviewed_at` is truthy. This is a second visual signal
for the same underlying state — sometimes helpful, sometimes a source
of confusion because it updates optimistically on a separate code path
from the checkbox itself.

---

## 5. Top-right action bar

Rendered at `page.tsx:366`–`413`. Four buttons, left-to-right:

### 5a. 全記事エクスポート (`:367`–`:378`)

- Handler: `handleBulkExport()` (`:290`–`:322`).
- Calls `POST /api/export/article` with empty body, expects a ZIP blob,
  triggers browser download (`all-articles.zip`).
- Does not read/write `reviewed_at`. Exports *all* articles.
- Uses `Download` icon with `animate-bounce` while in flight.
- Shows a dismissible brand-colored banner `bulkExportResult`.

### 5b. 関連記事を一括更新 (`:379`–`:390`)

- Handler: `handleBulkUpdateRelated()` (`:272`–`:288`).
- Calls `POST /api/articles/update-related` which delegates to
  `updateAllRelatedArticles()` in `src/lib/publish/auto-related.ts`.
- Reports `${count} 件の記事の関連記事を更新しました` in a dismissible
  banner.
- Uses `RefreshCw` icon with `animate-spin` in flight.

### 5c. サーバーに更新 (`:391`–`:402`, emerald-styled)

This is the **bulk FTP deploy** button. Handler: `handleBulkDeploy()`
(`:99`–`:149`). Notable behaviour:

1. Opens `confirm('確認済みの記事をサーバーにデプロイしますか？')`.
2. **Refetches fresh** `GET /api/articles?status=published&limit=200`
   to avoid UI cache staleness (see the comment at `:104`).
3. Partitions into `reviewed` (`reviewed_at` truthy) and `skipped`.
4. If no reviewed rows → just reports "デプロイ対象の確認済み記事が
   ありません（未確認: N 件）" and exits.
5. Otherwise loops serially issuing `POST /api/articles/{id}/deploy`
   for each reviewed article, tallying success/failed/errors. Reports
   first 3 error messages inline.
6. Does **not** call `/api/hub/deploy` itself — that's handled
   per-article inside each `deploy` route (see `/api/articles/[id]/deploy/route.ts`).

Uses `Upload` icon + emerald color palette to signal the destructive/
production-facing nature.

### 5d. 新規記事作成 (`:403`–`:412`)

- Plain `router.push('/dashboard/articles/new')`.
- Primary brand color (`bg-brand-500`).

---

## 6. The header counter — `全 59 件 (body_review: 1 / 公開済み: 18 / 編集中: 1)`

Rendered at `page.tsx:350`–`364`.

- Outer `全 {totalCount} 件` reads `totalCount`, which is populated
  from `json.meta?.total ?? json.count ?? 0` at `:196`. This is the
  **server-side** total matching the current `statusFilter + keyword`
  query (offset/limit ignored). It does **not** respect
  `reviewFilter` because that's a pure client filter.

- Parenthetical breakdown is built from `statusCounts` useMemo
  (`:167`–`:173`):

  ```ts
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    articles.forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1; });
    return counts;
  }, [articles]);
  ```

  Crucially, this iterates **only the current page of 20 articles** —
  *not* all 59. That is why a 59-article dataset shows
  `(body_review: 1 / 公開済み: 18 / 編集中: 1)` — the counts add up to
  20 (one page), even though the outer "全 59 件" claims otherwise.

  Each `statusCounts` key is mapped to a label via
  `STATUS_FILTERS.find(f => f.value === s)?.label ?? s`
  (`:358`). Statuses that are **not** in `STATUS_FILTERS` (i.e.
  `outline_approved`, `body_generating`, `body_review`) fall back to
  the raw enum string — that's why `body_review` appears verbatim in
  the production UI while `published` is localized to `公開済み`.

### Likely source of the stuck-display bug

Because the status breakdown is computed from the 20-row page
(`useMemo([articles])`) *after* the optimistic `setArticles(...)` patch
in the checkbox handler, but **the header `totalCount` is only updated
on a full `fetchArticles()` call**, the numbers can legitimately
disagree with the current row view. More specifically for the "stuck"
symptom the user is describing:

1. Checkbox `onChange` only mutates `reviewed_at` on the local row.
   It does **not** refetch `/api/articles`, so `totalCount` and the
   per-status header breakdown remain whatever the previous fetch
   returned.
2. The `/api/hub/deploy` fire-and-forget rebuild never reports back —
   if it fails, the hub HTML and the dashboard disagree, but there is
   no visible error.
3. `reviewFilter` being purely client-side means that clicking
   "確認済み" hides rows locally but pagination (`totalPages`) still
   uses the unfiltered `totalCount`, producing ghost pages with zero
   rows plus the confusing "全 X 件" (which reflects the server's
   unfiltered count).
4. Because `ArticleItem` does not include `reviewed_by`, but the PUT
   request sends it anyway, the optimistic state and server state
   remain shaped differently. A subsequent GET will reshape the row
   from the DB — but only when something triggers `fetchArticles()`,
   and the checkbox onChange does not.

The UI-layer origin of the stuck display is therefore concentrated in
`src/app/(dashboard)/dashboard/articles/page.tsx:645`–`669`: a fire-
and-forget PUT + fire-and-forget hub rebuild + local optimistic patch,
with **no post-mutation refetch of `/api/articles`** and **no wait
signal for `/api/hub/deploy`**. The same file's `statusCounts` at
`:167` compounds the confusion by reporting page-local counts under a
total-dataset header.

---

## 7. Pagination

Rendered at `page.tsx:717`–`751`.

- Shown only when `totalPages > 1` (`:717`).
- `totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE))` (`:163`).
- Range label: `全 {totalCount} 件中 {(page-1)*PER_PAGE+1} – {min(page*PER_PAGE, totalCount)} 件`.
- `前へ` / `次へ` buttons call `setPage(p => Math.max(1, p-1))` and
  `setPage(p => Math.min(totalPages, p+1))` respectively and rely on
  the `useEffect([fetchArticles])` at `:204`–`:206` to issue the next
  API call.
- Filter changes reset `page` to 1 (`handleSearch`, `handleStatusFilter`,
  `handleReviewFilter` at `:252`–`:266`).
- **Bug surface**: `reviewFilter` is applied *after* pagination, so
  page-size can effectively shrink — the user can see e.g. 3 rows on
  page 1 and 0 rows on page 2 when filtering "確認済み" on a largely
  unreviewed dataset, because those 3 all happened to be on server
  page 1.

### Row count readout inside the table

Each row shows a sequential number: `(page - 1) * PER_PAGE + idx + 1`
(`:618` desktop, `:693` mobile). Because `idx` comes from
`sortedArticles.map((_, idx) =>)` — i.e. *after* the review filter and
sort — numbering resets densely on the filtered/sorted view, not on
the raw server order, which can be confusing when toggling filters.

---

## 8. Table columns (desktop) — summary

Order left-to-right (`page.tsx:585`–`607`):

1. **No.** — `(page-1)*PER_PAGE + idx + 1`, tabular-nums.
2. **タイトル / キーワード** — title + optional `✅` when reviewed +
   keyword subtitle.
3. **ステータス** — `<StatusBadge>` with sort-toggle header.
4. **更新日** — `formatDate(updated_at)` with sort-toggle header.
5. **確認** — the checkbox described in §4.

Clicking a row (except on the checkbox `<td>`) calls
`handleRowClick(article)` which dispatches via `getArticlePath()`
(`:45`–`:62`) to one of `/edit`, `/outline`, `/review` depending on
status.

## 9. Mobile view

At `<640px` (`sm:hidden`, `:679`) the table is replaced by a card list
(`:681`–`:714`) that omits the 確認 checkbox entirely. Mobile users
cannot currently confirm/unconfirm from the list — they must enter
the article detail page. The new "confirm button" design should
address this gap.

---

## 10. Data-flow diagram (current)

```
[user] ── click checkbox ─┐
                          ▼
page.tsx:645 onChange ──► PUT /api/articles/{id}  ──► updateArticle()
                          (fire-and-forget; no await on json)
                          │
                          ├──► setArticles(optimistic patch of reviewed_at)
                          │
                          └──► POST /api/hub/deploy  (fire-and-forget)
                                    │
                                    ▼
                         buildArticleCards() filters on
                         status='published' AND reviewed_at IS NOT NULL
                                    │
                                    ▼
                         FTP upload hub HTML to server
```

No refetch of `/api/articles`, no revalidate of the header counter,
no waiting on hub deploy, no error toast on either failure path.
This is the primary mechanical reason the dashboard can look "stuck"
or "out of sync" with the public hub page.

---

## 11. Things to preserve in the redesign

- The server-side review-gate in `/api/articles/[id]/deploy` (422 when
  `reviewed_at` is null). The new button should not bypass it.
- The hub-side filter `not('reviewed_at', 'is', null)` in
  `hub-generator.ts:431`. Hub visibility must stay scoped to reviewed
  + published rows.
- The `reviewed_by = '小林由起子'` bookkeeping on set.
- Mobile parity — card view currently has no affordance at all.
- Optimistic feedback is nice; what's missing is a confirmed state
  after the server round-trip plus hub-rebuild completion signal.

## 12. Things to consider removing / rethinking

- The `reviewFilter` client-only filter (confusing totals vs paging).
- The two-row pill bar (status + review) — a single-button per-row
  design may let us drop the review pills entirely.
- The `statusCounts` useMemo reading only the current page — either
  move it server-side into `/api/articles` meta, or remove it.
- The duplicated review indicator (`✅` in title + checkbox column) —
  collapse into the new button.
- Fire-and-forget pattern on both PUT and hub-deploy — the new button
  should `await` and show explicit success/error states, or queue a
  debounced rebuild.
