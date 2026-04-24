# 09 — DB Schema Reference for Publish Control

**Scope.** Complete, annotated reference of every Supabase table that touches the
article lifecycle and hub publishing. Derived by reading every file under
`supabase/migrations/` (including the untracked `20260407000000_add_quality_check.sql`)
plus the corroborating access layer in `src/lib/db/` and `src/lib/generators/hub-generator.ts`.

- **READ-ONLY reference.** No migrations were executed. No connection was made to Supabase.
- **Source of truth for this doc:** the migration files. Where the live DB diverges from
  a migration (there is a known drift on `article_revisions`), both shapes are documented.

Migrations applied, in order:

| # | File | Purpose |
|---|---|---|
| 1 | `20260404000000_initial_schema.sql` | Core tables: `source_articles`, `personas`, `themes`, `articles`, `article_revisions`, `generation_logs`, `settings` + RLS |
| 2 | `20260404100000_add_theme_category.sql` | `source_articles.theme_category` |
| 3 | `20260404200000_content_planner.sql` | `content_plans`, `generation_queue` |
| 4 | `20260405000000_add_usage_count.sql` | `source_articles.usage_count` |
| 5 | `20260407000000_add_quality_check.sql` | `articles.quality_check` (JSONB) — untracked on disk |
| 6 | `20260415000000_add_reviewed_columns.sql` | `articles.reviewed_at`, `articles.reviewed_by` + filtered index |
| 7 | `20260417000000_article_revisions.sql` | Attempted recreation of `article_revisions` with new columns — **see drift note below** |

---

## 1. `articles` — main column-article table

Created in `20260404000000_initial_schema.sql`; evolved by migrations 5 and 6.
This is the single row per generated column article. Every field below reflects
the union of all migrations applied to it.

```sql
CREATE TABLE articles (
  -- ── identity ──────────────────────────────────────────────────────────
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_number      SERIAL,                           -- human-friendly sequential #
  slug                TEXT UNIQUE,                      -- URL slug (also used as filename fallback)
  seo_filename        TEXT,                             -- filename when deployed to FTP (`<slug>.html` fallback)

  -- ── lifecycle ─────────────────────────────────────────────────────────
  status              TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft','outline_pending','outline_approved',
      'body_generating','body_review','editing','published'
    )),                                                 -- FSM stage. Transitions enforced in code
                                                         -- (src/lib/db/articles.ts VALID_TRANSITIONS).
  reviewed_at         TIMESTAMPTZ,                      -- ★ Yukiko approval timestamp. NULL = not yet reviewed.
  reviewed_by         TEXT,                             -- free-text reviewer name (usually "小林由起子")
  published_at        TIMESTAMPTZ,                      -- Auto-set when status transitions to 'published'.
                                                         -- See transitionArticleStatus() in src/lib/db/articles.ts:262.
  published_url       TEXT,                             -- Final live URL after FTP deploy (nullable).

  -- ── provenance ────────────────────────────────────────────────────────
  source_article_id   UUID REFERENCES source_articles(id),
  perspective_type    TEXT,                             -- e.g. 'empathy','reframe','expansion'

  -- ── editorial metadata ────────────────────────────────────────────────
  title               TEXT,
  meta_description    TEXT,
  keyword             TEXT,                             -- primary SEO keyword
  theme               TEXT,                             -- used for hub category filter (`?filter=<theme>`)
  persona             TEXT,
  target_word_count   INTEGER DEFAULT 2000,

  -- ── generated content (per-stage) ─────────────────────────────────────
  stage1_outline        JSONB,
  stage1_image_prompts  JSONB,
  stage2_body_html      TEXT,                           -- body draft after body_generating
  stage3_final_html     TEXT,                           -- final edited body (preferred when present)
  published_html        TEXT,                           -- full-page HTML actually shipped (may include template chrome)

  -- ── SEO / AIO ─────────────────────────────────────────────────────────
  faq_data            JSONB,
  structured_data     JSONB,
  seo_score           JSONB,
  aio_score           JSONB,
  quick_answer        TEXT,

  -- ── images ────────────────────────────────────────────────────────────
  image_prompts       JSONB,
  image_files         JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{filename,...}]; first entry = hub card thumbnail

  -- ── CTA / related ─────────────────────────────────────────────────────
  cta_texts           JSONB,                            -- 3× CTA texts required by spec
  related_articles    JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- ── quality gate (migration 5) ────────────────────────────────────────
  quality_check       JSONB,                            -- {passed, score, items[], summary, checkedAt, errorCount, warningCount}

  -- ── ops ───────────────────────────────────────────────────────────────
  ai_generation_log   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()   -- refreshed by trigger articles_updated_at
);
```

