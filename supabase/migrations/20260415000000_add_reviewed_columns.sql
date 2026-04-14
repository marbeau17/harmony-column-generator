-- 由起子さん確認フラグ（公開前にレビュー承認が必要）
ALTER TABLE articles ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

-- reviewed_at にインデックスを追加（ハブページ表示フィルタで使用）
CREATE INDEX IF NOT EXISTS idx_articles_reviewed_at ON articles (reviewed_at) WHERE reviewed_at IS NOT NULL;
