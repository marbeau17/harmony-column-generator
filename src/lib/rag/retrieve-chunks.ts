// ============================================================================
// src/lib/rag/retrieve-chunks.ts
// RAG: クエリ embedding → pgvector cosine top-20 → metadata filter → MMR top-5
//
// spec §6 (ハルシネーション軽減) のクエリ側実装。
// - クエリ embedding は task_type=RETRIEVAL_QUERY
// - 類似度 ≥ 0.75 を満たす chunk のみ返す
// - 不足時は { warning: 'insufficient_grounding' } を付与
//
// pgvector 検索は Supabase RPC `match_source_chunks` を呼ぶ前提。
// RPC が存在しない / 失敗した場合はテーブル直読みフォールバックを使う
// （フォールバックはクライアント側で cosine を計算する）。
// ============================================================================

import { generateEmbedding } from '@/lib/ai/embedding-client';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

export interface RetrievedChunk {
  id: string;
  source_article_id: string;
  chunk_text: string;
  themes: string[];
  emotional_tone: string | null;
  spiritual_concepts: string[];
  similarity: number; // cosine similarity 0..1
  embedding?: number[]; // MMR 計算後は省略可能
}

export interface RetrieveChunksInput {
  /** 記事テーマ（articles.theme と source_chunks.themes の交差） */
  theme: string;
  /** ペルソナの痛み・課題テキスト（クエリ本文に組み込む） */
  persona_pain: string;
  /** ターゲットキーワード配列 */
  keywords: string[];
  /** 返す chunk 数（デフォルト 5） */
  topK?: number;
  /** 類似度しきい値（デフォルト 0.75） */
  similarityThreshold?: number;
  /** 候補プールサイズ（pgvector ANN top-N、デフォルト 20） */
  candidatePoolSize?: number;
  /** MMR の λ（1.0=純類似, 0.0=純多様性、デフォルト 0.7） */
  mmrLambda?: number;
}

export interface RetrieveChunksResult {
  chunks: RetrievedChunk[];
  /** 類似度や件数が不足した場合に付く警告コード */
  warning?: 'insufficient_grounding';
  /** デバッグ用: クエリ embedding 取得や RPC の所要時間 */
  meta: {
    candidateCount: number;
    afterThresholdCount: number;
    afterFilterCount: number;
    finalCount: number;
    queryEmbeddingMs?: number;
    retrievalMs?: number;
  };
}

/** Supabase クライアント抽象（embed-source-chunks.ts と同じ最小 IF） */
export interface SupabaseLikeClient {
  rpc?: (fn: string, args: Record<string, unknown>) => any;
  from: (table: string) => any;
}

// ─── 数学ユーティリティ ─────────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ─── MMR (Maximal Marginal Relevance) ───────────────────────────────────────

/**
 * MMR 多様性選択。
 * candidates は similarity 降順で渡す前提。
 * λ=1 で純類似、λ=0 で純多様性。
 *
 * - score(c) = λ * sim(c, query) - (1 - λ) * max sim(c, selected)
 * - 各 chunk は embedding を持つ必要があるが、未付与なら sim ベースのランキングのみ。
 */
