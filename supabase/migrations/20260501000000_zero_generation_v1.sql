-- Zero-Generation V1: テーマ/ペルソナベース記事ゼロ生成 + ハルシネーション検証 基盤
-- Spec: docs/optimized_spec.md §4 (P5: Zero-Generation V1)
--
-- 冪等性: ALL `IF NOT EXISTS` / `IF EXISTS` で再実行安全。
-- 既存 59 記事への影響: すべての列は nullable または default 値あり。
-- ロールバック手順は本ファイル末尾の `-- ROLLBACK:` ブロック参照。

-- =============================================================================
-- 1. pgvector 拡張
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================================
-- 2. articles 列追加 (9 列)
-- =============================================================================

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS generation_mode      TEXT DEFAULT 'source',
  ADD COLUMN IF NOT EXISTS intent               TEXT,
  ADD COLUMN IF NOT EXISTS lead_summary         TEXT,
  ADD COLUMN IF NOT EXISTS citation_highlights  JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS narrative_arc        JSONB,
  ADD COLUMN IF NOT EXISTS emotion_curve        JSONB,
  ADD COLUMN IF NOT EXISTS hallucination_score  FLOAT,
  ADD COLUMN IF NOT EXISTS yukiko_tone_score    FLOAT,
  ADD COLUMN IF NOT EXISTS readability_score    FLOAT;

-- CHECK 制約 (冪等: 一度 DROP してから付与)
ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_generation_mode_check;
ALTER TABLE articles
  ADD CONSTRAINT articles_generation_mode_check
  CHECK (generation_mode IN ('zero','source'));

ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_intent_check;
ALTER TABLE articles
  ADD CONSTRAINT articles_intent_check
  CHECK (intent IS NULL OR intent IN ('info','empathy','solve','introspect'));

-- =============================================================================
-- 3. personas 列追加 (4 列)
-- =============================================================================

ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS preferred_words   TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS avoided_words     TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS image_style       JSONB,
  ADD COLUMN IF NOT EXISTS cta_default_stage TEXT;

-- =============================================================================
-- 4. themes 列追加 (1 列)
-- =============================================================================

ALTER TABLE themes
  ADD COLUMN IF NOT EXISTS visual_mood JSONB;

-- =============================================================================
-- 5. 新規テーブル: source_chunks (ソース記事 chunk + embedding)
-- =============================================================================

CREATE TABLE IF NOT EXISTS source_chunks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_article_id  UUID NOT NULL REFERENCES source_articles(id) ON DELETE CASCADE,
  chunk_index        INT NOT NULL,
  chunk_text         TEXT NOT NULL,
  embedding          vector(768),
  themes             TEXT[] DEFAULT '{}',
  emotional_tone     TEXT,
  spiritual_concepts TEXT[] DEFAULT '{}',
  content_hash       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_source_chunks_embedding
  ON source_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_source_chunks_themes
  ON source_chunks USING GIN (themes);

-- =============================================================================
-- 6. 新規テーブル: article_claims (記事 claim 単位のハルシネーション結果)
-- =============================================================================

