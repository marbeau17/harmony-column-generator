# 17 — New "One Confirm Button" API Design

Status: **Design only.** No source changes implied by this document.
Scope: the single server endpoint that the replacement UI (see 03) will
call when the reviewer presses "公開する / 公開を取り消す" on one
article, and the companion endpoint for the bulk action.

Goal: collapse today's three client-side calls (`PUT /api/articles/[id]`
→ optimistic UI flip → fire-and-forget `POST /api/hub/deploy`) into one
server-side transaction that is **atomic from the UI's point of view**,
**idempotent**, **observably failed**, and **rolled back cleanly when
the external FTP side-effect fails**.

Related current endpoints this design replaces or wraps:

- `PUT /api/articles/[id]` — only writes `reviewed_at` today.
- `POST /api/hub/deploy` — regenerates + FTPs hub pages.
- `POST /api/articles/[id]/deploy` — uploads one article's HTML/images
  and fires a background hub rebuild.
- `POST /api/articles/update-related` — recomputes `related_articles`
  across all published rows.

---

## 1. Endpoint shape and rationale

### 1.1 Single-article endpoint

```
POST /api/articles/{id}/visibility
```

**Name rationale.**

| Candidate                                    | Verdict |
| -------------------------------------------- | ------- |
| `POST /api/articles/{id}/publish` + `/unpublish` (two routes) | Rejected. The UI has a *toggle*; forcing the client to pick a verb based on current state reintroduces the "optimistic flip then state drift" bug class from doc 03. Server-side verbs also conflict with `status='published'` which is a different flag. |
| `PUT /api/articles/{id}` with `reviewed_at` in body (current) | Rejected. Today's writer; mixes one field's write with unrelated edits. Not the atomic publish operation we want. |
| `POST /api/articles/{id}/hub-visibility`     | Clearer but longer; overlaps conceptually with `visibility`. |
| `POST /api/articles/{id}/visibility`         | **Chosen.** Noun describes *what* is being mutated (the article's public-hub visibility). Request body carries the desired state. One URL covers both directions, which is naturally idempotent on repeat calls. |

The action being modelled is *"make the desired visibility state of this
article be X, and reconcile the world to match it"*, not *"flip a bit".*
Describing it as a resource (`visibility`) and PUT/POSTing the desired
value fits that mental model.

We use `POST` (not `PUT`) because the operation has side effects beyond
the addressed resource (hub regen, related sync, FTP writes to other
paths), which HTTP PUT semantics do not cleanly cover.

### 1.2 Bulk endpoint

```
POST /api/articles/visibility:bulk
```

(colon is a sub-verb separator; compatible with Next.js route naming.)

Implemented as a separate route because:

- N separate `POST /api/articles/{id}/visibility` calls would each
  trigger the hub rebuild (currently a ~60–120s FTP op that uploads
  every category page). For N=45 articles that is ~45× wasted work and
  risks FTP rate limiting.
- The per-article endpoint always regenerates the hub at the end. The
  bulk endpoint **coalesces** into one hub regen and one related-sync
  at the end.
- Partial-failure semantics differ: per-article is all-or-nothing,
  bulk is "report per-item success, commit what succeeded".

See §8 for the bulk design.

---

## 2. Request / response contracts

### 2.1 `POST /api/articles/{id}/visibility`

**Request body** (`application/json`):

```ts
{
  visible: boolean;            // required. Desired post-call state.
  actor?: string;              // optional display name (default "小林由起子")
  // idempotency key (optional but recommended from the UI):
  requestId?: string;          // UUID/ULID; see §4
  // optional overrides — power user only, not rendered in the UI:
  skipHubRebuild?: boolean;    // default false; only used by bulk
  skipRelatedSync?: boolean;   // default false; only used by bulk
}
```

The UI always sends `visible: boolean`. `skip*` flags are for the bulk
orchestrator's internal fan-out; external clients are expected to leave
them unset.

**Success response** (`200 OK`):

```ts
{
  ok: true,
  articleId: string,
  slug: string,
  visible: boolean,            // the state after the call
  changed: boolean,            // false when already in desired state (see §4)
  steps: {
    db:           { status: "ok",        reviewed_at: string | null, revisionId: string | null },
    articleFtp:   { status: "ok" | "skipped", uploaded: number, durationMs: number } | null,
    hubFtp:       { status: "ok" | "skipped", pages: number, uploaded: number, durationMs: number },
    relatedSync:  { status: "ok" | "skipped", updated: number, durationMs: number }
  },
  warnings: string[],          // non-fatal issues (e.g. one image failed to upload)
  traceId: string              // server-generated; for log correlation
}
```

Rules:

- `steps.articleFtp` is `null` when `visible=false` (nothing to upload;
  see §5.2 for the hide path).
- `steps.articleFtp = { status: "skipped" }` when `visible=true` but
  the article was already on FTP and nothing has changed since. The
  server detects this via a content hash in `articles.deployed_hash`
  (see §4).
- `warnings[]` holds things like "1/3 images failed to re-download";
  these do **not** fail the call.

**Error response** (any non-2xx):

```ts
{
  ok: false,
  code: ErrorCode,
  message: string,             // human-readable (Japanese, for display)
  articleId: string,
  traceId: string,
  steps?: { /* same shape as success, showing what succeeded before the failure */ },
  rollback?: {
    performed: boolean,
    reason: string,
    actions: string[]          // e.g. ["reverted reviewed_at", "re-inserted revision N-1"]
  }
}
```

See §6 for the full `ErrorCode` taxonomy.

**Partial success**: there is no separate status code for partial
success. When the DB write succeeds but some FTP sub-step fails in a
way we cannot roll back (e.g. article uploaded but hub rebuild failed),
we return **`207 Multi-Status`** with `ok: false`, the fatal step
marked `"error"`, earlier steps marked `"ok"`, and `rollback.performed
= false` plus an explanation of why (typically "article already live;
manual hub redeploy required"). The client must surface this clearly.

### 2.2 `POST /api/articles/visibility:bulk` — see §8.

---

## 3. Sequence diagram — `visible = true` happy path

```
Client                             /api/articles/{id}/visibility
  │  POST { visible: true,
  │         requestId: r1 }
  │ ────────────────────────────▶  │
  │                                │ 1. auth (cookie)
  │                                │ 2. acquire pg advisory lock
  │                                │    key = hash("article-visibility:" || id)
  │                                │ 3. SELECT article FOR UPDATE
  │                                │    → existing row, reviewed_at, deployed_hash
  │                                │ 4. idempotency check:
  │                                │    if existing.visibility_request_id == r1
  │                                │       return cached prior response (200, changed:false)
  │                                │    if existing.reviewed_at != null
  │                                │       AND existing.deployed_hash == computed_hash
  │                                │       return { changed:false, steps: all "skipped" }
  │                                │
  │                                │ 5. INSERT article_revisions (snapshot pre-change)
  │                                │    (per HTML History Rule in MEMORY.md)
  │                                │
  │                                │ 6. UPDATE articles SET
  │                                │      reviewed_at = now(),
  │                                │      reviewed_by = actor,
  │                                │      visibility_request_id = r1,
  │                                │      visibility_state = 'deploying'
  │                                │
  │                                │ 7. generate article HTML (in memory)
  │                                │ 8. runDeployChecklist + runTemplateCheck
  │                                │    (both MUST pass — same gates as
  │                                │     /api/articles/{id}/deploy today)
  │                                │
  │                                │ 9. FTP upload article/*
  │                                │    (atomic per article: upload to
  │                                │     slug/.tmp-<ts>/, then rename)
  │                                │
  │                                │10. UPDATE articles SET
  │                                │      deployed_hash = computed_hash,
  │                                │      last_deployed_at = now()
  │                                │
  │                                │11. FTP upload hub (all pages)
  │                                │    (atomic: index.html.tmp → rename)
  │                                │
  │                                │12. recompute related_articles for
  │                                │    the published set; persist only
  │                                │    to DB (HTML not rewritten here)
  │                                │
  │                                │13. UPDATE articles SET
  │                                │      visibility_state = 'live'
  │                                │
  │                                │14. release advisory lock
  │                                │
  │ ◀──────────────────────────── 200 OK { ok:true, changed:true, steps:{...} }
```

Notes on steps 9 and 11: see §7 ("FTP atomicity technique").

---

## 4. Idempotency

Two layers, both required.

### 4.1 Request-ID layer (client-supplied)

The UI generates a ULID per *user click* and sends it as `requestId`.
The server writes it to `articles.visibility_request_id` on success.
A retry (same `requestId`) short-circuits at step 4 of §3 and returns
the cached prior response without re-running any side-effect.

Retention: keep the last `requestId` only; overwrite on every new
click. This protects against double-click and network retry, not
against a deliberate re-publish from another session.

### 4.2 Content-hash layer (server-computed)

Independent of `requestId`. Hash inputs:

- Article row fields that affect rendered HTML (`title`, `body`,
  `keyword`, `category`, `eyecatch_url`, `image_files`,
  `related_articles`, `cta_variants`, template version).
- The current deploy-time config (e.g. hub layout version).

Stored in `articles.deployed_hash`. On entry with `visible=true`:

- If `reviewed_at IS NOT NULL` **and** `deployed_hash` equals the
  freshly-computed hash, then the article HTML on FTP already matches
  the DB. We still check the hub: if `hub_deployed_hash` matches the
  hub inputs hash, skip hub too. Return `changed:false, steps: all
  "skipped"`.
- This makes "user clicks visible twice" a no-op even without
  `requestId`, and makes the bulk path's fan-out safe (see §8).

Caveat: for `visible=false`, the hash check does not apply. We always
run the hide path because the hub must be re-rendered without the
card. We short-circuit only if `reviewed_at IS NULL` already *and*
the hub's `deployed_hash` is current.

---

## 5. Atomicity and ordering

### 5.1 Principle

The only truly-transactional side effect is the DB write. FTP is not
transactional. The design therefore:

1. **Validates before mutating.** All quality checks, template checks,
   and image availability are confirmed *before* step 6 (`UPDATE
   articles`). A validation failure never dirties the DB.
2. **Orders mutations so the DB is authoritative.** The DB flag
   transitions through `visibility_state`:
   `idle → deploying → live` on show, or `idle → hiding → hidden`
   on hide. A process-kill mid-flight leaves the row in a `*-ing`
   state, which the next call (or a reconciler) will redrive.
3. **Writes FTP in an order where each step is independently
   recoverable.** Article upload before hub rebuild: this means a
   hub rebuild failure cannot surface a dead card (the article page
   is already reachable). Hub rebuild before related-sync: related
   links are rendered inside *other* articles' HTML, which is not
   touched by this endpoint — only the DB record is updated — so
   related-sync failure is cosmetic and non-blocking.
4. **Runs at most one copy per article at a time.** PostgreSQL
   advisory lock keyed on `hash('article-visibility:' || id)`
   (pg_try_advisory_xact_lock), acquired in step 2, released on
   transaction end. A second concurrent request returns **`409
   Conflict`** with `code: LOCKED` (see §6). The lock is per-article,
   not global, so different articles can publish in parallel.

### 5.2 `visible = false` (hide) ordering

```
2. advisory lock
3. SELECT FOR UPDATE
4. idempotency check (already hidden?)
5. INSERT article_revisions snapshot
6. UPDATE articles SET
     reviewed_at = null,
     reviewed_by = null,
     visibility_state = 'hiding'
7. FTP upload hub (article no longer appears)
8. recompute related_articles (article no longer linked)
9. UPDATE articles SET visibility_state = 'hidden'
10. release lock
```

We **do not** delete `/column/<slug>/index.html` from FTP. Rationale is
covered in doc 03 (existing behavior) and will be revisited separately;
for the purposes of this contract the endpoint only *unlists* from the
hub. The response's `steps.articleFtp` is `null`.

---

## 6. Error taxonomy and rollback rules

### 6.1 `ErrorCode` enum

| Code                       | HTTP | Meaning | Rollback policy |
| -------------------------- | ---- | ------- | --------------- |
| `UNAUTHENTICATED`          | 401  | No valid session cookie. | Nothing to roll back (no mutations attempted). |
| `NOT_FOUND`                | 404  | `articleId` not found. | None. |
| `VALIDATION_FAILED`        | 400  | Request body invalid (e.g. non-boolean `visible`). | None. |
| `LOCKED`                   | 409  | Another visibility call holds the advisory lock. | None; client may retry after backoff. |
| `QUALITY_GATE_FAILED`      | 422  | `runDeployChecklist` failed. Only on `visible=true`. | None (validation is pre-mutation). Response includes `failedChecks`. |
| `TEMPLATE_GATE_FAILED`     | 422  | `runTemplateCheck` failed. `visible=true` only. | None. Response includes `failures`. |
| `NOT_REVIEWED`             | 422  | *Reserved.* Today we gate deploy on `reviewed_at`. This endpoint makes them the same write, so this code only fires on `skipHubRebuild` abuse. | None. |
| `ARTICLE_FTP_FAILED`       | 502  | FTP upload of `slug/*` failed. | **Full rollback:** revert `articles.reviewed_at` / `reviewed_by` / `visibility_state` / `visibility_request_id` / `deployed_hash` to pre-call values using the snapshot inserted in step 5. The hub has not been touched yet, so nothing on FTP needs cleaning up beyond the abandoned `slug/.tmp-<ts>/` directory (best-effort deleted in the `finally`). |
| `HUB_FTP_FAILED`           | 207  | Article uploaded fine, hub rebuild FTP failed. | **No DB rollback.** The article is live at its direct URL; reverting `reviewed_at` would create a divergence where the file exists but the flag says it shouldn't. Instead: mark `visibility_state = 'live_hub_stale'`, surface `207 Multi-Status` with `rollback.performed = false`, and include `"manual `/api/hub/deploy` retry required"` in the warning. The UI should disable re-clicking visible=true and expose a "hub再デプロイ" button. |
| `RELATED_SYNC_FAILED`      | 207  | DB + article FTP + hub all succeeded, related-sync failed. | **No rollback; non-fatal.** `visibility_state = 'live'`, response `ok:true, warnings: ["関連記事の再計算に失敗しました"]`. Related-sync affects *other* articles' cosmetic links only. A reconciler job or next-visibility call will re-run it. |
| `CONCURRENT_MODIFICATION`  | 409  | Between SELECT FOR UPDATE and UPDATE, something else mutated the row (caught by a version check if we add one; with the advisory lock this should be unreachable from this endpoint, but still covers cross-endpoint writers like the existing `PUT /api/articles/{id}`). | Full rollback; client retries. |
| `INTERNAL`                 | 500  | Anything uncategorized. | Full rollback if the DB write already landed; otherwise none. Always include `traceId`. |

### 6.2 Rollback mechanics

The "snapshot" in step 5 is not a separate concept — it is a row in
`article_revisions` per the project's HTML History Rule (MEMORY.md).
The rollback restores the subset of columns that step 6 or step 10
mutated, using the snapshot row's values. Specifically:

- `reviewed_at`, `reviewed_by`
- `visibility_state`, `visibility_request_id`
- `deployed_hash`, `last_deployed_at`

All other columns are untouched. The snapshot row itself is kept
(it is audit history). A separate `INSERT INTO article_revisions
(..., comment = 'rollback: <code>')` follows, so the revision log
shows both the attempt and the revert.

### 6.3 What we explicitly **do not** roll back

- FTP uploads of the article folder after a hub failure (too costly;
  conflicts with the user's intent of making the article available).
- FTP uploads of the hub after a related-sync failure (related-sync
  does not touch FTP; no coupling).
- Advisory lock — released automatically by transaction end.

---

## 7. FTP atomicity technique (per step)

For each FTP sub-step, upload to a temp path under the same directory,
then rename into place. On failure, the partial tree under `.tmp-<ts>/`
is orphaned; a best-effort `client.removeDir` runs in a `finally`. This
is not cross-step atomic but it prevents a half-written `index.html`
from being served if the connection drops mid-upload.

Concretely:

- Article: upload to `/column/<slug>/.tmp-<ts>/{index.html, images/*}`,
  then `rename .tmp-<ts>/* ../`. Equivalent to today's
  `client.uploadFrom` per file, but staged.
- Hub: build the full page set in memory first (already done in
  `generateAllHubPages`), then upload each to `/column/.tmp-hub-<ts>/`,
  then rename. The hub's category pages and `index.html` thereby flip
  together, not one at a time.

This is a refinement of today's flow; it is called out here because the
atomicity guarantees in §5 and §6 depend on it. A prior upload of
`index.html` being interrupted without rename semantics would leak
mid-state even if our error taxonomy says "rolled back".

---

## 8. Bulk endpoint: `POST /api/articles/visibility:bulk`

### 8.1 When and why

The UI's bulk confirm ("N件を公開する") should call one endpoint. The
key optimization: **one hub rebuild and one related-sync at the end**,
not N.

### 8.2 Contract

Request:

```ts
{
  items: Array<{
    id: string;
    visible: boolean;
    requestId?: string;        // per-item idempotency
  }>,
  actor?: string,
  bulkRequestId?: string       // idempotency for the whole bulk call
}
```

Response (`200 OK` even with per-item failures, because the bulk call
semantically commits what succeeded):

```ts
{
  ok: true,                    // always true if the bulk ran at all
  bulkRequestId: string,
  total: number,
  succeeded: number,
  failed: number,
  items: Array<{
    id: string,
    slug: string,
    requested: boolean,        // the visible value the client asked for
    result: "ok" | "skipped" | "error",
    code?: ErrorCode,          // only when result = "error"
    message?: string,
    steps: { db: ..., articleFtp: ... }  // same shape as single endpoint;
                                         // hub/related are reported at the
                                         // top level
  }>,
  hubFtp:     { status: "ok" | "error", pages: number, uploaded: number, error?: string },
  relatedSync:{ status: "ok" | "error", updated: number, error?: string },
  traceId: string
}
```

Only HTTP 4xx/5xx when the *entire* call failed at the input stage
(auth, validation, or pre-flight DB error). Per-item errors are in
`items[].result = "error"`.

### 8.3 Execution plan

```
1. auth
2. validate body (unique ids; ≤ 100 items)
3. bulkRequestId idempotency check (stored in a new table
   `visibility_bulk_ops` keyed by bulkRequestId; cached prior
   response returned)
4. for each item (in DB order, not input order, to reduce FTP churn):
     call the SINGLE-article path internally with
     { skipHubRebuild: true, skipRelatedSync: true }
     collect result; on error, mark item failed and CONTINUE.
     (Per-item advisory lock still applies; if two bulks touch the
      same id, the second waits or returns LOCKED per item.)
5. if any item succeeded with a state change:
     run hub FTP rebuild ONCE
     run related-sync ONCE
   (both are skipped if every item was "skipped" — no visible change.)
6. write the final response to visibility_bulk_ops and return it.
```

Failure semantics:

- Any item fails → continue; aggregate at the end.
- Hub rebuild fails → response `hubFtp.status = "error"`, each
  succeeded item's `visibility_state` is set to `'live_hub_stale'`.
  The UI surfaces a "ハブ再デプロイ" CTA.
- Related-sync fails → response `relatedSync.status = "error"`. Items
  stay `'live'`; the job is non-blocking.

### 8.4 Why not N calls from the client

Pros of N calls: simpler client, reuses the per-article contract
verbatim. Cons: N hub rebuilds (each is 60–120s, full FTP of category
pages) → 1 hour wall clock for 30 items, high FTP error rate, and a
serial chain where the first hub failure blocks all later items.
**Net: bulk endpoint wins decisively.** The cost is one extra route,
one extra idempotency table, and the `skipHubRebuild` /
`skipRelatedSync` overrides on the single endpoint.

---

## 9. New DB columns required

Additive migration (design-only; to be authored under
`supabase/migrations/`):

```sql
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS visibility_state TEXT
    CHECK (visibility_state IN ('idle','deploying','live','live_hub_stale','hiding','hidden'))
    DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS visibility_request_id TEXT,
  ADD COLUMN IF NOT EXISTS deployed_hash TEXT,
  ADD COLUMN IF NOT EXISTS last_deployed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS visibility_bulk_ops (
  id              TEXT PRIMARY KEY,          -- bulkRequestId
  created_at      TIMESTAMPTZ DEFAULT now(),
  actor           TEXT,
  response_json   JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_articles_visibility_state
  ON articles (visibility_state)
  WHERE visibility_state <> 'idle';
```

`reviewed_at` and `reviewed_by` are kept as-is; this design does not
replace them, it wraps the writer.

---

## 10. OpenAPI-style spec (abridged)

```yaml
openapi: 3.1.0
info:
  title: Harmony Column — Visibility API
  version: 0.1.0

paths:
  /api/articles/{id}/visibility:
    post:
      summary: Set an article's hub visibility; reconcile DB + FTP + related.
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [visible]
              properties:
                visible:        { type: boolean }
                actor:          { type: string }
                requestId:      { type: string, description: "ULID from client for idempotency" }
                skipHubRebuild: { type: boolean, default: false }
                skipRelatedSync:{ type: boolean, default: false }
      responses:
        '200':
          description: Success (or no-op when already in desired state).
          content:
            application/json:
              schema: { $ref: '#/components/schemas/VisibilitySuccess' }
        '207':
          description: Partial success — DB landed, one FTP side-effect did not.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/VisibilityPartial' }
        '400': { $ref: '#/components/responses/ValidationFailed' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '404': { $ref: '#/components/responses/NotFound' }
        '409':
          description: LOCKED or CONCURRENT_MODIFICATION.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/VisibilityError' }
        '422':
          description: QUALITY_GATE_FAILED or TEMPLATE_GATE_FAILED.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/VisibilityError' }
        '502':
          description: ARTICLE_FTP_FAILED — full rollback performed.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/VisibilityError' }
        '500':
          description: INTERNAL.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/VisibilityError' }

  /api/articles/visibility:bulk:
    post:
      summary: Set visibility for N articles; coalesce hub rebuild + related sync.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [items]
              properties:
                items:
                  type: array
                  maxItems: 100
                  items:
                    type: object
                    required: [id, visible]
                    properties:
                      id:        { type: string, format: uuid }
                      visible:   { type: boolean }
                      requestId: { type: string }
                actor:         { type: string }
                bulkRequestId: { type: string }
      responses:
        '200':
          description: Bulk ran; see items[].result for per-item status.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/VisibilityBulkResult' }
        '400': { $ref: '#/components/responses/ValidationFailed' }
        '401': { $ref: '#/components/responses/Unauthenticated' }
        '500':
          description: INTERNAL (bulk never started).
          content:
            application/json:
              schema: { $ref: '#/components/schemas/VisibilityError' }

components:
  schemas:
    VisibilitySuccess:
      type: object
      required: [ok, articleId, slug, visible, changed, steps, traceId]
      properties:
        ok:        { const: true }
        articleId: { type: string }
        slug:      { type: string }
        visible:   { type: boolean }
        changed:   { type: boolean }
        steps:     { $ref: '#/components/schemas/Steps' }
        warnings:  { type: array, items: { type: string } }
        traceId:   { type: string }
    VisibilityPartial:
      allOf:
        - $ref: '#/components/schemas/VisibilitySuccess'
        - type: object
          properties:
            ok:       { const: false }
            code:     { $ref: '#/components/schemas/ErrorCode' }
            message:  { type: string }
            rollback:
              type: object
              properties:
                performed: { type: boolean }
                reason:    { type: string }
                actions:   { type: array, items: { type: string } }
    VisibilityError:
      type: object
      required: [ok, code, message, articleId, traceId]
      properties:
        ok:        { const: false }
        code:      { $ref: '#/components/schemas/ErrorCode' }
        message:   { type: string }
        articleId: { type: string }
        traceId:   { type: string }
        steps:     { $ref: '#/components/schemas/Steps' }
        rollback:
          type: object
          properties:
            performed: { type: boolean }
            reason:    { type: string }
            actions:   { type: array, items: { type: string } }
    Steps:
      type: object
      properties:
        db:
          type: object
          properties:
            status:      { enum: [ok, error, skipped] }
            reviewed_at: { type: [string, "null"] }
            revisionId:  { type: [string, "null"] }
        articleFtp:
          oneOf:
            - type: "null"
            - type: object
              properties:
                status:     { enum: [ok, error, skipped] }
                uploaded:   { type: integer }
                durationMs: { type: integer }
        hubFtp:
          type: object
          properties:
            status:     { enum: [ok, error, skipped] }
            pages:      { type: integer }
            uploaded:   { type: integer }
            durationMs: { type: integer }
        relatedSync:
          type: object
          properties:
            status:     { enum: [ok, error, skipped] }
            updated:    { type: integer }
            durationMs: { type: integer }
    VisibilityBulkResult:
      type: object
      required: [ok, bulkRequestId, total, succeeded, failed, items, hubFtp, relatedSync, traceId]
      properties:
        ok:            { const: true }
        bulkRequestId: { type: string }
        total:         { type: integer }
        succeeded:     { type: integer }
        failed:        { type: integer }
        items:
          type: array
          items:
            type: object
            required: [id, slug, requested, result]
            properties:
              id:        { type: string }
              slug:      { type: string }
              requested: { type: boolean }
              result:    { enum: [ok, skipped, error] }
              code:      { $ref: '#/components/schemas/ErrorCode' }
              message:   { type: string }
              steps:     { $ref: '#/components/schemas/Steps' }
        hubFtp:
          type: object
          properties:
            status:   { enum: [ok, error, skipped] }
            pages:    { type: integer }
            uploaded: { type: integer }
            error:    { type: string }
        relatedSync:
          type: object
          properties:
            status:  { enum: [ok, error, skipped] }
            updated: { type: integer }
            error:   { type: string }
        traceId:   { type: string }
    ErrorCode:
      type: string
      enum:
        - UNAUTHENTICATED
        - NOT_FOUND
        - VALIDATION_FAILED
        - LOCKED
        - QUALITY_GATE_FAILED
        - TEMPLATE_GATE_FAILED
        - NOT_REVIEWED
        - ARTICLE_FTP_FAILED
        - HUB_FTP_FAILED
        - RELATED_SYNC_FAILED
        - CONCURRENT_MODIFICATION
        - INTERNAL
  responses:
    Unauthenticated:
      description: Missing or invalid session.
      content:
        application/json:
          schema: { $ref: '#/components/schemas/VisibilityError' }
    NotFound:
      description: Article not found.
      content:
        application/json:
          schema: { $ref: '#/components/schemas/VisibilityError' }
    ValidationFailed:
      description: Request body invalid.
      content:
        application/json:
          schema: { $ref: '#/components/schemas/VisibilityError' }
```

---

## 11. Explicit rollback rule summary

| Failure point                                    | DB write landed? | FTP article landed? | FTP hub landed? | Rollback |
| ------------------------------------------------ | ---------------- | ------------------- | --------------- | -------- |
| Auth, validation, not-found, lock, quality gate  | No               | No                  | No              | None needed. |
| DB UPDATE itself fails                           | No               | No                  | No              | None needed (transaction aborts). |
| `ARTICLE_FTP_FAILED`                             | Yes (`deploying`)| No (temp dir orphaned) | No           | **Yes — full DB revert** from `article_revisions` snapshot. Best-effort remove `.tmp-<ts>/`. Return 502. |
| `HUB_FTP_FAILED` (on show path)                  | Yes              | Yes                 | No              | **No DB revert.** Set `visibility_state = 'live_hub_stale'`. Return 207. UI must show "ハブ再デプロイ". |
| `HUB_FTP_FAILED` (on hide path)                  | Yes (`hiding`)   | N/A                 | No              | **No DB revert** (user's intent was to hide; article's own page remains live per current behavior). Set `visibility_state = 'hidden_hub_stale'`. Return 207. |
| `RELATED_SYNC_FAILED`                            | Yes              | Yes                 | Yes             | **No rollback.** Return 200 with warning. Set `visibility_state = 'live'`. Reconciler re-runs. |
| Process crash between steps                      | Partial          | Maybe               | Maybe           | The next call on the same article enters with `visibility_state ∈ {deploying, hiding}`; it waits for the advisory lock (already released by crash), observes the dangling state, and redrives from the first step that is not yet "ok" per `deployed_hash` / `hub_deployed_hash`. A separate reconciler cron (out of scope here) redrives rows left in `deploying`/`hiding` > 5 min. |

---

## 12. Open questions (to resolve before implementation)

1. Should the hide path also FTP-delete `/column/<slug>/index.html`?
   Current behavior per doc 03: no. Design preserves that; flag for
   product decision.
2. `deployed_hash` inputs must include template version — where does
   that version number live? Proposal: a constant in
   `lib/generators/article-html-generator.ts`, bumped manually on
   template edits.
3. Reconciler cron for stuck `deploying`/`hiding` rows — new endpoint
   or Vercel cron hitting `/api/articles/visibility:reconcile`?
   Out of scope for this doc; call out in follow-up.
4. Rate limit policy: the advisory lock prevents per-article abuse,
   but a single user clicking bulk 30× still enqueues 30 hub rebuilds
   via the per-item fan-out if they bypass the bulk endpoint. Mitigate
   by also holding a global-mutex advisory key on the hub rebuild
   itself (`'hub-rebuild'`), so concurrent hub rebuilds from
   different sessions serialize instead of racing. This is lighter
   than a full rate limiter and sufficient for a single-editor
   workflow.