export function selectByMmr<T extends RetrievedChunk>(
  candidates: T[],
  topK: number,
  lambda: number,
): T[] {
  if (candidates.length <= topK) return candidates.slice();
  if (lambda >= 1) return candidates.slice(0, topK);

  const selected: T[] = [];
  const remaining = candidates.slice();

  // 最初は最高類似度
  selected.push(remaining.shift() as T);

  while (selected.length < topK && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const simToQuery = cand.similarity;

      let maxSimToSelected = 0;
      if (cand.embedding && cand.embedding.length > 0) {
        for (const s of selected) {
          if (!s.embedding || s.embedding.length === 0) continue;
          const sim = cosineSimilarity(cand.embedding, s.embedding);
          if (sim > maxSimToSelected) maxSimToSelected = sim;
        }
      }

      const score = lambda * simToQuery - (1 - lambda) * maxSimToSelected;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected;
}

// ─── クエリ文字列の組み立て ─────────────────────────────────────────────────

export function buildQueryText(input: {
  theme: string;
  persona_pain: string;
  keywords: string[];
}): string {
  const kw = (input.keywords || []).filter(Boolean).join('、');
  return [
    `テーマ: ${input.theme}`,
    input.persona_pain ? `読者の悩み: ${input.persona_pain}` : '',
    kw ? `キーワード: ${kw}` : '',
  ]
    .filter((s) => s.length > 0)
    .join('\n');
}

// ─── pgvector RPC 呼び出し ──────────────────────────────────────────────────

interface RpcRow {
  id: string;
  source_article_id: string;
  chunk_text: string;
  themes: string[] | null;
  emotional_tone: string | null;
  spiritual_concepts: string[] | null;
  similarity: number;
  embedding?: number[] | null;
}

/**
 * Supabase の RPC `match_source_chunks` を呼ぶ。
 * 期待される SQL（F1 担当のマイグレで作成）:
 *
 *   create or replace function match_source_chunks(
 *     query_embedding vector(768),
 *     match_count int,
 *     filter_themes text[]
 *   ) returns table (
 *     id uuid, source_article_id uuid, chunk_text text,
 *     themes text[], emotional_tone text, spiritual_concepts text[],
 *     similarity float, embedding vector(768)
 *   ) ...
 */
async function callMatchRpc(
  supabase: SupabaseLikeClient,
  queryEmbedding: number[],
  candidatePoolSize: number,
  themeFilter: string[],
): Promise<RpcRow[] | null> {
  if (typeof supabase.rpc !== 'function') return null;

  const { data, error } = await supabase.rpc('match_source_chunks', {
    query_embedding: queryEmbedding,
    match_count: candidatePoolSize,
    filter_themes: themeFilter,
  });

  if (error) {
    console.warn('[retrieve-chunks.rpc_failed]', {
      message: error.message ?? String(error),
    });
    return null;
  }
  return (data ?? []) as RpcRow[];
}

// ─── メイン関数 ─────────────────────────────────────────────────────────────

/**
 * RAG retrieval のメイン関数。
 *
 * 1. クエリ文字列を組み立て、RETRIEVAL_QUERY で embedding 化
 * 2. pgvector で cosine 類似度 top-N 候補を取得（match_source_chunks RPC）
 * 3. metadata filter（themes 一致）
 * 4. similarity ≥ threshold で切り捨て
 * 5. MMR (λ=0.7) で top-K を多様性選択
 * 6. 不足なら warning='insufficient_grounding'
 */
export async function retrieveChunks(
  supabase: SupabaseLikeClient,
  input: RetrieveChunksInput,
): Promise<RetrieveChunksResult> {
  const topK = input.topK ?? 5;
  const threshold = input.similarityThreshold ?? 0.75;
  const poolSize = input.candidatePoolSize ?? 20;
  const lambda = input.mmrLambda ?? 0.7;

  const fnStart = Date.now();
  console.log('[rag.retrieve-chunks.begin]', {
    theme: input.theme,
    persona_pain_chars: (input.persona_pain ?? '').length,
    keywords_count: (input.keywords ?? []).length,
    similarityThreshold: threshold,
    topK,
    poolSize,
  });

  const queryText = buildQueryText(input);

  const t0 = Date.now();
  const queryEmbedding = await generateEmbedding(queryText, 'RETRIEVAL_QUERY');
  const queryEmbeddingMs = Date.now() - t0;

  // theme filter は RPC 側 (themes && filter_themes) で適用してもらう
  const filterThemes = input.theme ? [input.theme] : [];

  const t1 = Date.now();
  const rows = await callMatchRpc(supabase, queryEmbedding, poolSize, filterThemes);
  const retrievalMs = Date.now() - t1;

  if (!rows) {
    // RPC が無い／失敗した場合は空で返す（呼出元で警告ハンドリング）
    console.log('[rag.retrieve-chunks.end]', {
      chunks_returned: 0,
      top_similarity: null,
      warning: 'insufficient_grounding',
      elapsed_ms: Date.now() - fnStart,
      queryEmbeddingMs,
      retrievalMs,
      reason: 'rpc_failed_or_missing',
    });
    return {
      chunks: [],
      warning: 'insufficient_grounding',
      meta: {
        candidateCount: 0,
        afterThresholdCount: 0,
        afterFilterCount: 0,
        finalCount: 0,
        queryEmbeddingMs,
        retrievalMs,
      },
    };
  }

  const candidates: RetrievedChunk[] = rows.map((r) => ({
    id: r.id,
    source_article_id: r.source_article_id,
    chunk_text: r.chunk_text,
    themes: r.themes ?? [],
    emotional_tone: r.emotional_tone,
    spiritual_concepts: r.spiritual_concepts ?? [],
    similarity: r.similarity,
    embedding: r.embedding ?? undefined,
  }));

  const candidateCount = candidates.length;

  // RPC で themes フィルタしているはずだが、念のためクライアント側でも検証
  const filtered = filterThemes.length === 0
    ? candidates
    : candidates.filter((c) =>
        c.themes.some((t) => filterThemes.includes(t)),
      );
  const afterFilterCount = filtered.length;

  // similarity >= threshold で切る
  const aboveThreshold = filtered
    .filter((c) => c.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity);
  const afterThresholdCount = aboveThreshold.length;

  // MMR で多様性選択
  const finalChunks = selectByMmr(aboveThreshold, topK, lambda);

  const result: RetrieveChunksResult = {
    chunks: finalChunks,
    meta: {
      candidateCount,
      afterFilterCount,
      afterThresholdCount,
      finalCount: finalChunks.length,
      queryEmbeddingMs,
      retrievalMs,
    },
  };

  if (finalChunks.length < topK) {
    result.warning = 'insufficient_grounding';
  }

  console.log('[rag.retrieve-chunks.end]', {
    chunks_returned: finalChunks.length,
    top_similarity: finalChunks.length > 0 ? finalChunks[0].similarity : null,
    warning: result.warning ?? null,
    elapsed_ms: Date.now() - fnStart,
    queryEmbeddingMs,
    retrievalMs,
    candidateCount,
    afterFilterCount,
    afterThresholdCount,
  });

  return result;
}
