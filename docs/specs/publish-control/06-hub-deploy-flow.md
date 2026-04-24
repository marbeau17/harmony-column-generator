# 06. Hub Deploy Flow — End-to-End Pipeline

**Scope:** Documents what happens when the user toggles the "由起子さん確認済み" checkbox (or clicks FTP deploy on settings) so that one action both (a) flips `reviewed_at` and (b) rebuilds + uploads the column hub page. Input for the "publish control single-button" redesign.

**Status:** As-of commit `4a89037` ("Unify hub generation: remove simple buildHubHtml, delegate to /api/hub/deploy") on branch `main`, date 2026-04-19.

---

## 1. Entry points (the "button")

There are **three** user-facing triggers that end up calling `/api/hub/deploy`:

| # | UI location | Handler | Behavior |
|---|---|---|---|
| 1 | Articles list, "確認" checkbox per row | `src/app/(dashboard)/dashboard/articles/page.tsx:645-669` | PUT `reviewed_at` via `/api/articles/:id` → then **fire-and-forget** `fetch('/api/hub/deploy', { method: 'POST' }).catch(() => {})` |
| 2 | Settings page, "FTPデプロイ" button | `src/app/(dashboard)/dashboard/settings/page.tsx:176-199` (`handleFtpDeploy`) | Awaits `/api/hub/deploy`, shows progress bar with fake `setInterval` ticks up to 90% |
| 3 | Individual article deploy | `src/app/api/articles/[id]/deploy/route.ts:112-118` | After FTP-uploading the article body+images, **fire-and-forget** `fetch(hubRebuildUrl, ...)` to `/api/hub/deploy` |

In addition `/api/hub/rebuild` (see §6) is called after queue processing and as a "preview only" button on settings — it generates HTML but does **not** upload.

---

## 2. `/api/hub/deploy` — canonical pipeline

**File:** `src/app/api/hub/deploy/route.ts` (commit 4a89037).
**Export:** `export const maxDuration = 120;` (Vercel serverless 120s ceiling).

### 2.1 Auth

```
const supabase = await createServerSupabaseClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) → 401 '認証が必要です'
```

Relies on the Supabase cookie from the browser session. When invoked as a fire-and-forget from `/api/articles/[id]/deploy`, the calling route forwards the cookie header explicitly (`headers: { cookie: req.headers.get('cookie') || '' }`, `[id]/deploy/route.ts:116`). The checkbox click in the articles list, however, calls `/api/hub/deploy` directly from the browser, so cookies flow natively.

### 2.2 Build article list

```
articles = await buildArticleCards();    // hub-generator.ts:424
```

Query (`hub-generator.ts:427-432`):
```
.from('articles')
.select(...)
.eq('status', 'published')
.not('reviewed_at', 'is', null)         // <-- reviewed gate
.order('published_at', { ascending: false });
```

Uses **service-role client**, so RLS is bypassed. A row with `status='published'` but `reviewed_at=null` is **excluded**. This is the mechanism by which un-checking the checkbox "hides" an article.

If `articles.length === 0`, the route short-circuits with `{ success:true, pages:0, articles:0, uploaded:0 }` and **does not upload** — meaning the currently-live hub page is left in place. See §8 failure mode F-1.

### 2.3 Generate HTML pages

```
categories = buildCategories(articles);              // hub-generator.ts:480
pages      = generateAllHubPages(articles, categories); // :391
```

`generateAllHubPages` returns `{ path, html }[]`:
- Page 1 → `index.html`
- Page 2+ → `page/2/index.html`, `page/3/index.html`, …

`ARTICLES_PER_PAGE` constant in `hub-generator.ts` controls split.

### 2.4 Upload

```
ftpConfig = await getFtpConfig();
result    = await uploadToFtp(ftpConfig, files);
```

Only HTML pages are uploaded — no CSS, no JS, no images. (Compare §7.)

---

## 3. FTP connection details

**Module:** `src/lib/deploy/ftp-uploader.ts` (basic-ftp driver).

