-- source_articles に usage_count カラムを追加
-- 記事が何回コラム生成に使われたかを追跡し、偏りなく元記事を活用する
ALTER TABLE source_articles ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0;

-- usage_count でのソート用インデックス
CREATE INDEX IF NOT EXISTS idx_source_articles_usage_count ON source_articles(usage_count ASC);
