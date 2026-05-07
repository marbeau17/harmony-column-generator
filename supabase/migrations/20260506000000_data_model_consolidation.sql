-- ============================================================================
-- 20260506000000_data_model_consolidation.sql
--
-- 目的: spec v2.1 §2.4 D1〜D4 の P0 データ整合性修正を一括適用する。
--   D1+D2: article_revisions スキーマを「コード src/lib/db/article-revisions.ts」が
--          期待する (html_snapshot + comment JSON pack) 方式へ additive ALTER で揃える。
--          DROP TABLE せず既存履歴 (本番 72 行) を保全する。
--   D3:    generation_jobs に明示的な service_role_only ポリシーを追加
--   D4:    cta_variants に UNIQUE (article_id, position) 制約を追加
--
-- 設計方針:
--   - 既存データを破壊しない。`comment text → jsonb` は USING で安全に変換し、
--     UNIQUE / INDEX は ADD CONSTRAINT IF NOT EXISTS 相当のガード付きで追加する。
--   - cta_variants は (article_id, position) で重複があれば UNIQUE 追加が
--     失敗するため、事前に重複検出 SELECT を実行し RAISE EXCEPTION で警告。
--   - article_revisions に (article_id, revision_number) の重複がある場合は
--     UNIQUE 追加前に運用者が一意化を済ませること（本 migration では検査のみ）。
--
-- ロールバック:
--   - 末尾の ROLLBACK セクションを手動実行することで個別の DDL を巻き戻せる。
--     ALTER COLUMN TYPE jsonb は逆変換 (jsonb→text) で original 文字列復元可。
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Safety Guard 1: article_revisions の (article_id, revision_number) 重複を検出
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_dup_count BIGINT := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'article_revisions'
  ) THEN
    EXECUTE $sql$
      SELECT COUNT(*) FROM (
        SELECT article_id, revision_number
        FROM article_revisions
        GROUP BY article_id, revision_number
        HAVING COUNT(*) > 1
      ) AS dups
    $sql$ INTO v_dup_count;
    IF v_dup_count > 0 THEN
      RAISE EXCEPTION
        'D1/D2 safety guard: article_revisions に (article_id, revision_number) 重複が % 組存在します。UNIQUE 追加前に運用者が一意化（renumber/削除）を済ませてください。本 migration は中断されました。',
        v_dup_count;
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
-- D1 + D2: article_revisions スキーマを v2.1 統合形へ additive ALTER
--   旧 initial_schema 時点で既に html_snapshot / change_type / changed_by /
--   comment(text) を持つため、必要な差分は次の 3 件のみ:
--     a) comment 列を text → jsonb (USING で安全変換)
--     b) UNIQUE(article_id, revision_number) 追加
--     c) INDEX (article_id, created_at DESC) 追加
-- ─────────────────────────────────────────────────────────────────────────────

-- a) comment 列の jsonb 化
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'article_revisions'
      AND column_name = 'comment'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE article_revisions
      ALTER COLUMN comment TYPE jsonb
      USING CASE
        WHEN comment IS NULL OR comment = '' THEN NULL
        WHEN comment ~ '^\s*[\{\[]' THEN comment::jsonb
        ELSE to_jsonb(comment)
      END;
  END IF;
END $$;

-- b) UNIQUE 制約（既存制約名を一度落として idempotent 化）
ALTER TABLE article_revisions
  DROP CONSTRAINT IF EXISTS article_revisions_article_revision_uniq;
ALTER TABLE article_revisions
  ADD CONSTRAINT article_revisions_article_revision_uniq
  UNIQUE (article_id, revision_number);

-- c) created_at DESC INDEX（履歴一覧取得用）
CREATE INDEX IF NOT EXISTS idx_article_revisions_article_created
  ON article_revisions (article_id, created_at DESC);

-- 互換用 INDEX (revision_number 検索) は既存の idx_revisions_article で代替済のため追加しない。

COMMENT ON COLUMN article_revisions.comment IS
  '{"title":"...","meta_description":"..."} 形式の JSON pack（コード src/lib/db/article-revisions.ts と整合）';

-- RLS は initial_schema で既に有効化 + ポリシー設定済のため再設定しない。

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
-- 再実行耐性: 既に同名制約があれば一度落としてから付け直す（idempotent）。
ALTER TABLE cta_variants
  DROP CONSTRAINT IF EXISTS cta_variants_article_position_uniq;
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
-- -- D1/D2 ロールバック（additive ALTER の逆操作）
-- DROP INDEX IF EXISTS idx_article_revisions_article_created;
-- ALTER TABLE article_revisions
--   DROP CONSTRAINT IF EXISTS article_revisions_article_revision_uniq;
-- ALTER TABLE article_revisions
--   ALTER COLUMN comment TYPE text USING comment::text;
-- ============================================================================
