# 12. Article Status State Machine

**Scope**: Harmony Column Generator — `articles.status` field
**Source of truth**: `src/types/article.ts`, `src/lib/db/articles.ts`, `src/components/common/StatusBadge.tsx`
**Related fields**: `reviewed_at`, `reviewed_by`, `published_at`, `published_html`

---

## 1. Enum values (7 states)

Defined in `src/types/article.ts:12-19` and mirrored in `src/lib/db/articles.ts:6-13`:

| # | Value                | Badge label (`StatusBadge.tsx`) | Timeline label (`[id]/page.tsx`) |
|---|----------------------|---------------------------------|----------------------------------|
| 0 | `draft`              | 下書き                          | 下書き                           |
| 1 | `outline_pending`    | 構成案確認中                    | アウトライン確認待ち             |
| 2 | `outline_approved`   | 構成案承認済                    | アウトライン承認済み             |
| 3 | `body_generating`    | AI生成中 (animate-pulse)        | 本文生成中                       |
| 4 | `body_review`        | **生成レビュー**                | 本文レビュー                     |
| 5 | `editing`            | 編集中                          | 編集中                           |
| 6 | `published`          | **公開済**                      | 公開済み                         |

Constant export: `ARTICLE_STATUSES` (`src/types/article.ts:21-29`).

---

## 2. Filter tab ↔ status mapping

The article list page defines tabs in `src/app/(dashboard)/dashboard/articles/page.tsx:33-39`:

```ts
const STATUS_FILTERS = [
  { value: '',                label: '全て' },
  { value: 'draft',           label: '下書き' },
  { value: 'outline_pending', label: 'レビュー中' },
  { value: 'editing',         label: '編集中' },
  { value: 'published',       label: '公開済み' },
] as const;
```

**Tab → backing status (1-to-1 filter by `status=` query param)**:

| Tab label       | Filter value      | Notes                                                      |
|-----------------|-------------------|------------------------------------------------------------|
| 全て            | (none)            | No `status` filter                                         |
| 下書き          | `draft`           |                                                            |
| レビュー中      | `outline_pending` | **Only covers outline review**                             |
| 編集中          | `editing`         |                                                            |
| 公開済み        | `published`       |                                                            |

### Reconciliation with UI badges

Question from the task: *Is "生成レビュー" (article 1) the same as the "レビュー中" tab?*

**No.** They are different states:

- The **tab** "レビュー中" filters on `status='outline_pending'` (outline step).
- The **badge** "生成レビュー" is shown for `status='body_review'` (post-AI-body step).

Consequence: **`body_review`, `outline_approved`, `body_generating` articles do not match any of the named tabs** — they only appear under 全て. This explains the screenshot's counter `body_review: 1 / 公開済み: 18 / 編集中: 1` summing to 20 while the `body_review` article is not clickable from a dedicated tab. That counter (`statusCounts` in `articles/page.tsx:167-173`) is aggregated from whichever page of articles is currently loaded.

The "公開済" badge for articles 2–10 is the same as the "公開済み" tab (both represent `status='published'`); the trailing み is dropped in the badge purely as a visual style.

---

## 3. State diagram

```
                   createArticle()
                        │
                        ▼
                  ┌───────────┐
                  │   draft   │◀─────────────┐
                  └─────┬─────┘              │
                        │ outline requested  │ (revert)
                        ▼                    │
                 ┌───────────────┐           │
                 │outline_pending│───────────┤
                 └───────┬───────┘           │
                 approve │                   │
                         ▼                   │
                ┌────────────────┐           │
                │outline_approved│───────────┘
                └────────┬───────┘
                         │ start body gen
                         ▼
                 ┌───────────────┐
                 │body_generating│◀────┐
                 └───────┬───────┘     │
                         │ AI done     │ regenerate
                         ▼             │
                  ┌─────────────┐      │
                  │ body_review │──────┘
                  └──────┬──────┘
                         │ approve → manual edit
                         ▼
                   ┌───────────┐
                   │  editing  │◀─────┐
                   └─────┬─────┘      │
                         │ publish    │ unreview/re-edit
                         ▼            │
                  ┌─────────────┐     │
                  │  published  │─────┘   (NOTE: 'editing'→'body_review' is allowed,
                  └─────────────┘               but 'published'→* is a terminal node
                                                in VALID_TRANSITIONS — see §4)
```

---

## 4. Transition table (authoritative)

From `src/lib/db/articles.ts:16-24`:

```ts
const VALID_TRANSITIONS: Record<ArticleStatus, ArticleStatus[]> = {
  draft:             ['outline_pending'],
  outline_pending:   ['outline_approved', 'draft'],
  outline_approved:  ['body_generating', 'draft'],
  body_generating:   ['body_review'],
  body_review:       ['editing', 'body_generating'],
  editing:           ['published', 'body_review'],
  published:         [],
};
```

Flattened:

