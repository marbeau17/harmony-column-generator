# 10. Revision System — Audit Trail for the Publish Button

Context for this document: the new publish-control flow introduces a "publish" button
that toggles whether an article is visible on the public hub (`harmony-mc.com/column/`).
Before designing its audit trail, we must align with the existing revision system that
protects HTML-modifying operations.

Related commits:
- `bf184be` — Initial version history + template validator (2026-04-17)
- `b5d3037` — Schema reconciliation (html_snapshot, comment) (2026-04-17)

Related code:
- `/Users/yasudaosamu/Desktop/codes/blogauto/supabase/migrations/20260417000000_article_revisions.sql`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/lib/db/article-revisions.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/lib/db/articles.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/api/articles/[id]/revisions/route.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/api/articles/[id]/revisions/[revisionId]/restore/route.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/lib/content/html-template-validator.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/api/articles/[id]/deploy/route.ts`
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/(dashboard)/dashboard/articles/[id]/page.tsx`

---

## 10.1 `article_revisions` Schema

The table is defined in the migration `20260417000000_article_revisions.sql` but the
**actual production schema** that the code targets (per commit `b5d3037`) uses slightly
different column names than the migration. The code is the source of truth:

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK (`gen_random_uuid()`) | |
| `article_id` | UUID FK → `articles(id)` ON DELETE CASCADE | |
| `revision_number` | INTEGER | Monotonic per article; computed as `MAX(revision_number)+1` at insert time |
| `html_snapshot` | TEXT NOT NULL | The `stage3_final_html` (preferred) or `stage2_body_html` at the time of snapshot |
| `change_type` | TEXT | `'auto_snapshot'` \| `'manual_save'` \| `'restore_backup'` \| (legacy) `'publish'`, `'ai_generated'`, `'batch'` |
| `changed_by` | TEXT NULL | User identifier (currently unpopulated) |
| `comment` | TEXT NULL | **JSON blob** holding `{ title, meta_description }` — see `packComment`/`unpackComment` in `article-revisions.ts` |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() | |

Index: `idx_revisions_article` on `(article_id, created_at DESC)`.
RLS: `authenticated` role has full access.

Note on schema drift: the migration file declared `title`, `body_html`,
`meta_description` as separate columns. The existing production table instead has
`html_snapshot` + `comment(json)`. Commit `b5d3037` adapted the code — `packComment`
serializes `{title, meta_description}` into `comment`, and `unpackComment` parses it
back on read. Any new code must use `html_snapshot` / `comment`, not the migration names.

---

## 10.2 Snapshot Insertion Points

Snapshots are taken **before** any write that could change stored HTML/title/meta. All
insertions funnel through `saveRevision(articleId, snapshot, changeType, changedBy?)`
in `src/lib/db/article-revisions.ts`.

### Trigger 1 — `updateArticle()` (`src/lib/db/articles.ts:180-231`)

Called by `PUT /api/articles/[id]` and any internal updater. The function:

1. Detects whether the incoming `fields` touch any of: `stage2_body_html`,
   `stage3_final_html`, `title`, `meta_description`.
2. If so, fetches the current row, compares field-by-field, and only calls
   `saveRevision(..., 'auto_snapshot')` when **content actually differs** (prevents
   auto-save ticks from flooding the history).
3. Proceeds with the update. Snapshot failure is caught and swallowed (`.catch(() => {})`)
   so the update itself cannot be blocked by a snapshot error.

This is the load-bearing insertion point. It enforces the project-wide "HTML edit must
INSERT a revision first" rule for **all** edits that go through `updateArticle`.

### Trigger 2 — `restoreRevision()` (`src/lib/db/article-revisions.ts:104-146`)

Before overwriting current HTML with the restored snapshot, it saves the current state
under `change_type='restore_backup'`, so a restore is itself undoable.

### Callers that do NOT currently insert revisions

- `transitionArticleStatus()` updates only `status` + `published_at`, never HTML, so no snapshot is taken. This is by design.
- `/api/articles/[id]/deploy` reads the article, generates HTML in memory, validates it, and FTP-uploads. It does not write HTML back to Supabase, so no snapshot is needed.
- Any future batch job (CTA injection, TOC rebuild, AI regeneration) that writes HTML **must** go through `updateArticle()` or explicitly call `saveRevision` first.

---

## 10.3 Retention Policy — "Only 4 Kept"

"4 versions" = current row in `articles` + up to 3 rows in `article_revisions`.

Enforcement is in `saveRevision()` itself (`article-revisions.ts:68-78`), not via a
database trigger or cron:

```ts
// after inserting the new revision
const { data: all } = await supabase
  .from('article_revisions')
  .select('id')
  .eq('article_id', articleId)
  .order('created_at', { ascending: false });

if (all && all.length > 3) {
  const toDelete = all.slice(3).map(r => r.id);
  await supabase.from('article_revisions').delete().in('id', toDelete);
}
```

Consequences:
- Retention is eventually consistent and per-insert. Two concurrent snapshots could
  briefly push the count to 5 before the delete runs.
- If `saveRevision` is bypassed, retention is not enforced — any new revision writer
  must either call `saveRevision` or replicate the prune step.
- `getRevisions()` additionally caps the read to 3 rows (`.limit(3)`), so even if stale
  rows exist, the UI never shows more than 3.

---

## 10.4 UI — View & Restore

