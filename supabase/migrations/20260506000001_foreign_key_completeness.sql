-- ============================================================================
-- 20260506000001_foreign_key_completeness.sql
-- spec v2.1 §D11〜D13: 外部キー欠落を埋める
--
-- 目的:
--   - content_plans.article_id に FK + ON DELETE CASCADE を付与
--   - generation_queue.article_id に FK + ON DELETE CASCADE を付与
--   - articles.source_article_id の FK を ON DELETE SET NULL に変更
--
-- 冪等性:
--   - 既存 FK 名を一度 DROP してから ADD CONSTRAINT で揃える
--   - データは破壊しない（参照整合性に違反する dangling 行があれば
--     COMMENT で記載した手動クリーンアップ手順を先に実行する想定）
--
-- 既存データへの警告（適用前チェック必須）:
--   ADD CONSTRAINT は既存データの整合性を検証する。dangling 行があると
--   migration がエラーで失敗するため、適用前に下記 SELECT で件数を確認すること。
--
--   -- (1) content_plans: article_id が articles に存在しない行
--   SELECT id, article_id FROM content_plans
--    WHERE article_id IS NOT NULL
--      AND article_id NOT IN (SELECT id FROM articles);
--
--   -- (2) generation_queue: article_id が articles に存在しない行
--   SELECT id, article_id FROM generation_queue
--    WHERE article_id IS NOT NULL
--      AND article_id NOT IN (SELECT id FROM articles);
--
--   -- (3) articles: source_article_id が source_articles に存在しない行
--   SELECT id, source_article_id FROM articles
--    WHERE source_article_id IS NOT NULL
--      AND source_article_id NOT IN (SELECT id FROM source_articles);
--
--   各クエリで >0 件出る場合は、当該行の article_id / source_article_id を
--   NULL に UPDATE するか、行ごと DELETE してから本マイグレーションを再実行すること。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. content_plans.article_id → articles(id) ON DELETE CASCADE
-- ----------------------------------------------------------------------------
-- 既存 (20260404200000_content_planner.sql:19) は ON DELETE 指定無しの REFERENCES。
-- 仕様 v2.1 §D11 に合わせて CASCADE を付与する。
ALTER TABLE content_plans
  DROP CONSTRAINT IF EXISTS content_plans_article_id_fkey;

ALTER TABLE content_plans
  ADD CONSTRAINT content_plans_article_id_fkey
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE;

-- ----------------------------------------------------------------------------
-- 2. generation_queue.article_id → articles(id) ON DELETE CASCADE
-- ----------------------------------------------------------------------------
-- 既存 (20260404200000_content_planner.sql:28) は ON DELETE 指定無しの REFERENCES。
-- 仕様 v2.1 §D12 に合わせて CASCADE を付与する。
ALTER TABLE generation_queue
  DROP CONSTRAINT IF EXISTS generation_queue_article_id_fkey;

ALTER TABLE generation_queue
  ADD CONSTRAINT generation_queue_article_id_fkey
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE;

-- ----------------------------------------------------------------------------
-- 3. articles.source_article_id → source_articles(id) ON DELETE SET NULL
-- ----------------------------------------------------------------------------
-- 既存 (20260404000000_initial_schema.sql:59) は ON DELETE 指定無し（≒ NO ACTION）。
-- 仕様 v2.1 §D13 に合わせ、source 記事の削除で派生記事を残しつつ参照を NULL に。
ALTER TABLE articles
  DROP CONSTRAINT IF EXISTS articles_source_article_id_fkey;

ALTER TABLE articles
  ADD CONSTRAINT articles_source_article_id_fkey
  FOREIGN KEY (source_article_id) REFERENCES source_articles(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------------------
-- ALTER TABLE content_plans DROP CONSTRAINT IF EXISTS content_plans_article_id_fkey;
-- ALTER TABLE content_plans
--   ADD CONSTRAINT content_plans_article_id_fkey
--   FOREIGN KEY (article_id) REFERENCES articles(id);
--
-- ALTER TABLE generation_queue DROP CONSTRAINT IF EXISTS generation_queue_article_id_fkey;
-- ALTER TABLE generation_queue
--   ADD CONSTRAINT generation_queue_article_id_fkey
--   FOREIGN KEY (article_id) REFERENCES articles(id);
--
-- ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_source_article_id_fkey;
-- ALTER TABLE articles
--   ADD CONSTRAINT articles_source_article_id_fkey
--   FOREIGN KEY (source_article_id) REFERENCES source_articles(id);
