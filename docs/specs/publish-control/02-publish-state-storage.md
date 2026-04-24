# 02 — Publish State Storage Map

_Date: 2026-04-19_
_Scope: Catalogue every place where "is this article publicly visible on the hub?" state lives today, before we redesign the 「確認」 checkbox into a dedicated publish button._

---

## TL;DR

Visibility on the public hub page today is governed by a **two-column conjunction**:

```
visible_on_hub  ==  (articles.status = 'published')  AND  (articles.reviewed_at IS NOT NULL)
```

Neither column alone controls visibility — both must be true. There is **no single boolean flag**. In addition:

- The RLS policy on the `articles` table only checks `status = 'published'` — it does **not** know about `reviewed_at`.
- Static HTML files previously deployed to FTP persist on the remote server; nothing deletes them when `reviewed_at` is cleared or `status` is downgraded. The hub page is re-rendered without the article, but the article's `index.html` remains reachable by direct URL.
- The `out/` static exporter filters by `status = 'published'` only (missing `reviewed_at` filter) — a minor drift path.

These gaps are the primary sources of state drift listed at the bottom of this document.

---

## Field inventory

| field_name | location | written_by | read_by | purpose |
|---|---|---|---|---|
| `articles.status` | Supabase — `articles` table (enum: `draft` → … → `published`) | `transitionArticleStatus()` in `src/lib/db/articles.ts` (called by `POST /api/articles/[id]/transition`; also set directly by `src/app/api/queue/process/route.ts:907`) | Hub HTML generator (`src/lib/generators/hub-generator.ts:430`), public column list (`src/app/column/page.tsx:79`), public article page (`src/app/column/[slug]/page.tsx:30`), sitemap (`src/app/sitemap.ts:35`), `generateStaticParams` (`src/app/column/[slug]/page.tsx:144`), `exportHubPageToOut` / `exportAllToOut` (`src/lib/export/static-exporter.ts:186, 278`), `/api/export/article` (`src/app/api/export/article/route.ts:79`), RLS policy `"Published articles are public"` (`supabase/migrations/20260404000000_initial_schema.sql:194`) | Editorial pipeline stage ("is the draft finished?"). Also enforced by RLS for anonymous reads. |
| `articles.reviewed_at` | Supabase — `articles` table, `TIMESTAMPTZ NULL` (migration `20260415000000_add_reviewed_columns.sql`) | Dashboard list-page checkbox (`src/app/(dashboard)/dashboard/articles/page.tsx:656`) and detail-page button (`src/app/(dashboard)/dashboard/articles/[id]/page.tsx:610`), both via `PUT /api/articles/[id]` → `updateArticle()` → `updateArticleSchema` allows the field (`src/lib/validators/article.ts:89`) | Hub HTML generator (`src/lib/generators/hub-generator.ts:431`), public column list (`src/app/column/page.tsx:80`), public article page (`src/app/column/[slug]/page.tsx:31`), sitemap (`src/app/sitemap.ts:37`), per-article FTP deploy gate (`src/app/api/articles/[id]/deploy/route.ts:42`), bulk-deploy gate (`src/app/(dashboard)/dashboard/articles/page.tsx:108`) | 由起子さん review gate. Secondary AND condition that the website queries enforce on top of `status`. |
| `articles.reviewed_by` | Supabase — `articles` table, `TEXT NULL` | Same handlers as `reviewed_at` (written together) | Displayed on article detail page (`src/app/(dashboard)/dashboard/articles/[id]/page.tsx:596`) | Informational only; hard-coded to `'小林由起子'` when a reviewer clicks the button. Does **not** gate visibility. |
| `articles.published_at` | Supabase — `articles` table, `TIMESTAMPTZ NULL` | Auto-set by `transitionArticleStatus()` when transitioning into `published` (`src/lib/db/articles.ts:263`). Also accepted via `updateArticleSchema` (`src/lib/validators/article.ts:85`), and set directly during CSV import for source articles (separate table). | Sort key on hub, column list, sitemap, individual article page (`published` date shown in byline) | Timestamp of first publish. **Not** a visibility gate — a row can have `published_at` set but still be hidden because `reviewed_at` is null. |
| `articles.published_url` | Supabase — `articles` table, `TEXT NULL` | Never written by any route today (legacy column) | Displayed if present on article detail page (`src/app/(dashboard)/dashboard/articles/[id]/page.tsx:477`); contributes one point to SEO score (`src/lib/seo/score-calculator.ts:279`) | Dead / informational. Does not gate anything. |
| `articles.published_html` | Supabase — `articles` table, `TEXT NULL` | `updateArticle()` when dashboard saves; also referenced as fallback body in quality-check pipeline (`src/app/api/articles/[id]/transition/route.ts:79`) | Not used for visibility. Quality-check input only. | Snapshot of body at publish time. No visibility effect. |
| `articles.quality_check` | Supabase — `articles` table, `JSONB NULL` (migration `20260407000000_add_quality_check.sql`) | `runQualityChecklist()` via `POST /api/articles/[id]/transition` when going `editing → published` (result is validated; not all code paths persist it back) | Error message in dashboard when transition is rejected | Blocks the `editing → published` transition if the checklist fails. Indirectly gates publish, but once `status` is `published` this column is not consulted again. |
| `articles.image_files` | Supabase — `articles` table, `JSONB` | Image-generation pipeline | Hub card thumbnails, per-article FTP deploy | Not a visibility gate, but a missing thumbnail can make an article effectively invisible on the hub. |
| `article_revisions.*` | Supabase — `article_revisions` table | `saveRevision()` in `updateArticle()` (`src/lib/db/articles.ts:207`) | Revision history UI | History only. Does not gate visibility. |
| RLS policy `"Published articles are public"` | Supabase — `articles` table policy (`supabase/migrations/20260404000000_initial_schema.sql:194`) | SQL migration | Anonymous Supabase clients (anon role) | Permits `SELECT` to anonymous role **iff `status = 'published'`**. Does **not** check `reviewed_at`. Application uses `createServiceRoleClient()` (bypasses RLS) for hub queries, but any future anon-role query would leak unreviewed-yet-published articles. |
| FTP file `/{slug}/index.html` | Remote FTP server (e.g. `sv*.xserver.jp:/public_html/column/columns/{slug}/index.html`) | `POST /api/articles/[id]/deploy` (`src/app/api/articles/[id]/deploy/route.ts:148`); gated by `reviewed_at` and quality checklist and template checker | End users via HTTPS at `https://harmony-mc.com/column/columns/{slug}/` | Physical published artifact. **No code path deletes or overwrites this file when the article becomes unreviewed / unpublished.** |
| FTP file `/index.html` and `/page/N/index.html` (hub pages) | Remote FTP server | `POST /api/hub/deploy` (`src/app/api/hub/deploy/route.ts`), which in turn calls `buildArticleCards()` filtered by `status='published' AND reviewed_at IS NOT NULL` | End users | Re-generated from the DB on every call (either after article deploy, hub rebuild, or toggling the confirm checkbox which fires `fetch('/api/hub/deploy')` — see `src/app/(dashboard)/dashboard/articles/page.tsx:668`). If DB filters are correct, hub listing is consistent. |
| FTP images under `/{slug}/images/*.jpg` | Remote FTP server | Per-article deploy | End users | Same lifecycle as article HTML (never deleted). |
| Local `out/column/**` | Local filesystem (`process.cwd()/out`), local dev only | `exportArticleToOut` / `exportHubPageToOut` (`src/lib/export/static-exporter.ts`), called from `/api/articles/[id]/transition` when `!VERCEL` | Local preview | **Filters by `status='published'` only — not by `reviewed_at`.** Potential drift on a local dev box, but this path never runs on Vercel. |
| Next.js ISR cache for `/column/*` pages | Vercel edge cache | Server components (SSG + `dynamicParams = true`) | Anonymous visitors to `harmony-mc.com/column/...` (or the Vercel domain, if any) | `generateStaticParams` uses `status='published'` only (no `reviewed_at`). Once a slug has been rendered, its cached HTML is served until `revalidate` or a redeploy. Could serve stale visible HTML after `reviewed_at` is cleared. |
| FTP config | Supabase — `settings` table (`key='ftp'`) with env-var fallback (`src/lib/deploy/ftp-uploader.ts:45`) | Settings UI | Deploy routes | Not a visibility field, but controls which server files land on. |

