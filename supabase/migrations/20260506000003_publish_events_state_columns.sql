-- ============================================================================
-- 20260506000003_publish_events_state_columns.sql
-- spec v2.1 §D16: publish_events に状態遷移列を追加
--
-- 目的:
--   - publish_events に before_state TEXT / after_state TEXT を追加
--   - 監査ログから「どの visibility_state からどの visibility_state に
--     遷移したか」を後追いできるようにする
--
-- 冪等性:
--   - ADD COLUMN IF NOT EXISTS で再実行安全
--   - 既存行は NULL のまま残し、書込側が遷移情報を埋める運用
-- ============================================================================

ALTER TABLE publish_events
  ADD COLUMN IF NOT EXISTS before_state TEXT,
  ADD COLUMN IF NOT EXISTS after_state  TEXT;

COMMENT ON COLUMN publish_events.before_state IS
  '遷移前の articles.visibility_state（任意。アプリ層が書込時に記録）';
COMMENT ON COLUMN publish_events.after_state IS
  '遷移後の articles.visibility_state（任意。アプリ層が書込時に記録）';

-- ----------------------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------------------
-- ALTER TABLE publish_events DROP COLUMN IF EXISTS after_state;
-- ALTER TABLE publish_events DROP COLUMN IF EXISTS before_state;