### Visibility / publish / review fields on `articles` — exact semantics

| Column | Set by | Meaning | Source of truth for…? |
|---|---|---|---|
| `status` | `transitionArticleStatus()` — validated FSM | Pipeline stage. `'published'` is the terminal value. | **Pipeline stage.** NOT alone sufficient for hub visibility. |
| `reviewed_at` | Dashboard toggle (articles list / detail page) | Yukiko-san's personal approval. NULL ⇒ NOT approved. | **Editorial approval.** Hub queries literally use `.not('reviewed_at','is',null)` as the gate. |
| `reviewed_by` | Same toggle, mirror of `reviewed_at` | Who approved (string, usually "小林由起子"). | Audit-only. |
| `published_at` | Auto-set by `transitionArticleStatus` at the moment `status→'published'` | When the record *entered* published state. | **Hub sort key** (`ORDER BY published_at DESC`). Not a visibility gate on its own. |
| `published_url` | Set by deploy route after successful FTP upload | Absolute URL where the article is actually reachable. Nullable even after publish. | Only reliable indicator that FTP deploy succeeded. NOT consulted by hub generator today. |
| `published_html` | Set by deploy route | Full HTML actually written to the server. | Historical/archive. Not consulted at read time. |
| `quality_check.passed` (inside JSONB) | `POST /api/articles/[id]/quality-check` | Template/structure gate result. | Advisory; deploy route also calls `html-template-validator` as a hard gate. |

**There is no `deployed_at`, `is_published`, `is_visible`, or `visibility` column.**
The hub read path (`buildArticleCards` in `src/lib/generators/hub-generator.ts:424`)
enforces visibility with exactly two predicates:

```ts
.eq('status', 'published')
.not('reviewed_at', 'is', null)
```

The same two-predicate gate is repeated in:
- `src/app/column/page.tsx:80` (public hub SSR)
- `src/app/column/[slug]/page.tsx:31` (public article SSR)
- `src/app/sitemap.ts:37` (sitemap.xml)

### Indexes on `articles`

```sql
CREATE INDEX idx_articles_status        ON articles(status);
CREATE INDEX idx_articles_created       ON articles(created_at DESC);
CREATE INDEX idx_articles_source        ON articles(source_article_id);
CREATE INDEX idx_articles_slug          ON articles(slug);
CREATE INDEX idx_articles_reviewed_at   ON articles(reviewed_at)
  WHERE reviewed_at IS NOT NULL;           -- partial index: speeds up hub visibility filter
```

### Constraints on `articles`

- `PRIMARY KEY (id)`
- `UNIQUE (slug)`
- `CHECK (status IN (...))` — enumerated FSM (see above)
- `FOREIGN KEY (source_article_id) REFERENCES source_articles(id)` (ON DELETE: default = NO ACTION)
- RLS: authenticated users have full access; anonymous users get SELECT only when `status='published'`
  (note: this RLS policy does **not** also require `reviewed_at IS NOT NULL` — the filter is
  layered in the application query. That is a possible tightening point.)

### Triggers on `articles`

```sql
CREATE TRIGGER articles_updated_at
  BEFORE UPDATE ON articles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();   -- sets NEW.updated_at = NOW()
```

---

## 2. `article_revisions` — version history

**⚠ Known drift between migration and live DB.** This matters for publish-control design.

- Migration `20260404000000_initial_schema.sql` created the **original** table with
  columns: `id, article_id, revision_number, html_snapshot, change_type, changed_by, comment, created_at`.
- Migration `20260417000000_article_revisions.sql` (commit `bf184be`) **tried to recreate** it
  with a different shape (`title, body_html, meta_description`). Because `CREATE TABLE IF NOT EXISTS`
  is a no-op against the existing table, this migration did NOT change column shape in the live DB.
- Commit `b5d3037` ("Fix article-revisions to match existing DB schema (html_snapshot, comment)")
  updated the access layer to conform to the original columns: `title` and `meta_description` are
  packed as JSON into the `comment` field. See `src/lib/db/article-revisions.ts` (`packComment`/`unpackComment`).

