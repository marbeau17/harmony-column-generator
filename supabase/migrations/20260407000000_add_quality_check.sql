-- Add quality_check column to store quality checklist results
ALTER TABLE articles ADD COLUMN IF NOT EXISTS quality_check jsonb;

-- Comment for clarity
COMMENT ON COLUMN articles.quality_check IS 'Quality checklist results (JSON). Contains passed, score, items, summary, checkedAt, errorCount, warningCount';