---

## Writers and readers, end to end

### Writer 1 — the 「確認」 checkbox (today's de-facto publish switch)

`src/app/(dashboard)/dashboard/articles/page.tsx:640-669`

```
checkbox toggle
  → PUT /api/articles/[id]  { reviewed_at, reviewed_by }
  → updateArticle() → UPDATE articles SET reviewed_at = $1, reviewed_by = $2
  → POST /api/hub/deploy    (fire-and-forget; rebuilds hub HTML on FTP)
```

Same flow from the detail page (`[id]/page.tsx:605`), minus the hub rebuild (this is a known inconsistency).

### Writer 2 — the status transition API

`src/app/api/articles/[id]/transition/route.ts` → `transitionArticleStatus()` → writes `status` (and `published_at` when target is `published`) → triggers `/api/hub/rebuild`, related-article recomputation, and `out/` static export.

### Writer 3 — the FTP deploy button

`POST /api/articles/[id]/deploy` reads — not writes — the two gating columns. It refuses to deploy when `reviewed_at IS NULL`. It does **not** modify `status` or `reviewed_at`; it only writes to the remote file system.

### Readers

- **Public pages** (`/column`, `/column/[slug]`, `sitemap.ts`): require both `status='published'` AND `reviewed_at IS NOT NULL`.
- **Hub HTML generator** (`buildArticleCards` in `hub-generator.ts`): same dual filter.
- **RLS policy** (anon reads): only checks `status='published'`.
- **`exportHubPageToOut` / `exportAllToOut`** (local `out/` export): only checks `status='published'` — missing reviewed filter.
- **`generateStaticParams`** for `/column/[slug]`: only checks `status='published'` — missing reviewed filter (but the per-slug fetch inside the page component applies both filters, so the leak surfaces as a 404 rather than data exposure).

