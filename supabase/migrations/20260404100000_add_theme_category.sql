ALTER TABLE source_articles ADD COLUMN IF NOT EXISTS theme_category TEXT;
CREATE INDEX IF NOT EXISTS idx_source_articles_theme ON source_articles(theme_category);