**Authoritative live schema (what the code actually reads/writes):**

```sql
CREATE TABLE article_revisions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id       UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  revision_number  INTEGER NOT NULL,              -- monotonically increasing per article_id
  html_snapshot    TEXT,                          -- body HTML at time of snapshot (stage3 preferred, fallback stage2)
  change_type      TEXT,                          -- 'auto_snapshot' | 'manual_save' | 'restore_backup' | free text
  changed_by       TEXT,                          -- reviewer/editor name, nullable
  comment          TEXT,                          -- JSON-packed: {"title":..., "meta_description":...}
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Retention rule (application-enforced, not a DB trigger):** `saveRevision()` keeps only the
most recent 3 rows per `article_id` and deletes the rest after each insert
(`src/lib/db/article-revisions.ts:75`).

**Snapshot trigger points (application-enforced):**
1. `updateArticle()` auto-snapshots *before* it overwrites any of `title`,
   `stage2_body_html`, `stage3_final_html`, `meta_description` — but only if the incoming
   value actually differs (prevents auto-save noise). `change_type='auto_snapshot'`.
2. `restoreRevision()` snapshots the current state first with `change_type='restore_backup'`,
   then overwrites from the chosen revision.

### Indexes on `article_revisions`

```sql
CREATE INDEX idx_revisions_article ON article_revisions(article_id, revision_number);
-- Migration 20260417 also tried to add (article_id, created_at DESC); may or may not exist
-- depending on whether `CREATE INDEX IF NOT EXISTS` fired. Harmless either way.
```

### Constraints on `article_revisions`

- `PRIMARY KEY (id)`
- `FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE`
- RLS: authenticated-only full access.

---

## 3. `source_articles` — 元記事 (Ameblo imports)

```sql
CREATE TABLE source_articles (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title                TEXT NOT NULL,
  content              TEXT NOT NULL,
  original_url         TEXT,
  published_at         TIMESTAMPTZ,            -- note: original Ameblo publish date, NOT our publish date
  word_count           INTEGER DEFAULT 0,
  themes               TEXT[] DEFAULT '{}',
  keywords             TEXT[] DEFAULT '{}',
  emotional_tone       TEXT,
  spiritual_concepts   TEXT[] DEFAULT '{}',
  is_processed         BOOLEAN NOT NULL DEFAULT FALSE,  -- set to true once a column article references this row
  theme_category       TEXT,                   -- added by migration 2
  usage_count          INTEGER NOT NULL DEFAULT 0,      -- added by migration 4; bumped each time used as a source
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- trigger source_articles_updated_at
);

CREATE INDEX idx_source_articles_title         ON source_articles(title);
CREATE INDEX idx_source_articles_processed     ON source_articles(is_processed);
CREATE INDEX idx_source_articles_theme         ON source_articles(theme_category);
CREATE INDEX idx_source_articles_usage_count   ON source_articles(usage_count ASC);   -- fair-use ordering
```

- `is_processed` is the only "boolean state" column on this table. It has no visibility
  semantics for the public hub — it is purely to prevent re-consuming the same source.
- The one-source → one-article rule is enforced in application code (`createArticle`
  rejects if another non-deleted article already references the same `source_article_id`).

---

## 4. `content_plans` / `generation_queue` — planning + worker

These do not affect hub visibility directly but are part of the publish pipeline.

```sql
CREATE TABLE content_plans (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id             TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','approved','rejected','generating','completed','failed')),
  theme                TEXT NOT NULL,
  persona              TEXT NOT NULL,
  keyword              TEXT NOT NULL,
  sub_keywords         TEXT[] DEFAULT '{}',
  perspective_type     TEXT NOT NULL,
  source_article_ids   UUID[] DEFAULT '{}',
  target_word_count    INTEGER DEFAULT 2000,
  predicted_seo_score  INTEGER,
  proposal_reason      TEXT,
  article_id           UUID REFERENCES articles(id),   -- populated after generation starts
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- trigger content_plans_updated_at
);

