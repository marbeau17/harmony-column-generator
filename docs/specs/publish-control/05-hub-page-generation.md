# 05 — Hub Page Generation (End-to-End Trace)

Date: 2026-04-19
Scope: Trace how `https://harmony-mc.com/column/` (the hub / column index) is built today, so a future "single 確認 checkbox" design can target the right decision point.
Sources: commit `4a89037` (Unify hub generation), live code under `src/lib/generators/`, `src/app/api/hub/**`, `src/lib/deploy/`.

---

## 1. Full pipeline diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Triggering surfaces                              │
├─────────────────────────────────────────────────────────────────────────┤
│ A. Articles list checkbox (確認)                                        │
│    src/app/(dashboard)/dashboard/articles/page.tsx  (L639–670)         │
│      onChange → PUT /api/articles/:id  { reviewed_at, reviewed_by }    │
│      then      → POST /api/hub/deploy  (fire-and-forget)               │
│                                                                         │
│ B. Article detail page "確認済みにする" button                          │
│    src/app/(dashboard)/dashboard/articles/[id]/page.tsx  (L602–624)    │
│      PUT /api/articles/:id { reviewed_at, reviewed_by }                 │
│      (no /api/hub/deploy call — list page only)                        │
│                                                                         │
│ C. Article FTP deploy                                                   │
│    POST /api/articles/:id/deploy                                        │
│      src/app/api/articles/[id]/deploy/route.ts                          │
│      → uploads article HTML+images                                      │
│      → fire-and-forget POST /api/hub/deploy (L114–118)                  │
│                                                                         │
│ D. Manual hub rebuild (no FTP)                                          │
│    POST /api/hub/rebuild  (src/app/api/hub/rebuild/route.ts)            │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  POST /api/hub/deploy                                                   │
│  src/app/api/hub/deploy/route.ts                                        │
│                                                                         │
│  1. auth check (supabase.auth.getUser)                                  │
│  2. articles = buildArticleCards()   ← Supabase query (see §2)          │
│  3. if articles.length === 0 → skip (success, 0 pages)                  │
│  4. categories = buildCategories(articles)                              │
│  5. pages      = generateAllHubPages(articles, categories)              │
│  6. getFtpConfig() → basic-ftp upload of each page.path (see §5)        │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  src/lib/generators/hub-generator.ts                                    │
│                                                                         │
│  buildArticleCards()        — Supabase SELECT + map to HubArticleCard   │
│  buildCategories(articles)  — group-by theme, sort by count desc        │
│  generateAllHubPages(...)   — paginate (10/pg) → [{path, html}, ...]    │
│    generateHubPage(data)    — string-concat full HTML (head, nav,       │
│                                cards, sidebar, pagination, footer)     │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  src/lib/deploy/ftp-uploader.ts → uploadToFtp(config, files)            │
│  basic-ftp client, one connection, sequential upload                    │
│  remoteBasePath defaults to /public_html/column/columns/                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. The Supabase query that decides hub inclusion

**File:** `src/lib/generators/hub-generator.ts`, function `buildArticleCards()` (L424–475).

```ts
const { data, error } = await supabase
  .from('articles')
  .select(
    'id, title, slug, seo_filename, meta_description, ' +
    'stage2_body_html, stage3_final_html, theme, ' +
    'published_at, image_files'
  )
  .eq('status', 'published')          // ← gate #1
  .not('reviewed_at', 'is', null)     // ← gate #2
  .order('published_at', { ascending: false });
```

**The effective WHERE clause is:**

```sql
WHERE status = 'published'
  AND reviewed_at IS NOT NULL
ORDER BY published_at DESC
```

This is the single source of truth for hub inclusion. Every hub-rendering path (`/api/hub/deploy`, `/api/hub/rebuild`) routes through `buildArticleCards()`. The deprecated simplified `buildHubHtml` that used to live in the per-article deploy route was removed in commit `4a89037`.

Related (consistent) queries:
- `src/app/sitemap.ts` L35 — also filters `status='published'` and was patched in the same commit to add `.not('reviewed_at', 'is', null)`.
- `src/app/column/[slug]/page.tsx`, `src/lib/export/static-exporter.ts` — filter `status='published'` only (these render individual article pages, not the hub list).

---

## 3. What the 確認 checkbox actually writes

### 3a. Articles list checkbox (`src/app/(dashboard)/dashboard/articles/page.tsx` L639–670)

```ts
const newVal = wasReviewed ? null : new Date().toISOString();
await fetch(`/api/articles/${article.id}`, {
  method: 'PUT',
  body: JSON.stringify({
    reviewed_at: newVal,
    reviewed_by: newVal ? '小林由起子' : null,
  }),
});
// then fire-and-forget:
fetch('/api/hub/deploy', { method: 'POST' });
```

Writes only `reviewed_at` + `reviewed_by`. **Does not touch `status`.**

### 3b. Article detail toggle (`src/app/(dashboard)/dashboard/articles/[id]/page.tsx` L602–624)

Same PUT body; also does not touch `status`. Also does **NOT** trigger `/api/hub/deploy` — hub refresh only happens from the list page or the article deploy route.

The detail-page 確認 UI is wrapped in `{article.status === 'published' && (…)}` (L588), so the button is only visible after the article has been promoted to `status='published'` (via `publishArticle()` / transition routes).

---

## 4. Ordering on the hub page

1. SQL order: `published_at DESC` (`buildArticleCards`).
2. After mapping to `HubArticleCard`, array order is preserved through:
   - `generateAllHubPages`: slices in order, 10 per page — page 1 = newest 10, page 2 = next 10, etc.
   - `recentArticles`: `articles.slice(0, 5)` — sidebar "最新記事" block.
   - Categories list in sidebar: sorted by `count DESC` (via `buildCategories`), not alphabetical.

