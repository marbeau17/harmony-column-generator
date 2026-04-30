-- match_source_chunks RPC for RAG retrieval
CREATE OR REPLACE FUNCTION match_source_chunks(
  query_embedding vector(768),
  match_count int DEFAULT 20,
  filter_themes text[] DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  source_article_id uuid,
  chunk_index int,
  chunk_text text,
  similarity float,
  themes text[],
  emotional_tone text,
  spiritual_concepts text[]
)
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT
    sc.id,
    sc.source_article_id,
    sc.chunk_index,
    sc.chunk_text,
    1 - (sc.embedding <=> query_embedding) AS similarity,
    sc.themes,
    sc.emotional_tone,
    sc.spiritual_concepts
  FROM source_chunks sc
  WHERE
    (filter_themes IS NULL OR sc.themes && filter_themes)
    AND sc.embedding IS NOT NULL
  ORDER BY sc.embedding <=> query_embedding
  LIMIT match_count
$$;

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS match_source_chunks(vector, int, text[]);
