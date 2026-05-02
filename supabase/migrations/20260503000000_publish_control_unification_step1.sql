-- ============================================================================
-- P5-43 / publish-control 統一リファクタ Step 1
-- 設計参照: docs/refactor/publish-control-unification.md §5 Step 1
-- ----------------------------------------------------------------------------
-- 目的:
--   articles.visibility_state の CHECK 制約に 'draft' / 'pending_review' を追加し、
--   公開フローの状態機械を統一する準備を行う (additive only)。
--
-- 方針:
--   * 既存データは一切変更しない (DDL のみ、DML なし)
--   * 既存の状態値 ('idle', 'deploying', 'live', 'live_hub_stale',
--     'unpublished', 'failed') はそのまま維持
--   * 'draft' / 'pending_review' を許容値として追加
--
-- 既存制約名: articles_visibility_state_check
--   (supabase/migrations/20260419000000_publish_control_v2.sql で定義)
-- ============================================================================

ALTER TABLE articles
  DROP CONSTRAINT IF EXISTS articles_visibility_state_check;

ALTER TABLE articles
  ADD CONSTRAINT articles_visibility_state_check
  CHECK (visibility_state IN (
    'idle',
    'deploying',
    'live',
    'live_hub_stale',
    'unpublished',
    'failed',
    'draft',
    'pending_review'
  ));

-- ============================================================================
-- ロールバック手順 (参考 / コメントとしてのみ記載):
--
--   ALTER TABLE articles
--     DROP CONSTRAINT IF EXISTS articles_visibility_state_check;
--
--   ALTER TABLE articles
--     ADD CONSTRAINT articles_visibility_state_check
--     CHECK (visibility_state IN (
--       'idle',
--       'deploying',
--       'live',
--       'live_hub_stale',
--       'unpublished',
--       'failed'
--     ));
--
-- 注意: ロールバック前に visibility_state IN ('draft','pending_review') の
--       行が存在しないことを確認すること (存在する場合は CHECK 違反になる)。
-- ============================================================================
