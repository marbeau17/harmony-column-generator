-- ============================================================
-- Harmony Column Generator - Supabase Database Schema
-- ============================================================

-- 元記事（アメブロからのインポート）
CREATE TABLE IF NOT EXISTS source_articles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  original_url TEXT,
  published_at TIMESTAMPTZ,
  word_count INTEGER DEFAULT 0,
  themes TEXT[] DEFAULT '{}',
  keywords TEXT[] DEFAULT '{}',
  emotional_tone TEXT,
  spiritual_concepts TEXT[] DEFAULT '{}',
  is_processed BOOLEAN DEFAULT FALSE,
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ペルソナマスタ
CREATE TABLE IF NOT EXISTS personas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  age_range TEXT,
  description TEXT,
  search_patterns TEXT[] DEFAULT '{}',
  tone_guide TEXT,
  cta_approach TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- テーママスタ
CREATE TABLE IF NOT EXISTS themes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  category TEXT,
  energy_method TEXT,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- コラム記事（メインテーブル）
CREATE TABLE IF NOT EXISTS articles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  article_number SERIAL,
  status TEXT DEFAULT 'draft' CHECK (status IN (
    'draft', 'outline_pending', 'outline_approved',
    'body_generating', 'body_review', 'editing', 'published'
  )),

  -- 元記事参照
  source_article_id UUID REFERENCES source_articles(id),
  perspective_type TEXT,

  -- 基本情報
  title TEXT,
  slug TEXT UNIQUE,
  meta_description TEXT,
  seo_filename TEXT,
  keyword TEXT,
  theme TEXT,
  persona TEXT,
  target_word_count INTEGER DEFAULT 2000,

  -- AI生成コンテンツ
  stage1_outline JSONB,
  stage1_image_prompts JSONB,
  stage2_body_html TEXT,
  stage3_final_html TEXT,
  published_html TEXT,

  -- SEO/AIO
  faq_data JSONB,
  structured_data JSONB,
  seo_score JSONB,
  aio_score JSONB,
  quick_answer TEXT,

  -- 画像
  image_prompts JSONB,
  image_files JSONB DEFAULT '[]'::jsonb,

  -- CTA
  cta_texts JSONB,

  -- 関連
  related_articles JSONB DEFAULT '[]'::jsonb,

  -- メタ
  published_url TEXT,
  published_at TIMESTAMPTZ,
  ai_generation_log TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 記事リビジョン
CREATE TABLE IF NOT EXISTS article_revisions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  article_id UUID REFERENCES articles(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  html_snapshot TEXT,
  change_type TEXT,
  changed_by TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI生成ログ
CREATE TABLE IF NOT EXISTS generation_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  article_id UUID REFERENCES articles(id) ON DELETE SET NULL,
  stage TEXT NOT NULL,
  step TEXT,
  model TEXT,
  temperature REAL,
  token_usage JSONB,
  duration_ms INTEGER,
  success BOOLEAN DEFAULT TRUE,
  error_message TEXT,
  raw_output TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- システム設定
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source_article_id);
CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug);
CREATE INDEX IF NOT EXISTS idx_source_articles_title ON source_articles(title);
CREATE INDEX IF NOT EXISTS idx_source_articles_processed ON source_articles(is_processed);
CREATE INDEX IF NOT EXISTS idx_revisions_article ON article_revisions(article_id, revision_number);
CREATE INDEX IF NOT EXISTS idx_generation_logs_article ON generation_logs(article_id);

-- 更新日時自動更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER articles_updated_at
  BEFORE UPDATE ON articles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER source_articles_updated_at
  BEFORE UPDATE ON source_articles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS（Row Level Security）
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE themes ENABLE ROW LEVEL SECURITY;

-- 認証済みユーザーに全アクセス許可（シングルテナント）
CREATE POLICY "Authenticated users have full access" ON articles
  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users have full access" ON source_articles
  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users have full access" ON article_revisions
  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users have full access" ON generation_logs
  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users have full access" ON settings
  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users have full access" ON personas
  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated users have full access" ON themes
  FOR ALL USING (auth.role() = 'authenticated');

-- 公開記事は誰でも閲覧可能
CREATE POLICY "Published articles are public" ON articles
  FOR SELECT USING (status = 'published');