### 3.1 Config lookup (`getFtpConfig`, lines 45-92)

Two-tier precedence, **DB-first**:

1. Supabase `settings` table, `key = 'ftp'`, `value` column parsed as JSON.
   - Uses **service-role** client (`createServiceRoleClient`).
   - Wrapped in `try {} catch {}` — silent fallback on any error.
2. Environment variables from `.env.local` (Vercel runtime env):
   - `FTP_HOST`, `FTP_USER`, `FTP_PASSWORD` (required; throws otherwise)
   - `FTP_PORT` (default `21`)
   - `FTP_REMOTE_PATH` (default `/public_html/column/columns/`)

Current live values (`.env.local:24-28`):
```
FTP_HOST=ftp.lolipop.jp
FTP_USER=main.jp-6065dde7f616df59
FTP_PORT=21
FTP_REMOTE_PATH=/spiritual/column/
```

Note: `.env.local.example` still shows `FTP_HOST=harmony-mc.com` and `FTP_REMOTE_PATH=/public_html/column/columns/`, which is stale — ロリポップ host + `/spiritual/column/` are the real values.

### 3.2 Authentication

Plain FTP, `secure: false` hard-coded (line 169 and `ftp-uploader.ts:85/90`). No FTPS, no SFTP, no key auth. Password-in-env, transmitted in cleartext to `ftp.lolipop.jp:21`.

### 3.3 Session & connection

- `new Client()` per call (`uploadToFtp` at line 157). No pooling.
- Serial upload loop (`for (const file of files)`, line 173) — one TCP/FTP session reused across all files.
- `client.ftp.verbose = false` — no transcript in logs.
- `client.close()` in `finally`.

### 3.4 Upload path / naming (`uploadFile`, line 126)

```
fullPath = normalizeBasePath(basePath) + remotePath
          = '/spiritual/column/' + 'index.html'
          = '/spiritual/column/index.html'

fullPath for page 2 = '/spiritual/column/page/2/index.html'
```

For each file:
1. `client.ensureDir(dir)` (creates missing parents, leaves cwd inside dir).
2. `client.cd('/')` — resets cwd so the next `ensureDir` doesn't nest.
3. `client.uploadFrom(Readable.from(Buffer.from(content, 'utf-8')), fullPath)`.

Files are **overwritten in place** with the same filename — there is no versioned or cache-busted name. No `.tmp` + rename dance, no atomic swap.

---

## 4. Cache invalidation / CDN

**None.** Grep for `cache`, `cdn`, `Cache-Control`, `purge`, `invalidate`, `cloudflare`, `fastly` inside `src/lib/deploy` and `src/app/api/hub` yields zero matches.

- Target origin is `ftp.lolipop.jp` (Lolipop shared hosting) fronted by `harmony-mc.com` — there is no fronting CDN configured in the codebase.
- HTML filenames are unversioned (`index.html`), so browser / proxy caching is governed purely by whatever `Cache-Control` Lolipop's Apache sends (not controlled by this repo).
- No webhook, no `fetch(...)` to flush anything after upload.

Practically: **once `client.uploadFrom` completes, the next HTTP GET to `https://harmony-mc.com/spiritual/column/` should return the new bytes**, modulo any upstream caches on the user's browser / ISP that are outside our control. Hard refresh (Cmd+Shift+R) is the manual escape hatch.

---

## 5. Timing / latency budget

Observed / bounded values:

| Stage | Source | Typical / ceiling |
|---|---|---|
| Vercel route ceiling | `maxDuration = 120` | 120 s hard kill |
| Supabase select | `buildArticleCards` | ~100-300 ms |
| HTML generation | `generateAllHubPages` | <50 ms (in-memory, 45 articles) |
| FTP `client.access` | ftp.lolipop.jp:21 | 1-3 s typical |
| Per-file upload | `uploadFrom`, small HTML | 200-600 ms each |
| Total for N pages | N × (ensureDir + cd + upload) | ~1s + 0.5s × pages |