| From              | To                 | Back-transition? | Triggered by                                                                                                       |
|-------------------|--------------------|------------------|--------------------------------------------------------------------------------------------------------------------|
| `draft`           | `outline_pending`  | —                | User: outline generation (AI) / `POST /api/ai/generate-outline` via planner                                        |
| `outline_pending` | `outline_approved` | —                | User: UI approve button → `POST /api/articles/[id]/transition`                                                     |
| `outline_pending` | `draft`            | yes (back)       | User: revert in outline view                                                                                       |
| `outline_approved`| `body_generating`  | —                | Queue worker (`/api/queue/process`) or `/api/ai/generate-body`                                                     |
| `outline_approved`| `draft`            | yes (back)       | User                                                                                                               |
| `body_generating` | `body_review`      | —                | AI body generator (`/api/ai/generate-body:200`, `/api/queue/process:555`) on completion                            |
| `body_review`     | `editing`          | —                | User: UI "編集に進む" → `POST /api/articles/[id]/transition`                                                        |
| `body_review`     | `body_generating`  | yes (back)       | User: "再生成" button                                                                                              |
| `editing`         | `published`        | —                | User: publish button (`edit/page.tsx:216`) → `POST /api/articles/[id]/transition { status: 'published' }`; also direct DB update from queue worker (`/api/queue/process:907`) |
| `editing`         | `body_review`      | yes (back)       | User: revert to AI review                                                                                          |
| `published`       | (none)             | **terminal**     | No valid transition. To re-edit, the article must be edited in place (bypassing the state machine) or the transition table must be amended. |

### Side-effects on transitions

| Transition           | Auto side-effects                                                                                         | Source                                             |
|----------------------|-----------------------------------------------------------------------------------------------------------|----------------------------------------------------|
| `* → published`      | Sets `published_at = now()` in `transitionArticleStatus()`                                                | `src/lib/db/articles.ts:261-264`                   |
| `* → published`      | Runs quality checklist; blocks transition on failure (HTTP 422)                                           | `src/app/api/articles/[id]/transition/route.ts:77-101` |
| `* → published`      | Triggers `POST /api/hub/rebuild` (fire-and-forget) to regenerate hub page                                 | `transition/route.ts:113-128`                      |
| `* → published`      | Triggers `computeAndSaveRelatedArticles` + `updateAllRelatedArticles`                                     | `transition/route.ts:131-138`                      |
| `* → published`      | In non-Vercel env: `exportArticleToOut` + `exportHubPageToOut`                                            | `transition/route.ts:141-150`                      |
| Any invalid attempt  | `transitionArticleStatus()` throws; API returns HTTP 400 `Invalid status transition: X → Y`              | `articles.ts:251-256`                              |

---

## 5. Hub eligibility — the definitive rule

### Answer

**`status='published'` alone is NOT sufficient.**
An article appears on the public hub (`/spiritual/column/`, `/column/` listing, sitemap, static HTML hub pages) only when **both** conditions hold:

```sql
status = 'published' AND reviewed_at IS NOT NULL
```

### Evidence (4 gates, all require `reviewed_at`)

| Surface                                          | Query                                                                              | File                                      |
|--------------------------------------------------|------------------------------------------------------------------------------------|-------------------------------------------|
| Static hub HTML generator (FTP-deployed `index.html`) | `.eq('status', 'published').not('reviewed_at', 'is', null)`                        | `src/lib/generators/hub-generator.ts:430-431` |
| Next.js `/column` listing page                   | `.eq('status', 'published').not('reviewed_at', 'is', null)`                        | `src/app/column/page.tsx:79-80`           |
| Next.js `/column/[slug]` detail page             | `.eq('status', 'published').not('reviewed_at', 'is', null)`                        | `src/app/column/[slug]/page.tsx:30-31`    |
| `sitemap.xml`                                    | `.eq('status', 'published').not('reviewed_at', 'is', null)`                        | `src/app/sitemap.ts:35-37`                |
| Per-article FTP deploy                           | Early-return 422 if `!article.reviewed_at`                                         | `src/app/api/articles/[id]/deploy/route.ts:42-47` |
| Bulk deploy from list page                       | Client filters `reviewed.length === 0` → error; only `reviewed` items are POSTed   | `articles/page.tsx:108-118`               |

### How `reviewed_at` is set

- **UI**: article detail page toggle "✅ 確認済みにする" sets `{ reviewed_at: new Date().toISOString(), reviewed_by: '小林由起子' }` via `PATCH /api/articles/[id]` (`[id]/page.tsx:604-611`).
- **UI**: article list has a per-row checkbox wired to the same API (`articles/page.tsx:642-663`).
- `reviewed_at` is **orthogonal to `status`** — it can be toggled in either direction at any status, and is explicitly not part of `VALID_TRANSITIONS`.

### Corollary

An article with `status='published'` but `reviewed_at=null` is in a legitimate intermediate state: the system treats it as **published but not yet Yukiko-approved**, so it is queryable in the dashboard (`/dashboard/articles?status=published`) and appears under the 公開済み tab, but is **invisible on public surfaces and cannot be FTP-deployed**. This is the "reviewed_at gate" described in the project memory.

---

## 6. Open issues / non-obvious facts

1. **`published` is terminal.** There is no legal path back from `published`. Content edits on published articles therefore use `updateArticle()` (which snapshots to `article_revisions`) directly, not the transition API.
2. **Direct-write bypasses.** `src/app/api/queue/process/route.ts:907` and `scripts/process-queue-direct.ts:229` set `status='published'` via `supabase.update(...)` instead of `transitionArticleStatus()`. This skips `VALID_TRANSITIONS` but also skips the quality checklist and hub-rebuild hooks that the transition API provides.
3. **Filter-tab gap.** Tabs do not expose `outline_approved`, `body_generating`, or `body_review`. Articles in these states are reachable only via 全て or deep links like `/dashboard/articles?status=body_review`.
4. **Dashboard counter inconsistency.** `dashboard/page.tsx:72` defines "生成済み数" as `status IN ('body_review','editing','published')`; the articles list counter in the screenshot bucket is computed differently (from the currently-loaded page), so numbers can disagree.