CREATE TABLE generation_queue (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id        UUID REFERENCES content_plans(id) ON DELETE CASCADE,
  article_id     UUID REFERENCES articles(id),
  step           TEXT NOT NULL DEFAULT 'pending'
    CHECK (step IN ('pending','outline','body','images','seo_check','completed','failed')),
  priority       INTEGER DEFAULT 0,
  error_message  TEXT,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_plans_batch      ON content_plans(batch_id);
CREATE INDEX idx_plans_status     ON content_plans(status);
CREATE INDEX idx_queue_step       ON generation_queue(step);
CREATE INDEX idx_queue_priority   ON generation_queue(priority DESC);
```

---

## 5. `generation_logs`, `settings`, `personas`, `themes`

Supporting tables; no publish/visibility semantics. Reproduced for completeness.

```sql
CREATE TABLE generation_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id      UUID REFERENCES articles(id) ON DELETE SET NULL,
  stage           TEXT NOT NULL,
  step            TEXT,
  model           TEXT,
  temperature     REAL,
  token_usage     JSONB,
  duration_ms     INTEGER,
  success         BOOLEAN NOT NULL DEFAULT TRUE,
  error_message   TEXT,
  raw_output      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_generation_logs_article ON generation_logs(article_id);

CREATE TABLE settings (
  key          TEXT PRIMARY KEY,
  value        JSONB NOT NULL,
  description  TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE personas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL UNIQUE,
  age_range        TEXT,
  description      TEXT,
  search_patterns  TEXT[] DEFAULT '{}',
  tone_guide       TEXT,
  cta_approach     TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,     -- is_* flag — master-data enable/disable only
  sort_order       INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE themes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL UNIQUE,
  slug           TEXT NOT NULL UNIQUE,
  category       TEXT,
  energy_method  TEXT,
  description    TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,       -- is_* flag — master-data enable/disable only
  sort_order     INTEGER DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 6. Hub-related table?

**There is no dedicated `hub`, `hub_articles`, `hub_cards`, or equivalent table.**
The hub page is derived entirely from `articles` at read time. The complete visibility
query (`src/lib/generators/hub-generator.ts:424`) is:

```sql
SELECT id, title, slug, seo_filename, meta_description,
       stage2_body_html, stage3_final_html, theme,
       published_at, image_files
FROM articles
WHERE status = 'published'
  AND reviewed_at IS NOT NULL
ORDER BY published_at DESC;
```

The only hub-adjacent derived value is **category filtering**, which uses
`articles.theme` via a URL query string (`?filter=<theme>`) — no DB index; the filter
is client-side in the hub HTML.

---

## 7. RLS summary

All relevant tables have RLS enabled. The consistent policy is:

```sql
-- Authenticated users (= logged-in dashboard) have full CRUD
CREATE POLICY "Authenticated users have full access" ON <table>
  FOR ALL USING (auth.role() = 'authenticated');
```

Only `articles` has an additional public-read policy:

```sql
CREATE POLICY "Published articles are public" ON articles
  FOR SELECT USING (status = 'published');
```

**Note the mismatch:** the public-read RLS policy gates on `status='published'` alone,
whereas application queries additionally require `reviewed_at IS NOT NULL`. If anything
ever queried Supabase from the public anon role without that app-level filter, it would
leak unreviewed articles. Candidate hardening: tighten the RLS to
`status = 'published' AND reviewed_at IS NOT NULL`.

---

## 8. Appendix — field-by-field publish/visibility semantics cheat sheet

| Field | Table | What it means | Who writes it | Hub uses it? |
|---|---|---|---|---|
| `status` | articles | FSM stage | `transitionArticleStatus` | Yes (WHERE status='published') |
| `reviewed_at` | articles | Yukiko approval timestamp | Dashboard toggle (articles list/detail) | Yes (WHERE reviewed_at IS NOT NULL) |
| `reviewed_by` | articles | Reviewer name | Dashboard toggle, mirror of reviewed_at | No (audit only) |
| `published_at` | articles | Entered 'published' at this time | `transitionArticleStatus` auto | Yes (ORDER BY) |
| `published_url` | articles | FTP deploy URL | deploy route | No |
| `published_html` | articles | Shipped full-page HTML | deploy route | No |
| `quality_check` | articles | Checklist result JSONB | `/api/articles/[id]/quality-check` | No (advisory) |
| `source_article_id` | articles | 1:1 link to 元記事 | createArticle | No |
| `is_processed` | source_articles | Source has been consumed | createArticle side-effect | No |
| `is_active` | personas / themes | Master-data enable | admin UI | Indirectly (controls selectable values) |
