-- ============================================================================
-- 20260502000000_quality_overrides.sql
-- P5-19 Auto-Fix 機能用: 品質チェック警告の手動無視 (override) を articles
-- テーブルに JSONB 配列で永続化する。
--
-- データ形:
-- [
--   {
--     "check_item_id": "soft_ending_ratio",
--     "ignored_at": "2026-05-02T13:30:00Z",
--     "reason": "誤検出のため運用判断で無視",
--     "ignored_by": "uuid"
--   }
-- ]
-- ============================================================================

ALTER TABLE articles
ADD COLUMN IF NOT EXISTS quality_overrides JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN articles.quality_overrides IS
'{check_item_id, ignored_at, reason, ignored_by} の配列。品質チェック警告を手動で無視した記録 (P5-19 Auto-Fix)';

-- インデックスは GIN を一応用意（jsonb path queries 用、size 小なので影響小）
CREATE INDEX IF NOT EXISTS idx_articles_quality_overrides
ON articles USING GIN (quality_overrides);

-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK
-- ───────────────────────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS idx_articles_quality_overrides;
-- ALTER TABLE articles DROP COLUMN IF EXISTS quality_overrides;
