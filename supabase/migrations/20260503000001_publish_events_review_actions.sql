-- ============================================================================
-- P5-43 Step 3 / Writers Migration: publish_events.action に review 系 3 種追加
-- 設計参照: docs/refactor/publish-control-unification.md §6.1
-- ============================================================================
-- 既存 actions (20260503000000_publish_events_action_extension.sql 時点):
--   'publish','unpublish','hub_rebuild','ripple_regen',
--   'batch-hide-source','batch-hide-source-sql',
--   'hallucination-retry','dangling-recovery','manual-edit'
-- 追加 actions:
--   'review_submit'  : 下書きをレビュー待ちへ提出
--   'review_approve' : レビュー承認
--   'review_reject'  : レビュー差し戻し
-- ============================================================================
-- DDL のみ。DML は一切含まない。
-- ============================================================================

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
    'manual-edit',
    'review_submit',
    'review_approve',
    'review_reject'
  ));

-- ============================================================================
-- ROLLBACK 手順:
--   本マイグレーションを取り消す場合、直前のマイグレーション
--   (20260503000000_publish_events_action_extension.sql) と同じ制約に戻す。
--   ただし review_* レコードが既に投入済みであれば、先にそれらを退避/削除する
--   こと（CHECK 違反で ADD CONSTRAINT が失敗する）。
--
--   ALTER TABLE publish_events DROP CONSTRAINT IF EXISTS publish_events_action_check;
--   ALTER TABLE publish_events ADD CONSTRAINT publish_events_action_check
--     CHECK (action IN (
--       'publish',
--       'unpublish',
--       'hub_rebuild',
--       'ripple_regen',
--       'batch-hide-source',
--       'batch-hide-source-sql',
--       'hallucination-retry',
--       'dangling-recovery',
--       'manual-edit'
--     ));
-- ============================================================================
