-- ============================================================================
-- 20260502030000_generation_jobs_finalizing_stage.sql
-- P5-24: generation_jobs.stage に 'finalizing' を追加
-- ============================================================================

ALTER TABLE generation_jobs DROP CONSTRAINT IF EXISTS generation_jobs_stage_check;
ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_stage_check
  CHECK (stage IN (
    'queued','stage1','stage2','hallucination','finalizing','done','failed'
  ));

COMMENT ON COLUMN generation_jobs.stage IS
  'queued|stage1|stage2|hallucination|finalizing|done|failed (P5-24 拡張: finalizing = 画像 + Stage3 + meta 生成中)';

-- ROLLBACK
-- ALTER TABLE generation_jobs DROP CONSTRAINT IF EXISTS generation_jobs_stage_check;
-- ALTER TABLE generation_jobs ADD CONSTRAINT generation_jobs_stage_check
--   CHECK (stage IN ('queued','stage1','stage2','hallucination','done','failed'));
