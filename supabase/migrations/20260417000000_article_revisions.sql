-- 記事バージョン履歴（直近3バージョン保持）
CREATE TABLE IF NOT EXISTS article_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL DEFAULT 1,
  title TEXT,
  body_html TEXT NOT NULL,
  meta_description TEXT,
  change_type TEXT NOT NULL DEFAULT 'manual_save',
  changed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revisions_article ON article_revisions(article_id, created_at DESC);

-- RLS
ALTER TABLE article_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage revisions" ON article_revisions
  FOR ALL USING (auth.role() = 'authenticated');
