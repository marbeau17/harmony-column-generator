-- Publish Control V2: single-button hub visibility
-- Spec: docs/specs/publish-control/SPEC.md §3.2
--
-- Idempotent: safe to re-run. Back-fills is_hub_visible from the existing rule
-- (status='published' AND reviewed_at IS NOT NULL). No existing row is rewritten
-- in any other column. reviewed_at is retained as audit-only (see SPEC §8.1).

-- 1. New columns on articles ---------------------------------------------------

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS is_hub_visible   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deployed_hash    TEXT,
  ADD COLUMN IF NOT EXISTS visibility_state TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS visibility_updated_at TIMESTAMPTZ;

-- state machine enum as a CHECK (avoids pg enum migration pain)
ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_visibility_state_check;
ALTER TABLE articles
  ADD CONSTRAINT articles_visibility_state_check
  CHECK (visibility_state IN ('idle','deploying','live','live_hub_stale','unpublished','failed'));

CREATE INDEX IF NOT EXISTS articles_is_hub_visible_idx
  ON articles (is_hub_visible) WHERE is_hub_visible = true;

-- 2. Back-fill -----------------------------------------------------------------
-- Exactly mirrors the existing hub-generator.ts:430 rule so no live article
-- changes its current hub presence on migration day.

UPDATE articles
   SET is_hub_visible = true,
       visibility_state = 'live'
 WHERE status = 'published'
   AND reviewed_at IS NOT NULL
   AND is_hub_visible = false;  -- idempotent

-- 3. Audit table (publish_events) ---------------------------------------------

CREATE TABLE IF NOT EXISTS publish_events (
  id                BIGSERIAL PRIMARY KEY,
  article_id        UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  action            TEXT NOT NULL
                    CHECK (action IN ('publish','unpublish','hub_rebuild','ripple_regen')),
  actor_id          UUID,
  actor_email       TEXT,
  request_id        TEXT,
  hub_deploy_status TEXT,
  hub_deploy_error  TEXT,
  reason            TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS publish_events_article_id_idx
  ON publish_events (article_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS publish_events_request_id_uniq
  ON publish_events (article_id, request_id) WHERE request_id IS NOT NULL;

-- 4. RLS: follow the project-wide "Authenticated users have full access" pattern
-- (supabase/schema.sql:178-192). Service role bypasses RLS for server-side inserts;
-- this policy gives the dashboard (authenticated client) read access.

ALTER TABLE publish_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users have full access" ON publish_events;
CREATE POLICY "Authenticated users have full access" ON publish_events
  FOR ALL USING (auth.role() = 'authenticated');

-- NOTE: the existing "Published articles are public" policy on `articles`
-- (schema.sql:195) still gates only on status='published'. Tightening it to
-- `is_hub_visible = true` is intentionally deferred — doing it here would
-- silently hide newly-published articles that were created via the legacy
-- publish path (where is_hub_visible defaults to false). The policy swap
-- happens in a follow-up migration AFTER every publish path (API, queue,
-- transition, batch scripts) writes is_hub_visible=true. See SPEC.md §4 step 7.
