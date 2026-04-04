-- ============================================================
-- Content Planner - AIコンテンツプランナー用スキーマ
-- ============================================================

-- コンテンツプラン
CREATE TABLE IF NOT EXISTS content_plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id TEXT NOT NULL,
  status TEXT DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected', 'generating', 'completed', 'failed')),
  theme TEXT NOT NULL,
  persona TEXT NOT NULL,
  keyword TEXT NOT NULL,
  sub_keywords TEXT[] DEFAULT '{}',
  perspective_type TEXT NOT NULL,
  source_article_ids UUID[] DEFAULT '{}',
  target_word_count INTEGER DEFAULT 2000,
  predicted_seo_score INTEGER,
  proposal_reason TEXT,
  article_id UUID REFERENCES articles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 生成キュー
CREATE TABLE IF NOT EXISTS generation_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id UUID REFERENCES content_plans(id) ON DELETE CASCADE,
  article_id UUID REFERENCES articles(id),
  step TEXT DEFAULT 'pending' CHECK (step IN ('pending', 'outline', 'body', 'images', 'seo_check', 'completed', 'failed')),
  priority INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_plans_batch ON content_plans(batch_id);
CREATE INDEX IF NOT EXISTS idx_plans_status ON content_plans(status);
CREATE INDEX IF NOT EXISTS idx_queue_step ON generation_queue(step);
CREATE INDEX IF NOT EXISTS idx_queue_priority ON generation_queue(priority DESC);

-- RLS
ALTER TABLE content_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated access" ON content_plans FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated access" ON generation_queue FOR ALL USING (auth.role() = 'authenticated');

-- 更新トリガー
CREATE OR REPLACE TRIGGER content_plans_updated_at BEFORE UPDATE ON content_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at();
