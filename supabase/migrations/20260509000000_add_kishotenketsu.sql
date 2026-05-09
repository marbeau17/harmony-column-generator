-- ============================================================================
-- 20260509000000_add_kishotenketsu.sql
-- 目的 (P5-99): articles に「起承転結」構造化データと承認メタデータを追加。
--
-- 設計方針:
--   - additive ALTER のみ。既存列・既存データには触れない。
--   - すべて IF NOT EXISTS で再実行耐性 (G1 hardening 規約準拠)。
--   - kishotenketsu は { ki, sho, ten, ketsu } の 4 文字列を保持する JSONB。
--   - reviewed_at と独立した承認軸として kishotenketsu_approved_at/_by を設置。
--
-- RLS:
--   - 既存 articles RLS でカバー: ADD COLUMN で追加した列は既存ポリシー保護下に
--     自動的に入る (Postgres RLS は行単位評価)。新規ポリシー不要。
-- ============================================================================

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS kishotenketsu JSONB;

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS kishotenketsu_approved_at TIMESTAMPTZ;

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS kishotenketsu_approved_by UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- 形状検証: object かつ ki/sho/ten/ketsu すべて string であること
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'articles_kishotenketsu_shape_chk'
  ) THEN
    ALTER TABLE articles
      ADD CONSTRAINT articles_kishotenketsu_shape_chk
      -- P5-99 Change Request: missing key を確実に reject するため
      --   kishotenketsu ? 'KEY' でキー存在を先に確認。
      --   旧 CHECK は jsonb_typeof(kishotenketsu->'KEY') が
      --   missing key 時に NULL を返し、`NULL = 'string'` が UNKNOWN
      --   評価で CHECK pass する semantic gap があった。
      CHECK (
        kishotenketsu IS NULL
        OR (
          jsonb_typeof(kishotenketsu) = 'object'
          AND kishotenketsu ? 'ki'
          AND kishotenketsu ? 'sho'
          AND kishotenketsu ? 'ten'
          AND kishotenketsu ? 'ketsu'
          AND jsonb_typeof(kishotenketsu->'ki')    = 'string'
          AND jsonb_typeof(kishotenketsu->'sho')   = 'string'
          AND jsonb_typeof(kishotenketsu->'ten')   = 'string'
          AND jsonb_typeof(kishotenketsu->'ketsu') = 'string'
        )
      );
  END IF;
END $$;

-- 承認済み記事の検索用 partial index
CREATE INDEX IF NOT EXISTS idx_articles_kishotenketsu_approved_at
  ON articles (kishotenketsu_approved_at)
  WHERE kishotenketsu_approved_at IS NOT NULL;

COMMENT ON COLUMN articles.kishotenketsu IS
  'P5-99: 起承転結 4 段の本文プラン。{ki, sho, ten, ketsu: string} JSONB。';
COMMENT ON COLUMN articles.kishotenketsu_approved_at IS
  'P5-99: 起承転結プラン承認時刻。NULL=未承認。';
COMMENT ON COLUMN articles.kishotenketsu_approved_by IS
  'P5-99: 承認者の auth.users.id。';

-- ============================================================================
-- ROLLBACK (参考・実行されない / spec §7.3):
--
-- ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_kishotenketsu_shape_chk;
-- DROP INDEX IF EXISTS idx_articles_kishotenketsu_approved_at;
-- ALTER TABLE articles DROP COLUMN IF EXISTS kishotenketsu_approved_by;
-- ALTER TABLE articles DROP COLUMN IF EXISTS kishotenketsu_approved_at;
-- ALTER TABLE articles DROP COLUMN IF EXISTS kishotenketsu;
-- ============================================================================
