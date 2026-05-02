-- ============================================================================
-- 20260502020000_generation_jobs.sql
-- P5-22: ゼロ生成ジョブ進捗を Supabase で共有管理する。
--
-- 背景:
--   - 旧実装は os.tmpdir() (/tmp) に書き出していたが、Vercel function instance 間で
--     /tmp は共有されないため、async POST instance ≠ SSE GET instance のとき
--     "job not found" 404 が発生した。
--   - 全 instance で共有される Supabase テーブルに移すことで根治。
-- ============================================================================

CREATE TABLE IF NOT EXISTS generation_jobs (
  id          UUID PRIMARY KEY,
  user_id     UUID,
  stage       TEXT NOT NULL DEFAULT 'queued'
              CHECK (stage IN ('queued','stage1','stage2','hallucination','done','failed')),
  progress    NUMERIC NOT NULL DEFAULT 0,        -- 0.0..1.0
  eta_seconds INT NOT NULL DEFAULT 0,
  error       TEXT,
  article_id  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gen_jobs_updated
  ON generation_jobs (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_gen_jobs_stage
  ON generation_jobs (stage);

COMMENT ON TABLE generation_jobs IS
  'ゼロ生成ジョブの進捗状態 (P5-22 — 旧 fs ベースから Supabase 共有ストアへ移行)';
COMMENT ON COLUMN generation_jobs.stage IS
  'queued|stage1|stage2|hallucination|done|failed';
COMMENT ON COLUMN generation_jobs.progress IS
  '0.0〜1.0 の進捗率';

-- service role で操作するため RLS は不要だが、anon が SELECT/INSERT できないよう
-- RLS を有効化して deny-all default にする。将来 user_id ベースの policy 追加可能。
ALTER TABLE generation_jobs ENABLE ROW LEVEL SECURITY;

-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK
-- ───────────────────────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS idx_gen_jobs_stage;
-- DROP INDEX IF EXISTS idx_gen_jobs_updated;
-- DROP TABLE IF EXISTS generation_jobs;