For the current ~45 published articles (ARTICLES_PER_PAGE presumably 9-12 → 4-5 hub pages), expect **5-10 s end-to-end**. The settings-page progress bar is cosmetic (`setInterval +5%/400ms`, not tied to actual upload progress).

Risk: if Lolipop FTP is slow (10+ s per file) and pagination grows past ~20 pages, the 120 s ceiling becomes real.

---

## 6. `/api/hub/rebuild` (sibling, read-only)

`src/app/api/hub/rebuild/route.ts` does steps 2.1-2.3 of the deploy route (auth + build + generate HTML) and returns the list of generated paths in the response **without uploading**. `maxDuration = 60`. Used by:

- Settings page "ハブページ再生成" button (preview/diagnostic).
- `/api/articles/[id]/transition` post-state-change hook (`transition/route.ts:115`).
- Queue processor post-run hook (`queue/process/route.ts:934`).

This means a queue run or article-state change currently rebuilds the HTML in memory and throws it away — it does **not** push anything. Only `/api/hub/deploy` (and the individual article deploy that triggers it) actually writes to FTP.

---

## 7. Comparison: API route vs. standalone scripts

All four scripts live in `/scripts/` and are **untracked** per `git status`. They are developer utilities, not part of the runtime path. They all load `.env.local` manually, read files from `/out/column/...`, and use `basic-ftp` directly.

| | `/api/hub/deploy` (canonical) | `scripts/ftp-deploy-all.ts` | `scripts/ftp-deploy-with-css.ts` | `scripts/ftp-redeploy-affected.ts` | `scripts/redeploy-affected.ts` |
|---|---|---|---|---|---|
| Runtime | Vercel Serverless (Next.js route) | Local Node (tsx) | Local Node (tsx) | Local Node (tsx) | Local Node (tsx) |
| Source of HTML | Supabase → `generateAllHubPages` | Local `out/column/**/index.html` | Local `out/column/**/index.html` | Local `out/column/{slug}/index.html` | — (rewrites DB + local) |
| Uploads | Hub pages only | Hub `index.html` + every article `index.html` under `out/column/*/` | Hub + articles + `css/hub.css` + nested `page/N/index.html` | Only 5 hardcoded article slugs | Does not upload — it sanitizes DB HTML and local `out/` files |
| Auth | Supabase session cookie | `.env.local` FTP_* | `.env.local` FTP_* | `.env.local` FTP_* | — |
| Idempotency | None (re-uploads every time) | None | None | None | Skips if HTML is already clean (`hasBroken` check at line 67) |
| Base path | `FTP_REMOTE_PATH` via `getFtpConfig` (DB → env) | `process.env.FTP_REMOTE_PATH` (env only) | same | same | N/A |
| Default base path | `/public_html/column/columns/` | `/public_html/column/columns/` | `/public_html/column/columns/` | `/public_html/column/columns/` | N/A |
| Reviewed-at gate | Yes (via buildArticleCards) | No — uploads whatever is in `out/` | No | No | No |

**Canonical path:** `/api/hub/deploy`. The scripts are one-off repair tools that pre-date or work around the API (notably: they push from local `out/`, which the API does not produce — the API generates in memory and uploads directly).

**Drift worth noting:**
- Script default base path (`/public_html/column/columns/`) mismatches the live env (`/spiritual/column/`). A developer running `ftp-deploy-all.ts` without setting `FTP_REMOTE_PATH` explicitly would write to the wrong directory.
- Scripts upload **articles + CSS**; the API uploads **only the hub HTML**. Articles arrive at FTP via `/api/articles/[id]/deploy`, which has its own basic-ftp `Client()` block (`[id]/deploy/route.ts:124-177`) — not through `ftp-uploader.ts`'s `uploadToFtp`. CSS is never deployed by any API route; it only ships via `ftp-deploy-with-css.ts`.

---

## 8. Failure modes