No secondary sort key; articles with equal/null `published_at` fall back to Postgres default ordering.

---

## 5. How the hub HTML is built

Pure string-concatenation (no template engine, no JSX SSR). Key helpers in `hub-generator.ts`:

| Function | Purpose |
|---|---|
| `getHubCSS()` | Inline `<style>` block (full stylesheet embedded per page) |
| `buildGA4Tag()` | GA4 script (`G-TH2XJ24V3T` default) |
| `buildArticleCardHtml(card)` | One `<a class="article-card">…` block |
| `buildPaginationHtml(cur, total)` | Prev/Next + numbered pagination |
| `buildSidebarHtml(data)` | Category list + recent articles + booking CTA |
| `generateHubPage(data)` | Assembles the full `<!DOCTYPE html>…` document |
| `generateAllHubPages(articles, categories)` | Paginator: emits `[{path, html}]` |

Layout constants:
- `ARTICLES_PER_PAGE = 10`
- `SITE_NAME = 'Harmonyスピリチュアルコラム'`
- `SITE_URL = 'https://harmony-mc.com'`
- `COLUMNS_BASE = 'https://harmony-mc.com/columns'`

Theme → Japanese label map (`THEME_LABEL_MAP`): healing/relationships/introduction/daily/self_growth/soul_mission/grief_care.

**No dedicated template file** — the HTML is inlined inside the TS source. CSS is inlined per page via `<style>`. There is no `templates/hub/*.html` being read at runtime.

---

## 6. Output destination (FTP)

Resolved in `src/lib/deploy/ftp-uploader.ts`, `getFtpConfig()`:

1. Try DB: `settings` table, key `'ftp'` (JSON blob with host/user/password/port/remotePath).
2. Fallback: env vars `FTP_HOST`, `FTP_USER`, `FTP_PASSWORD`, optional `FTP_PORT`, `FTP_REMOTE_PATH`.

**Default `remoteBasePath`:** `/public_html/column/columns/` (both DB fallback and env fallback).

Page paths returned by `generateAllHubPages`:

| Hub page | Remote absolute path |
|---|---|
| Page 1 | `/public_html/column/columns/index.html` |
| Page 2 | `/public_html/column/columns/page/2/index.html` |
| Page 3 | `/public_html/column/columns/page/3/index.html` |
| …     | `/public_html/column/columns/page/N/index.html` |

FTP upload is done with `basic-ftp` (`uploadToFtp` in ftp-uploader, or directly via `new Client()` in the per-article route). `client.ensureDir` creates `page/N/` directories as needed; `client.cd('/')` resets after each.

---

## 7. Dry-run modes

| Surface | Does it write to FTP? |
|---|---|
| `POST /api/hub/rebuild` | **No.** Returns generated file paths + counts only. Closest thing to a dry-run. |
| `POST /api/hub/deploy` | Yes — full FTP upload. |
| `POST /api/articles/:id/deploy` | Yes — article files + background call to `/api/hub/deploy`. |

No local-filesystem preview target (e.g. `out/` write) exists in the hub pipeline — the ad-hoc scripts in `scripts/` (e.g. `regenerate-all-html.ts`) are separate one-shots.

---

## 8. Mismatch: 確認 checkbox vs hub WHERE clause

The hub query needs BOTH `status='published'` AND `reviewed_at IS NOT NULL`.

The 確認 checkbox only flips `reviewed_at`. It neither sets nor clears `status`. Consequences:

1. **Unchecking 確認 on a `published` article hides it from the hub** — `reviewed_at = null` fails gate #2. Intended behavior (the confirm dialog even says so: "ハブページから非表示になります").
2. **Checking 確認 on a NON-`published` article does NOT put it on the hub** — gate #1 still fails. The detail-page 確認 section is only shown when `status === 'published'`, but the list-page checkbox has no such guard; there is nothing preventing a user from reviewing a `body_review`/`editing` article that will never surface on the hub.
3. **Checking 確認 on a `published` article makes it appear on next hub rebuild**, which the list-page auto-triggers via `fire-and-forget POST /api/hub/deploy`. If that background call fails or is cancelled by Vercel, the DB is updated but the static hub HTML on the FTP host is stale until the next deploy — this is the most likely cause of "stuck display" reports.
4. **Detail page does NOT trigger hub rebuild.** Toggling 確認 from the article detail page updates the DB only; the static hub HTML is unchanged until something else re-runs `/api/hub/deploy`.

### Summary table

| User action | `status` | `reviewed_at` | Shows on hub? | Hub HTML auto-rebuilt? |
|---|---|---|---|---|
| List checkbox ON, article is `published` | published | timestamp | Yes | Yes (fire-and-forget) |
| List checkbox ON, article is `body_review` | body_review | timestamp | **No** (status fails) | Yes (but no change) |
| List checkbox OFF, article is `published` | published | null | No | Yes (fire-and-forget) |
| Detail button ON, article is `published` | published | timestamp | Yes (on next rebuild) | **No** |
| `publishArticle()` run, 確認 never done | published | null | **No** (review fails) | N/A |

A "single confirm button" design should unify these into one state machine so that toggling confirm is both necessary and sufficient to control hub visibility — e.g. either (a) collapse `status='published' AND reviewed_at IS NOT NULL` into one flag, or (b) make the confirm action atomically set/unset `status` as well, and guarantee a successful hub rebuild before returning success.
