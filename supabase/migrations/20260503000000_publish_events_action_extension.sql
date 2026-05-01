-- publish_events.action CHECK 制約拡張
-- 既存の許容値: 'publish','unpublish','hub_rebuild','ripple_regen'（initial_schema より）
-- 新規追加: batch-hide-source, batch-hide-source-sql, hallucination-retry, dangling-recovery, manual-edit

ALTER TABLE publish_events DROP CONSTRAINT IF EXISTS publish_events_action_check;
ALTER TABLE publish_events ADD CONSTRAINT publish_events_action_check
  CHECK (action IN (
    'publish',
    'unpublish',
    'hub_rebuild',
    'ripple_regen',
    'batch-hide-source',
    'batch-hide-source-sql',
    'hallucination-retry',
    'dangling-recovery',
    'manual-edit'
  ));

-- ROLLBACK:
-- ALTER TABLE publish_events DROP CONSTRAINT IF EXISTS publish_events_action_check;
-- ALTER TABLE publish_events ADD CONSTRAINT publish_events_action_check
--   CHECK (action IN ('publish','unpublish','hub_rebuild','ripple_regen'));