CREATE TABLE IF NOT EXISTS article_claims (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id       UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  sentence_idx     INT NOT NULL,
  claim_text       TEXT NOT NULL,
  claim_type       TEXT,
  risk             TEXT,
  source_chunk_id  UUID REFERENCES source_chunks(id) ON DELETE SET NULL,
  similarity_score FLOAT,
  evidence         JSONB,
  validated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CHECK 制約 (冪等)
ALTER TABLE article_claims DROP CONSTRAINT IF EXISTS article_claims_claim_type_check;
ALTER TABLE article_claims
  ADD CONSTRAINT article_claims_claim_type_check
  CHECK (claim_type IS NULL OR claim_type IN ('factual','attribution','spiritual','logical','experience','general'));

ALTER TABLE article_claims DROP CONSTRAINT IF EXISTS article_claims_risk_check;
ALTER TABLE article_claims
  ADD CONSTRAINT article_claims_risk_check
  CHECK (risk IS NULL OR risk IN ('low','medium','high','critical'));

-- UNIQUE 制約 (重複 claim 防止)
ALTER TABLE article_claims DROP CONSTRAINT IF EXISTS article_claims_unique_per_sentence;
ALTER TABLE article_claims
  ADD CONSTRAINT article_claims_unique_per_sentence
  UNIQUE (article_id, sentence_idx, claim_type);

CREATE INDEX IF NOT EXISTS idx_claims_article_risk
  ON article_claims (article_id, risk);

-- =============================================================================
-- 7. 新規テーブル: yukiko_style_centroid (由起子文体 centroid)
-- =============================================================================

CREATE TABLE IF NOT EXISTS yukiko_style_centroid (
  id          SERIAL PRIMARY KEY,
  version     TEXT NOT NULL,
  embedding   vector(768) NOT NULL,
  ngram_hash  JSONB NOT NULL,
  sample_size INT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active   BOOLEAN NOT NULL DEFAULT FALSE
);

-- =============================================================================
-- 8. 新規テーブル: cta_variants (CTA AB バリアント)
-- =============================================================================

CREATE TABLE IF NOT EXISTS cta_variants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id    UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  position      SMALLINT,
  persona_id    UUID REFERENCES personas(id) ON DELETE SET NULL,
  stage         TEXT,
  copy_text     TEXT NOT NULL,
  micro_copy    TEXT,
  variant_label TEXT,
  utm_content   TEXT,
  impressions   INT NOT NULL DEFAULT 0,
  clicks        INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CHECK 制約 (冪等)
ALTER TABLE cta_variants DROP CONSTRAINT IF EXISTS cta_variants_position_check;
ALTER TABLE cta_variants
  ADD CONSTRAINT cta_variants_position_check
  CHECK (position IS NULL OR position IN (1, 2, 3));

ALTER TABLE cta_variants DROP CONSTRAINT IF EXISTS cta_variants_stage_check;
ALTER TABLE cta_variants
  ADD CONSTRAINT cta_variants_stage_check
  CHECK (stage IS NULL OR stage IN ('empathy','transition','action'));

CREATE INDEX IF NOT EXISTS idx_cta_variants_article_pos
  ON cta_variants (article_id, position);

-- =============================================================================
-- 9. RLS: 既存プロジェクト規約 "Authenticated users have full access" を踏襲
--    (supabase/schema.sql の publish_events / article_revisions と同じパターン)
-- =============================================================================

ALTER TABLE source_chunks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_claims         ENABLE ROW LEVEL SECURITY;
ALTER TABLE yukiko_style_centroid  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cta_variants           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users have full access" ON source_chunks;
CREATE POLICY "Authenticated users have full access" ON source_chunks
  FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users have full access" ON article_claims;
CREATE POLICY "Authenticated users have full access" ON article_claims
  FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users have full access" ON yukiko_style_centroid;
CREATE POLICY "Authenticated users have full access" ON yukiko_style_centroid
  FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users have full access" ON cta_variants;
CREATE POLICY "Authenticated users have full access" ON cta_variants
  FOR ALL USING (auth.role() = 'authenticated');

-- =============================================================================
-- ROLLBACK: 本マイグレーションを完全に逆操作する SQL
-- =============================================================================
-- 以下を `psql` 等で順に実行することで、このマイグレーション適用前の状態に戻せる。
-- pgvector 拡張は他マイグレーションで使用される可能性があるため最後に削除（要判断）。
--
-- BEGIN;
--
-- -- 9. RLS ポリシー削除 (テーブル DROP で同時に消えるが明示)
-- DROP POLICY IF EXISTS "Authenticated users have full access" ON cta_variants;
-- DROP POLICY IF EXISTS "Authenticated users have full access" ON yukiko_style_centroid;
-- DROP POLICY IF EXISTS "Authenticated users have full access" ON article_claims;
-- DROP POLICY IF EXISTS "Authenticated users have full access" ON source_chunks;
--
-- -- 8. cta_variants 削除
-- DROP INDEX IF EXISTS idx_cta_variants_article_pos;
-- DROP TABLE IF EXISTS cta_variants;
--
-- -- 7. yukiko_style_centroid 削除
-- DROP TABLE IF EXISTS yukiko_style_centroid;
--
-- -- 6. article_claims 削除
-- DROP INDEX IF EXISTS idx_claims_article_risk;
-- DROP TABLE IF EXISTS article_claims;
--
-- -- 5. source_chunks 削除
-- DROP INDEX IF EXISTS idx_source_chunks_themes;
-- DROP INDEX IF EXISTS idx_source_chunks_embedding;
-- DROP TABLE IF EXISTS source_chunks;
--
-- -- 4. themes 列削除
-- ALTER TABLE themes
--   DROP COLUMN IF EXISTS visual_mood;
--
-- -- 3. personas 列削除
-- ALTER TABLE personas
--   DROP COLUMN IF EXISTS cta_default_stage,
--   DROP COLUMN IF EXISTS image_style,
--   DROP COLUMN IF EXISTS avoided_words,
--   DROP COLUMN IF EXISTS preferred_words;
--
-- -- 2. articles 列削除
-- ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_intent_check;
-- ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_generation_mode_check;
-- ALTER TABLE articles
--   DROP COLUMN IF EXISTS readability_score,
--   DROP COLUMN IF EXISTS yukiko_tone_score,
--   DROP COLUMN IF EXISTS hallucination_score,
--   DROP COLUMN IF EXISTS emotion_curve,
--   DROP COLUMN IF EXISTS narrative_arc,
--   DROP COLUMN IF EXISTS citation_highlights,
--   DROP COLUMN IF EXISTS lead_summary,
--   DROP COLUMN IF EXISTS intent,
--   DROP COLUMN IF EXISTS generation_mode;
--
-- -- 1. pgvector 拡張削除（他マイグレが使用中なら省略）
-- -- DROP EXTENSION IF EXISTS vector;
--
-- COMMIT;
