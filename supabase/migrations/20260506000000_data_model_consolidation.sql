-- ============================================================================
-- 20260506000000_data_model_consolidation.sql
--
-- 目的: spec v2.1 §2.4 D1〜D4 の P0 データ整合性修正を一括適用する。
--   D1: article_revisions の二重定義（initial_schema と 20260417 の重複）を統合
--   D2: スキーマを「コード src/lib/db/article-revisions.ts」が期待する
--       (html_snapshot + comment JSON pack) 方式に統一
--   D3: generation_jobs に明示的な service_role_only ポリシーを追加
--   D4: cta_variants に UNIQUE (article_id, position) 制約を追加
--
-- 設計方針:
--   - 既存データを破壊しない。article_revisions に行が残っている場合は
--     RAISE EXCEPTION で migration を即座に失敗させ、運用者にデータ確認を促す。
--   - cta_variants も (article_id, position) で重複があれば UNIQUE 追加が
--     失敗するため、事前に重複検出 SELECT を実行し RAISE EXCEPTION で警告。
--   - DROP TABLE article_revisions CASCADE は安全 guard 通過後にのみ実行。
--
-- ロールバック:
--   - 本 migration は破壊的（DROP TABLE）ではあるが空テーブル前提で実行されるため
--     再構築が容易。最下段の ROLLBACK セクションを手動実行することで
--     旧二重定義状態へ戻せる（ただし comment 列を含む新スキーマは失われる）。
--
-- 警告:
--   - 既存環境で article_revisions に履歴行が存在する場合、本 migration は
--     即座に失敗する。運用者は事前にバックアップを取得し、行件数 0 を確認すること。
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Safety Guard 1: article_revisions に既存データがあれば失敗させる
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_count BIGINT := 0;
BEGIN
  -- 既存テーブルが存在する場合のみ件数チェック（初回適用環境を考慮）
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'article_revisions'
  ) THEN
    EXECUTE 'SELECT COUNT(*) FROM article_revisions' INTO v_count;
    IF v_count > 0 THEN
      RAISE EXCEPTION
        'D1/D2 safety guard: article_revisions に % 行のデータが存在します。DROP TABLE CASCADE を実行する前に、運用者が手動でバックアップ・確認してください。本 migration は中断されました。',
        v_count;
    END IF;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Safety Guard 2: cta_variants の (article_id, position) 重複を事前検出
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_dup_count BIGINT := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'cta_variants'
  ) THEN
    EXECUTE $sql$
      SELECT COUNT(*) FROM (
        SELECT article_id, position
        FROM cta_variants
        WHERE position IS NOT NULL
        GROUP BY article_id, position
        HAVING COUNT(*) > 1
      ) AS dups
    $sql$ INTO v_dup_count;
    IF v_dup_count > 0 THEN
      RAISE EXCEPTION
        'D4 safety guard: cta_variants に (article_id, position) で重複している行が % 組存在します。UNIQUE 制約追加前に、運用者が重複を解消してください。本 migration は中断されました。',
        v_dup_count;
    END IF;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D1 + D2: article_revisions テーブルを統合再定義
--   - 旧定義(initial_schema):  html_snapshot, change_type, changed_by, comment
--   - 旧定義(20260417):        body_html, title, meta_description, change_type, changed_by
--   - コード期待スキーマ:      html_snapshot + comment(JSON pack で title/meta を内包)
--   - v2.1 統合方針: コード側が html_snapshot を参照しているため、こちらに統一。
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS article_revisions CASCADE;

CREATE TABLE article_revisions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id       UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  revision_number  INTEGER NOT NULL DEFAULT 1,
  html_snapshot    TEXT NOT NULL,
  change_type      TEXT NOT NULL DEFAULT 'manual_save',
  changed_by       TEXT,
  comment          TEXT,                                    -- v2.1: title/meta_description を JSON pack
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT article_revisions_article_revision_uniq
    UNIQUE (article_id, revision_number)
);

-- 履歴一覧取得用（最新順）
CREATE INDEX idx_article_revisions_article_created
  ON article_revisions (article_id, created_at DESC);

-- 互換用 INDEX（revision_number 検索）
CREATE INDEX idx_article_revisions_article_revno
  ON article_revisions (article_id, revision_number);

COMMENT ON TABLE article_revisions IS
  '記事バージョン履歴（最新 3 件保持・v2.1 で二重定義統合）';
COMMENT ON COLUMN article_revisions.html_snapshot IS
  '更新直前の本文 HTML スナップショット';
COMMENT ON COLUMN article_revisions.comment IS
  '{"title":"...","meta_description":"..."} 形式の JSON pack（コード src/lib/db/article-revisions.ts と整合）';

-- RLS（authenticated に一括許可・単一テナント前提）
ALTER TABLE article_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users have full access" ON article_revisions
  FOR ALL USING (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────────────────────────────
-- D3: generation_jobs RLS 明示ポリシー（service_role のみ・全拒否）
--   - 旧状態: ENABLE ROW LEVEL SECURITY のみで POLICY 未定義 → デフォルト全拒否
--   - service_role は RLS をバイパスするため運用上は機能していたが
--     監査明確化のため CREATE POLICY を追加する（spec v2.1 §2.3）。
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "service_role_only" ON generation_jobs;
CREATE POLICY "service_role_only" ON generation_jobs
  FOR ALL
  USING (FALSE);

COMMENT ON POLICY "service_role_only" ON generation_jobs IS
  'service_role のみアクセス許可（USING(FALSE) で他ロールは全拒否・v2.1 D3）';

-- ─────────────────────────────────────────────────────────────────────────────
-- D4: cta_variants UNIQUE 制約（article_id, position）
--   - 同一記事内で同じ position に複数 CTA が登録される事故を構造的に防止。
--   - position が NULL の行も許容するため UNIQUE は (article_id, position) のまま。
--     PostgreSQL は NULL を区別する仕様のため NULL 行は重複検出対象外。
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE cta_variants
  ADD CONSTRAINT cta_variants_article_position_uniq
  UNIQUE (article_id, position);

COMMENT ON CONSTRAINT cta_variants_article_position_uniq ON cta_variants IS
  '同一記事内で position の重複登録を禁止（v2.1 D4）';

-- ============================================================================
-- ROLLBACK（手動実行用・本 migration 全体を巻き戻す）
-- ============================================================================
-- -- D4 ロールバック
-- ALTER TABLE cta_variants
--   DROP CONSTRAINT IF EXISTS cta_variants_article_position_uniq;
--
-- -- D3 ロールバック
-- DROP POLICY IF EXISTS "service_role_only" ON generation_jobs;
--
-- -- D1/D2 ロールバック（注意: 統合後の comment 列データは失われる）
-- DROP TABLE IF EXISTS article_revisions CASCADE;
-- -- → 旧 initial_schema + 20260417 の二重定義状態へ戻すには
-- --   両 migration を再適用するか、手動で旧スキーマを再構築すること。
-- ============================================================================