Implemented in `src/app/(dashboard)/dashboard/articles/[id]/page.tsx`.

**Viewing** (`fetchRevisions`, lines 154-166):
- Calls `GET /api/articles/[id]/revisions` on mount.
- Renders a "バージョン履歴（直近3件）" section (lines 629-708).
- For each revision: shows `#<revNumber>`, localized `created_at`, a colored badge for
  `change_type` (`manual` / `auto` / `ai_generated` / `restore` / `publish`), and a
  100-char plaintext preview stripped from `html_snapshot`.

**Restoring** (`handleRestore`, lines 168-182):
- `window.confirm` gate ("このバージョンに復元しますか？現在の内容は上書きされます。").
- `POST /api/articles/[id]/revisions/[revisionId]/restore`.
- Page reloads on success.

Auth: both the list and restore endpoints require a Supabase-authenticated user; the
restore route uses the service-role client internally to bypass RLS for the write.

---

## 10.5 Template Validator

File: `src/lib/content/html-template-validator.ts`.

Two exports:
- `validateArticleTemplate(html)` → full `{ passed, items: TemplateCheckItem[] }` result.
- `runTemplateCheck(html)` → compact `{ passed, failures: string[] }` used by the
  deploy route.

### What it validates

**20 required-element regex checks** (all must match):
DOCTYPE, `<html lang="ja">`, `<meta charset="UTF-8">`, viewport meta, `<title>`,
canonical link, OGP title/description/image, Twitter Card, `application/ld+json` JSON-LD,
GA4 `gtag` snippet, `hub.css` reference, `siteHeader`, `breadcrumb`, `article-hero`,
`article-body`, `article-author`, `sticky-cta-bar`, and a closing `</html>`.

**6 structure checks**:
| Check | Rule |
|---|---|
| `h2_count` | at least 2 `<h2>` tags |
| `no_empty_alt` | zero `alt=""` attributes |
| `no_old_color` | no legacy color `#b39578` |
| `no_old_domain` | no legacy domain `harmony-spiritual.com` |
| `cta_structure` | every `harmony-cta` block also contains `harmony-cta-inner` |
| `body_length` | stripped plaintext ≥ 500 chars |

### When it runs

Only one call site today: `POST /api/articles/[id]/deploy` at step 2.6
(`deploy/route.ts:77-84`), **after** `runDeployChecklist` (quality gate) and **before**
the FTP upload. On failure it returns HTTP 422 with a `failures: string[]` array and the
upload is aborted — no file ever reaches the server. It runs against the freshly
generated HTML (in-memory) from `generateArticleHtml`, not against anything stored in
Supabase, so it prevents format corruption from leaving the platform rather than from
entering the DB.

---

## 10.6 Does the New Publish Button Need to Create a Revision?

**No.** The publish button's proposed semantics are a boolean toggle of public
visibility (e.g. flipping a `published`/`reviewed_at`-style flag and triggering a hub
rebuild). It **does not edit article HTML**, so the project-wide "snapshot before HTML
write" rule does not apply. Creating a revision for every visibility toggle would:

1. Consume one of the 3 retention slots with a row whose `html_snapshot` is identical
   to the current article HTML, pushing genuine content edits out of the window faster.
2. Pollute the UI history badges, mixing "content changed" with "visibility toggled"
   under a single timeline.
3. Duplicate bytes (the full HTML) on every click of a toggle that carries no content
   change — strictly worse than a dedicated event row.

### Recommended alternative — `publish_events` table

Introduce a separate append-only audit table scoped to visibility actions:

```sql
CREATE TABLE publish_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  action TEXT NOT NULL,         -- 'publish' | 'unpublish' | 'hub_rebuild'
  actor_id UUID,                -- auth.users.id
  actor_email TEXT,             -- denormalized for readability
  reason TEXT,                  -- optional note from the UI
  hub_deploy_status TEXT,       -- 'pending' | 'success' | 'failed'
  hub_deploy_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_publish_events_article ON publish_events(article_id, created_at DESC);
```

Properties:
- Append-only, no retention cap — visibility events are cheap (hundreds of bytes) and
  valuable for debugging "who unpublished article X last Thursday".
- Independent of `article_revisions`, so it never competes for history slots.
- Captures the outcome of the downstream hub-deploy, which `article_revisions` cannot
  model.
- UI can render it as a separate "公開履歴" section next to "バージョン履歴", keeping
  the two concerns visually separated.

### Edge case — if the publish toggle ever rewrites HTML

If a future iteration decides that "publish" should bake the current `stage3_final_html`
into `published_html`, or inject a publish badge into the HTML, that write **must** go
through `updateArticle()` (which snapshots automatically) or explicitly call
`saveRevision(..., 'publish')` before the update. The `publish_events` row would still
be written in addition, not instead.

---

## 10.7 Summary Matrix

| Operation | Writes HTML? | article_revisions | publish_events (proposed) |
|---|---|---|---|
| Editor save (PUT /api/articles/[id]) | yes | auto_snapshot | — |
| AI regeneration / batch HTML write | yes | required (via updateArticle) | — |
| Restore revision | yes | restore_backup | — |
| Deploy to FTP | no (reads only) | — | optional: hub_rebuild row |
| **New publish toggle** | **no** | **—** | **publish / unpublish row** |
| Review checkbox (reviewed_at flip) | no | — | (out of scope; existing flow) |