### F-1. Empty `articles` array → silent no-op (likely root cause of "stuck display")
`/api/hub/deploy` returns early (route.ts:45-53) without uploading if `buildArticleCards()` returns 0 rows. If the user un-checks the last reviewed article, the hub page on the server still contains the old content pointing at the now-hidden article. Same thing if the service-role select fails silently (no error path for transient Supabase read errors beyond the catch-all).

### F-2. Fire-and-forget from articles list
`articles/page.tsx:668` uses `fetch('/api/hub/deploy', { method: 'POST' }).catch(() => {})`. No await, no toast, no retry. A 500 from the deploy route is completely invisible to the user. The checkbox state updates locally regardless of whether the hub actually rebuilt.

### F-3. Partial upload → `success: false` but some files on server
`uploadToFtp` (`ftp-uploader.ts:173-181`) catches per-file errors and continues. If file 3 of 5 fails:
- `index.html` and `page/2/index.html` are new.
- `page/3/index.html` fails.
- `page/4/index.html` and `page/5/index.html` are new.

The hub site is now internally inconsistent: the top page links to page 3 which is stale. Response returns `success:false` with error list, but a fire-and-forget caller never sees it.

### F-4. FTP connect failure
`client.access` throws → caught at `uploadToFtp` line 182 → pushed into `errors`, `uploaded` stays 0, `success:false`. Nothing on the server is overwritten — previous state survives. Recoverable by retry.

### F-5. Vercel 120s timeout
Serverless function killed mid-upload. `finally { client.close() }` may or may not run. Files uploaded before the kill stay; the rest are lost. Same inconsistency as F-3 but more violent.

### F-6. Cookie-less background call from `[id]/deploy`
If the browser's cookie is missing/expired when it first hits `/api/articles/:id/deploy`, the server has no cookie to forward to `/api/hub/deploy` (line 117: `req.headers.get('cookie') || ''`). The background fetch then 401s and, again, fails invisibly. The article ships but the hub doesn't refresh.

### F-7. DB settings write overriding env
If someone saves bad FTP creds via the settings UI, `getFtpConfig` will prefer the DB row over `.env.local`. There is no "test connection" step before upload.

### F-8. No idempotency / no diffing
Every call re-uploads every page. Harmless for correctness (overwrites are fine), but means transient FTP flakiness × every checkbox click is amplified. No `skip if no changes` check.

### F-9. `reviewed_at` flip race
The articles list does `await fetch(PUT /api/articles/:id)` then `fetch('/api/hub/deploy')` without awaiting — but the PUT is awaited, so the DB is consistent before the deploy starts. However if the user spams the checkbox, two deploys race. `basic-ftp` opens two independent connections — whichever finishes last wins. On Lolipop shared hosting, simultaneous connections may be rate-limited.

---

## 9. Implications for the single-button redesign

The current flow entangles **three independently-failable steps** (DB flip, HTML build, FTP upload) behind a checkbox that reports success the moment the DB write returns. To give the user a trustworthy "hidden / visible" signal:

1. The checkbox click must **await** `/api/hub/deploy` and show its result.
2. `/api/hub/deploy` should upload even when `articles.length === 0` — push an empty-state hub page instead of early-returning (fixes F-1).
3. Partial-upload responses (F-3) need a user-visible warning and a retry affordance.
4. Consider writing a `_staging/` directory first then renaming, to avoid F-5-style torn state.
5. Consider collapsing `reviewed_at` flip + hub deploy into a single server-side transaction handler (`/api/articles/:id/publish` that does both) so the client has one atomic call.

---

## Referenced files (absolute paths)

- `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/api/hub/deploy/route.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/api/hub/rebuild/route.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/api/articles/[id]/deploy/route.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/lib/deploy/ftp-uploader.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/lib/generators/hub-generator.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/(dashboard)/dashboard/articles/page.tsx`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/(dashboard)/dashboard/settings/page.tsx`
- `/Users/yasudaosamu/Desktop/codes/blogauto/scripts/ftp-deploy-all.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/scripts/ftp-deploy-with-css.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/scripts/ftp-redeploy-affected.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/scripts/redeploy-affected.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/.env.local` (FTP creds)
