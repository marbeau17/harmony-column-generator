-- ============================================================================
-- 20260506000002_index_and_trigger.sql
-- spec v2.1 §D14, §D15, §D22: 単独 INDEX 追加 + 自動更新 TRIGGER
--
-- 目的:
--   - article_claims.article_id 単独 INDEX 追加（既存は (article_id, risk) のみ）
--   - generation_jobs.updated_at の自動更新 TRIGGER
--   - articles.is_hub_visible ↔ visibility_state の同期 TRIGGER
--
-- 冪等性:
--   - INDEX, FUNCTION, TRIGGER とも IF NOT EXISTS / OR REPLACE / DROP IF EXISTS
--     を使って再実行可能にする
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. article_claims.article_id 単独 INDEX
-- ----------------------------------------------------------------------------
-- 既存は (article_id, risk) の複合 INDEX のみ。
-- persist-claims の DELETE WHERE article_id = $1 や、
-- 「記事ごとの全 claim 取得」など risk 列を伴わないクエリでは
-- 単独 INDEX の方が効率的なため追加する。
CREATE INDEX IF NOT EXISTS idx_article_claims_article
  ON article_claims (article_id);

-- ----------------------------------------------------------------------------
-- 2. generation_jobs.updated_at の自動更新 TRIGGER
-- ----------------------------------------------------------------------------
-- 既存スキーマ (20260502020000_generation_jobs.sql) では updated_at は
-- DEFAULT NOW() のみで UPDATE 時に自動更新されない。
-- spec v2.1 §D22 に合わせ、行更新のたびに NOW() を書き込む。
CREATE OR REPLACE FUNCTION update_generation_jobs_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_gen_jobs_updated ON generation_jobs;
CREATE TRIGGER tg_gen_jobs_updated
  BEFORE UPDATE ON generation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_generation_jobs_timestamp();

-- ----------------------------------------------------------------------------
-- 3. articles.is_hub_visible ↔ visibility_state の同期 TRIGGER
-- ----------------------------------------------------------------------------
-- spec v2.1 §D15:
--   visibility_state ∈ ('live','live_hub_stale') ⇔ is_hub_visible = true
-- アプリ層のみで担保していた不変条件を DB 側にも組み込み、
-- 不整合（visibility_state='unpublished' ∧ is_hub_visible=true 等）を構造的に防ぐ。
--
-- 注意:
--   - BEFORE INSERT OR UPDATE OF visibility_state を使って
--     visibility_state を書く全パスを捕捉する
--   - is_hub_visible を直接書こうとした値は上書きする
--     （アプリ側が両方書いていた場合でも結果は state ベースで一貫）
CREATE OR REPLACE FUNCTION sync_is_hub_visible()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.is_hub_visible := NEW.visibility_state IN ('live','live_hub_stale');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_articles_sync_visibility ON articles;
CREATE TRIGGER tg_articles_sync_visibility
  BEFORE INSERT OR UPDATE OF visibility_state ON articles
  FOR EACH ROW
  EXECUTE FUNCTION sync_is_hub_visible();

-- 既存行の back-fill（不変条件を満たさない行があれば一度だけ揃える）。
-- TRIGGER は INSERT / UPDATE OF visibility_state でのみ発火するため、
-- 既存行は明示的に「触らないと」整合しない。1 度きりの正規化として実施する。
UPDATE articles
   SET is_hub_visible = (visibility_state IN ('live','live_hub_stale'))
 WHERE is_hub_visible <> (visibility_state IN ('live','live_hub_stale'));

-- ----------------------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------------------
-- DROP TRIGGER IF EXISTS tg_articles_sync_visibility ON articles;
-- DROP FUNCTION IF EXISTS sync_is_hub_visible();
-- DROP TRIGGER IF EXISTS tg_gen_jobs_updated ON generation_jobs;
-- DROP FUNCTION IF EXISTS update_generation_jobs_timestamp();
-- DROP INDEX IF EXISTS idx_article_claims_article;
