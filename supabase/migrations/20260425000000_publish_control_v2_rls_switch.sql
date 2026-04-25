-- ============================================================================
-- Publish Control V2 — Step 8: RLS Policy Switch
-- ============================================================================
-- Purpose: Switch the source of truth for hub visibility from `articles.status`
-- to `articles.is_hub_visible`. Anonymous users will only see articles where
-- is_hub_visible = true (back-filled by migration 20260419 for the 15
-- reviewed articles).
--
-- Pre-condition: step7 完了済（全公開経路で is_hub_visible が同期書込されている）
--   - src/app/api/articles/[id]/visibility/route.ts
--   - src/lib/db/articles.ts::transitionArticleStatus()
--   - src/app/api/queue/process/route.ts
--
-- Post-condition: anon SELECT が is_hub_visible=true の記事に限定される
--
-- This migration is idempotent (DROP IF EXISTS + CREATE).
-- ============================================================================

DROP POLICY IF EXISTS "Published articles are public" ON articles;

CREATE POLICY "Published articles are public" ON articles
  FOR SELECT
  USING (is_hub_visible = true);

-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- 旧ポリシー（status='published' 基準）に戻す場合は以下を実行:
--
--   DROP POLICY IF EXISTS "Published articles are public" ON articles;
--   CREATE POLICY "Published articles are public" ON articles
--     FOR SELECT
--     USING (status = 'published');
--
-- 本番適用後の異常検知（48h 監視）でロールバックが必要な場合は上記を psql
-- 経由または Supabase ダッシュボード SQL Editor で実行する。
-- ============================================================================
