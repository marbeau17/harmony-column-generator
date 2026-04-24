# 18 - Related-Article Ripple Sync Strategy

Scope: when the new publish-control button flips an article's visibility, every
other article whose `related_articles` JSON references the toggled article must
have its on-FTP HTML brought back in sync — because the related-article block
is rendered server-side into `/column/<slug>/index.html` at deploy time and
stays frozen on FTP until that file is re-uploaded.

This doc decides **when** the ripple runs, **how atomic** it is, and **whether
the ripple writes count as "HTML rewrites"** under the HTML-history rule
(memory: `feedback_html_history.md` — *"記事HTMLを書き換える処理は必ず
article_revisions に履歴INSERTしてから更新する"*).

Referenced code:

- `/Users/yasudaosamu/Desktop/codes/blogauto/src/lib/publish/auto-related.ts`
  — `computeAndSaveRelatedArticles(id)` recomputes the TF-IDF top-3 for a
  single article and writes `articles.related_articles` (JSON of `{href,title}`).
  `updateAllRelatedArticles()` does it for every published article. Neither
  regenerates HTML or uploads to FTP.
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/lib/generators/article-html-generator.ts`
  line 297 — `buildRelatedArticlesHtml(article.related_articles)` bakes the
  block into the final article HTML.
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/lib/db/article-revisions.ts`
  — `saveRevision(articleId, {body_html}, changeType, changedBy)`; trims to
  last 3 revisions per article. Snapshot is the full `html_snapshot`.
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/api/articles/[id]/deploy/route.ts`
  — per-article FTP upload; the operation the ripple ultimately triggers on Y.
- `/Users/yasudaosamu/Desktop/codes/blogauto/docs/specs/publish-control/03-confirm-checkbox-behavior.md`
  — current confirm-checkbox flow; this doc extends it to cover the ripple.

---

## 1. Problem statement

`articles.related_articles` is a **snapshot**: the TF-IDF selector in
`selectRelatedArticles` runs over the currently-published set at the moment
`computeAndSaveRelatedArticles` is called, stores 3 `{href,title}` entries,
and never self-invalidates. The snapshot is then inlined into the article's
HTML at deploy time.

That means when article X flips visibility, two classes of drift can appear:

**Case A — X becomes hidden (reviewed_at: timestamp → null).**
Every article Y whose stored `related_articles` array contains
`/column/<X.slug>/` still shows X as a related card. Clicking the card on
harmony-mc.com takes the reader to an article that has been pulled from the
hub index, which is confusing and also creates an inconsistency the client
explicitly flagged (*関連する記事も含め*).

**Case B — X becomes visible (reviewed_at: null → timestamp).**
The TF-IDF set that *should* now include X does not. Articles that would have
picked X as a top-3 match keep pointing at whatever third-place article they
picked before. This is the less-urgent half of the symmetry: existing cards
still resolve; they are just sub-optimal. But the user's wording —
"関連する記事も含め" — treats both directions identically, so we honor that.

The universe of Y is small: 45 published articles × top-3 related each.
In the worst case a single X appears in ~10 articles' related lists (TF-IDF
tends to cluster on frequent keywords). That is the performance ceiling we
design against.

---

## 2. Decision matrix

| Axis | Options | Chosen | Reason |
|---|---|---|---|
| Timing | (a) eager inside click (b) queue + cron/worker (c) hybrid: eager DB, lazy FTP | **(c) hybrid** | Gets user-visible correctness (DB + hub) without paying 10× FTP serially on the click. |
| Atomicity on Y-set | (a) all-or-nothing (b) best-effort, report errors | **(b) best-effort + errors[]** | Partial-publish is the correct failure mode for this domain; FTP upload is already non-transactional. |
| Revision snapshots for ripple edits | (a) always insert (b) never insert (c) insert with distinct change_type | **(c) with `change_type='ripple_related'`** | Honors the memory rule; lets cleanup trim ripple rows first if bloat shows up. |
| User feedback | (a) silent (b) block UI with progress (c) optimistic + toast summary | **(c)** | Matches the existing fire-and-forget hub-deploy feel but adds the visible error reporting spec 03 §9 said we should add. |

### 2.1 Chosen strategy, in one paragraph

On click, **synchronously** (inside the `POST /api/articles/[id]/publish`
request that flips `reviewed_at`) do: the X update, the X ripple recompute
(DB only), and the hub redeploy. **Asynchronously** (fire-and-forget to a
ripple worker endpoint) do: the Y-set HTML regeneration, revision inserts,
and FTP re-uploads. The client receives the immediate result of the DB +
hub phase and a `rippleJobId` it can poll for Y-level progress and errors.

This is strictly a superset of the spec 03 §9 "explicit 公開する / 公開を
取り消す" button — this doc specifies what happens *after* that button
commits the flip.

### 2.2 Why not fully eager

- p95 FTP upload per article is 3–8 seconds in current logs. Ten of them
  serially is 30–80 s, which blows past Vercel's 60 s default and competes
  with `/api/hub/deploy`'s own `maxDuration: 120`.
- A single stuck FTP connection would freeze the entire confirm click.
- The user's mental model at confirm time is "the article is now live"; the
  hub carries that promise. Y-regen is consistency-cleanup, not liveness.

### 2.3 Why not fully lazy

- If the ripple worker falls behind, Y-pages on FTP can point at a hidden
  X for hours. That is exactly the drift the client complained about.
- The DB half of the ripple (recomputing `related_articles` JSON for Y)
  is cheap — single TF-IDF pass, one UPDATE per Y — so there is no reason
  to defer it. Deferring only the expensive half (render + FTP) is the
  right split.

---

## 3. Impact set — how to compute Y

Two independent sets; the ripple regenerates the union.

**Y_drop (needs X removed):** articles whose **stored** `related_articles`
JSON contains X.

```sql
SELECT id, slug FROM articles
WHERE status = 'published'
  AND reviewed_at IS NOT NULL
  AND related_articles::text LIKE '%"/column/' || <X.slug> || '/"%';
```

JSONB containment (`@>`) is cleaner if we keep the stored shape as an array of
objects: `related_articles @> '[{"href":"/column/<X.slug>/"}]'::jsonb`. Prefer
that once we verify the column type.

**Y_add (should now pick X):** articles whose **recomputed** top-3 would
include X but whose stored list does not. This is unavoidably an O(N) pass:
for each published article, run `selectRelatedArticles` against the new
candidate set (which either gained or lost X), diff against stored, mark
changed.

Implementation note: `updateAllRelatedArticles()` already does the second
half's work for the whole corpus. For 45 articles the full recompute takes
<1 s. Do not try to be clever with incremental diffs — just run the full
recompute, then diff *per-article* against the pre-snapshot to build the
changed-Y set for HTML regen.

---

## 4. Pseudocode

### 4.1 Click handler — synchronous path

```ts
// POST /api/articles/[id]/publish  (new endpoint, replaces the checkbox
// onChange in spec 03)
async function publishToggle(articleId: string, makeVisible: boolean) {
  const now = new Date().toISOString();

  // 1. Flip reviewed_at on X.
  const X = await updateArticle(articleId, {
    reviewed_at: makeVisible ? now : null,
    reviewed_by: makeVisible ? '小林由起子' : null,
  });

  // 2. Snapshot the pre-ripple related_articles JSON for every published
  //    article, so we can diff after recompute and identify Y_changed.
  const before = await db.query(`
    SELECT id, slug, related_articles FROM articles
    WHERE status='published'
  `);

  // 3. DB-level ripple: recompute related_articles for every article.
  //    This is cheap (~45 articles × TF-IDF top-3) and always runs eagerly.
  await updateAllRelatedArticles();

  // 4. Diff to find Y_changed.
  const after = await db.query(/* same select */);
  const Y_changed = diffRelated(before, after); // [{id, slug, removed:[..], added:[..]}]

  // 5. Hub redeploy — the one thing users visibly judge on click.
  //    Keep this synchronous so the toast can surface its success/failure.
  const hubResult = await fetch('/api/hub/deploy', { method: 'POST' });

  // 6. Kick off the ripple worker (do not await).
  const rippleJobId = crypto.randomUUID();
  fetch('/api/articles/ripple-regen', {
    method: 'POST',
    body: JSON.stringify({ jobId: rippleJobId, targets: Y_changed, trigger: { articleId, makeVisible } }),
  }); // no await, no catch — the worker records its own state

  return { X, hubResult, rippleJobId, affected: Y_changed.length };
}
```

### 4.2 Ripple worker — `POST /api/articles/ripple-regen`

```ts
// maxDuration: 300 (5 min) — enough for ~30 sequential FTP uploads
export async function POST(req) {
  const { jobId, targets, trigger } = await req.json();

  await recordJob(jobId, { status: 'running', total: targets.length, done: 0, errors: [] });

  for (const Y of targets) {
    try {
      // Pull Y fresh — related_articles was already updated in step 3.
      const Yrow = await getArticle(Y.id);

      // Regenerate HTML from current DB state.
      const html = await renderArticleHtml(Yrow);

      // HTML-HISTORY RULE: snapshot BEFORE the UPDATE.
      await saveRevision(
        Y.id,
        { title: Yrow.title, body_html: Yrow.stage3_final_html ?? '', meta_description: Yrow.meta_description },
        'ripple_related',                                 // distinct change_type
        `ripple:${trigger.articleId}:${trigger.makeVisible ? 'show' : 'hide'}`,
      );

      // Persist new HTML.
      await updateArticle(Y.id, { stage3_final_html: html });

      // FTP upload.
      await uploadArticleToFtp(Yrow.slug, html);

      await bumpJob(jobId, { done: +1 });
    } catch (err) {
      await bumpJob(jobId, {
        errors: [`${Y.slug}: ${err.message}`],
        done: +1,
      });
      // Continue to next Y — best-effort, not all-or-nothing.
    }
  }

  await recordJob(jobId, { status: 'finished' });
}
```

### 4.3 Client polling

```ts
// After the click succeeds, poll /api/articles/ripple-regen/<jobId> every 2s
// until status=finished. Show:
//   "3件の関連記事を更新中… 2/3 完了"
// then on done:
//   success: toast "関連記事3件を更新しました"
//   partial: toast "2件更新・1件失敗 (slug-x: FTP timeout)"
//   full fail: banner with retry button calling POST /api/articles/ripple-regen again
```

---

## 5. Revisions: do ripple edits count as HTML rewrites?

**Yes.** The memory rule is unambiguous: *any* handler that rewrites article
HTML must INSERT into `article_revisions` first. The ripple worker rewrites
`stage3_final_html` and re-uploads to FTP — that is an HTML rewrite by any
reasonable reading.

Consequences and mitigations:

1. **Bloat.** Today `article_revisions` keeps the last 3 rows per article
   (see `saveRevision` trim at line 75–78 of `article-revisions.ts`). If X
   flips once and ripples to 10 articles, each of those 10 burns one of
   their 3 history slots on a ripple edit — possibly pushing out a *real*
   user-authored revision. That is a real regression for the version-history
   UX.

2. **Mitigation — distinct change_type.** Insert with
   `change_type = 'ripple_related'`. Then update the trim policy in
   `saveRevision` so that ripple rows are **evicted first** regardless of
   recency:

   ```ts
   // New trim rule (scoped to saveRevision):
   // 1. Keep at most 3 rows per article.
   // 2. When trimming, prefer to evict 'ripple_related' rows first,
   //    then fall back to oldest-first for manual rows.
   ```

   This keeps manual edits privileged while still satisfying the
   history rule on paper. The schema already supports this — no DDL
   needed, just a tweak to the existing trim query.

3. **Alternative considered — skip the snapshot.** Tempting (ripple edits
   are content-identical except for the related block, so restoring them
   has no recovery value), but the memory rule is a hard invariant. Breaking
   it here would force every future contributor to understand the
   exception. Not worth the 10 row/year savings.

4. **Alternative considered — coarser snapshot granularity.** E.g. "snapshot
   the Y-state once per ripple job, not per Y". Rejected: `saveRevision` is
   per-article by schema, and a ripple job touches multiple Ys each needing
   their own restore point. Fighting the schema here for marginal savings
   isn't worth it.

**Decision: snapshot every Y, with `change_type='ripple_related'`, and
teach `saveRevision`'s trim to evict ripple rows first.**

---

## 6. Transaction boundary & failure handling

No cross-Y transaction. Each Y is independent: `saveRevision` + UPDATE +
FTP upload, in that order. Within a Y, the three steps are ordered so that
a later failure leaves recoverable state:

- If `saveRevision` fails → abort this Y, no DB/FTP change. Report error.
- If UPDATE fails → abort this Y, the revision row is a harmless extra
  snapshot (matches pre-change state; restore is a no-op).
- If FTP upload fails → DB is ahead of FTP. Report error; the user can
  re-run the ripple job (idempotent, since running it again will re-snapshot
  and re-upload). On-disk FTP keeps its stale copy until the retry — this
  is the same behavior spec 03 already accepts for `/api/hub/deploy`.

The ripple worker **does not roll back** the X flip if Y-regen fails. The
user's click was a publish-decision; reverting it because of an FTP blip on
some unrelated Y would be the wrong failure mode. Errors bubble up via the
job status, and the user can retry the ripple independently.

---

## 7. Performance budget

Worst observed fan-out: X appears in ~10 Y articles.

| Step | Time per Y | ×10 | Notes |
|---|---|---|---|
| `saveRevision` | ~50 ms | 0.5 s | single INSERT + trim SELECT |
| `renderArticleHtml` | ~30 ms | 0.3 s | pure function |
| `updateArticle` | ~50 ms | 0.5 s | single UPDATE |
| FTP upload | 3–8 s | 30–80 s | dominant cost |

Total: 31–81 s in a background worker with `maxDuration: 300`. Well within
budget. If it ever isn't (≥30 Y), batch the FTP uploads in parallel with
`Promise.allSettled` at concurrency 3 — the shared FTP client can handle
it (already does in the bulk deploy path). Start sequential; add concurrency
only if metrics show a need.

For the synchronous click half (steps 1–5 in §4.1): `updateAllRelatedArticles`
on 45 articles benches at <1 s, and `POST /api/hub/deploy` is the existing
~10 s ceiling. Total click-to-toast: ~12 s. Same order as today.

---

## 8. Open questions for follow-up specs

- **Ripple job persistence.** Pseudocode uses an opaque `recordJob` /
  `bumpJob` store. Concretize: either a new `ripple_jobs` table, or reuse
  `article_revisions` comment-as-JSON trick. Defer to the endpoint spec.
- **Retry UX.** A partial failure toast should have a "再試行" button that
  calls `POST /api/articles/ripple-regen` with the failed-only subset.
  Out of scope here.
- **Rate limiting.** If the user mashes the button 10×, we queue 10 ripple
  jobs. A simple "only one ripple job in flight per X" gate at the worker
  is enough. Defer.
- **Test coverage.** A diff harness: fixture a 45-article DB, flip one X,
  assert that exactly the expected Y-set changed HTML and exactly those Ys
  got new revisions with `change_type='ripple_related'`. Write once,
  protects the invariant forever.
