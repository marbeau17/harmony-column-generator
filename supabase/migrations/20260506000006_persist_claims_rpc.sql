-- ============================================================================
-- 20260506000006_persist_claims_rpc.sql
-- spec v2.1 §D24: persist_claims_atomic RPC を追加（DELETE+INSERT を 1 transaction 化）
--
-- 目的:
--   - 旧実装は supabase-js の「DELETE→INSERT」を 2 リクエストで打っていたため、
--     INSERT 失敗時に「全 claim 消失」状態が残る partial-state バグの可能性があった。
--   - PL/pgSQL 関数で BEGIN〜END をひとつのトランザクションにまとめ、
--     INSERT 失敗時は DELETE もロールバックされる atomic 化を実現する。
--
-- インターフェース:
--   persist_claims_atomic(p_article_id UUID, p_claims JSONB) RETURNS INT
--     - p_claims は JSONB 配列。要素 schema は以下:
--         {
--           "sentence_idx":      number,
--           "claim_text":        text,
--           "claim_type":        text | null,
--           "risk":              text | null,
--           "source_chunk_id":   uuid | null,
--           "similarity_score":  number | null,
--           "evidence":          jsonb | null
--         }
--     - 戻り値は INSERT した件数（0 件入力なら 0）
--
-- 権限:
--   - SECURITY DEFINER で実行
--   - PUBLIC からの EXECUTE を REVOKE し、service_role にのみ GRANT
--   - anon / authenticated は呼び出し不可（RLS 越境を構造的に防ぐ）
-- ============================================================================

CREATE OR REPLACE FUNCTION persist_claims_atomic(
  p_article_id UUID,
  p_claims     JSONB
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INT := 0;
BEGIN
  IF p_article_id IS NULL THEN
    RAISE EXCEPTION 'persist_claims_atomic: p_article_id must not be NULL';
  END IF;

  -- 1. 既存 claim を削除
  DELETE FROM article_claims WHERE article_id = p_article_id;

  -- 2. 入力が NULL / 非配列 / 空配列なら INSERT スキップ（DELETE のみ）
  IF p_claims IS NULL
     OR jsonb_typeof(p_claims) <> 'array'
     OR jsonb_array_length(p_claims) = 0 THEN
    RETURN 0;
  END IF;

  -- 3. JSONB 配列を分解して INSERT
  INSERT INTO article_claims (
    article_id,
    sentence_idx,
    claim_text,
    claim_type,
    risk,
    source_chunk_id,
    similarity_score,
    evidence
  )
  SELECT
    p_article_id,
    (elem ->> 'sentence_idx')::INT,
    (elem ->> 'claim_text')::TEXT,
    NULLIF(elem ->> 'claim_type', '')::TEXT,
    NULLIF(elem ->> 'risk', '')::TEXT,
    CASE
      WHEN (elem ->> 'source_chunk_id') IS NULL OR (elem ->> 'source_chunk_id') = ''
      THEN NULL
      ELSE (elem ->> 'source_chunk_id')::UUID
    END,
    CASE
      WHEN (elem ->> 'similarity_score') IS NULL OR (elem ->> 'similarity_score') = ''
      THEN NULL
      ELSE (elem ->> 'similarity_score')::FLOAT
    END,
    CASE
      WHEN elem ? 'evidence' AND jsonb_typeof(elem -> 'evidence') <> 'null'
      THEN elem -> 'evidence'
      ELSE NULL
    END
  FROM jsonb_array_elements(p_claims) AS elem;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION persist_claims_atomic(UUID, JSONB) IS
  'spec v2.1 §D24: article_claims を 1 transaction で DELETE+INSERT する atomic RPC';

-- ----------------------------------------------------------------------------
-- 権限制御
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION persist_claims_atomic(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION persist_claims_atomic(UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION persist_claims_atomic(UUID, JSONB) FROM authenticated;
GRANT  EXECUTE ON FUNCTION persist_claims_atomic(UUID, JSONB) TO service_role;

-- ----------------------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS persist_claims_atomic(UUID, JSONB);