---

## Canonical source of truth

For the product question "should this article appear on the hub page?", the canonical source of truth **today** is the conjunction `articles.status = 'published' AND articles.reviewed_at IS NOT NULL` in Supabase.

The hub page's physical `index.html` on the FTP server is the **rendered consequence** of that state at the last `/api/hub/deploy` call. It is regenerated every time either state changes via the dashboard UI. The individual article `{slug}/index.html` files on FTP are **not** a source of truth — they are a cache that is never invalidated.

---

## Where the sources can drift

| # | Drift location | Scenario |
|---|---|---|
| 1 | RLS vs. application filter | An anonymous Supabase query (e.g. a future public API or mis-routed server action) would see articles with `status='published'` **regardless of `reviewed_at`**. Today no such query exists — the app only uses `createServiceRoleClient()` on the public read path — but the safety net is single-layered. |
| 2 | FTP `{slug}/index.html` vs. DB | Once an article is deployed, its file persists on the remote server. Un-reviewing the article removes it from the hub listing but leaves the per-slug page reachable by direct URL. Same for un-publishing. |
| 3 | Next.js ISR cache for `/column/[slug]` | `generateStaticParams` filters only by `status='published'`; served HTML is cached until revalidation. A slug that was visited while reviewed stays cached even after `reviewed_at` is cleared, until the next revalidation window. |
| 4 | `out/` static exporter | `exportHubPageToOut` and `exportAllToOut` filter only by `status='published'`. Running them locally would generate hub output including unreviewed articles. Harmless in prod (Vercel skips this path) but a trap for local testing. |
| 5 | `generateStaticParams` for `/column/[slug]` | Pre-renders every slug with `status='published'`, including unreviewed ones. The per-page query then rejects unreviewed ones with `notFound()`, so the user sees a 404 rather than leaked content — but this means the slug is known to the build index. |
| 6 | List-page checkbox vs. detail-page button | Both mutate `reviewed_at`, but only the list-page handler triggers `/api/hub/deploy`. Toggling the button on the detail page leaves the hub HTML on FTP stale until another trigger runs. |
| 7 | `reviewed_at` cleared while `status='published'` | Supported by the schema and the UI (user is asked "確認を取り消しますか？ ハブページから非表示になります。"). The DB enters a half-published state that older code reading only `status='published'` would mis-render. See drift #1, #3, #4, #5. |
| 8 | `published_at` vs. `status` | `published_at` is set on the first transition into `published` and never cleared — even if someone later rolls the status back (today the transition map disallows it from `published`, but future edits could). It is used as a sort key, so order can outlive the state. |

---

## Implications for the "single confirm button" redesign

To eliminate the dual-column AND-gate, the new design should pick **one** canonical field. Two natural shapes:

1. **Collapse into `status`** — add a status value like `confirmed` or `visible`, and make the confirm button perform a proper status transition. Benefits: RLS policy can be updated to match; `published_at` semantics become cleaner. Costs: touches the state machine and all status readers.
2. **Keep `reviewed_at` as the sole gate, demote `status='published'`** — treat `status='published'` as "ready for review" and `reviewed_at IS NOT NULL` as "live". Benefits: minimal change to the state machine. Costs: the RLS policy still needs to change to check `reviewed_at`, and the field name becomes misleading.

Either way, the readers in the table above (8 public read paths + 1 RLS policy) must all be updated in lock-step, and the FTP invalidation gaps (drift #2, #3) need explicit handling — either by deleting the remote file on "unpublish" or by accepting that individual article URLs remain reachable forever once deployed.

---

## Key files (absolute paths)

- `/Users/yasudaosamu/Desktop/codes/blogauto/supabase/migrations/20260404000000_initial_schema.sql`
- `/Users/yasudaosamu/Desktop/codes/blogauto/supabase/migrations/20260415000000_add_reviewed_columns.sql`
- `/Users/yasudaosamu/Desktop/codes/blogauto/supabase/migrations/20260407000000_add_quality_check.sql`
- `/Users/yasudaosamu/Desktop/codes/blogauto/supabase/migrations/20260417000000_article_revisions.sql`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/lib/db/articles.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/lib/validators/article.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/lib/generators/hub-generator.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/lib/export/static-exporter.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/lib/deploy/ftp-uploader.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/column/page.tsx`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/column/[slug]/page.tsx`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/sitemap.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/api/articles/[id]/route.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/api/articles/[id]/deploy/route.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/api/articles/[id]/transition/route.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/api/hub/deploy/route.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/api/hub/rebuild/route.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/(dashboard)/dashboard/articles/page.tsx`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/(dashboard)/dashboard/articles/[id]/page.tsx`
