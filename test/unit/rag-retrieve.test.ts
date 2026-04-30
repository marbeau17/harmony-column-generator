// ============================================================================
// test/unit/rag-retrieve.test.ts
// RAG: retrieveChunks の単体テスト
//
// vi.mock で Gemini API（embedding-client）と Supabase クライアントを完全 stub し、
// 以下を検証する:
//   - top-K 順序保証（similarity 降順 + MMR）
//   - similarity threshold 切り捨て
//   - MMR による多様性選択
//   - insufficient_grounding 警告
//   - cosineSimilarity / selectByMmr / buildQueryText 純関数
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Gemini embedding を stub ────────────────────────────────────────────────
vi.mock('@/lib/ai/embedding-client', () => {
  return {
    generateEmbedding: vi.fn(async (_text: string, _taskType: string) => {
      // クエリは「何にも近くないが特定方向を向くベクトル」とする
      return [1, 0, 0, 0];
    }),
  };
});

import {
  retrieveChunks,
  cosineSimilarity,
  selectByMmr,
  buildQueryText,
  type RetrievedChunk,
  type SupabaseLikeClient,
} from '@/lib/rag/retrieve-chunks';
import * as embeddingClient from '@/lib/ai/embedding-client';

// ── ヘルパー: モック Supabase クライアント ──────────────────────────────────

function makeSupabaseMock(rpcRows: any[] | null, opts?: { rpcError?: any }): SupabaseLikeClient {
  return {
    rpc: vi.fn(async (_fn: string, _args: Record<string, unknown>) => {
      if (opts?.rpcError) return { data: null, error: opts.rpcError };
      return { data: rpcRows ?? [], error: null };
    }) as unknown as SupabaseLikeClient['rpc'],
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
    })),
  };
}

// ── 純関数 ──────────────────────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('完全一致ベクトルは 1.0', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0, 5);
  });

  it('直交ベクトルは 0', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 5);
  });

  it('長さ不一致は 0', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
  });

  it('ゼロベクトルは 0', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 1, 1])).toBe(0);
  });
});

describe('buildQueryText', () => {
  it('theme + persona_pain + keywords を改行で連結', () => {
    const q = buildQueryText({
      theme: '癒し',
      persona_pain: '夜眠れない',
      keywords: ['不眠', '瞑想'],
    });
    expect(q).toContain('テーマ: 癒し');
    expect(q).toContain('読者の悩み: 夜眠れない');
    expect(q).toContain('キーワード: 不眠、瞑想');
  });

  it('空フィールドは省略される', () => {
    const q = buildQueryText({ theme: '癒し', persona_pain: '', keywords: [] });
    expect(q).toBe('テーマ: 癒し');
  });
});

describe('selectByMmr', () => {
  const mk = (id: string, sim: number, vec: number[]): RetrievedChunk => ({
    id,
    source_article_id: 'a',
    chunk_text: id,
    themes: [],
    emotional_tone: null,
    spiritual_concepts: [],
    similarity: sim,
    embedding: vec,
  });

  it('topK 以下なら全件返す', () => {
    const cands = [mk('1', 0.9, [1, 0]), mk('2', 0.8, [0, 1])];
    const r = selectByMmr(cands, 5, 0.7);
    expect(r.length).toBe(2);
  });

  it('λ=1.0 は純類似度（先頭から K 件）', () => {
    const cands = [
      mk('a', 0.95, [1, 0, 0]),
      mk('b', 0.94, [1, 0, 0]), // 'a' とほぼ同じ
      mk('c', 0.90, [0, 1, 0]),
    ];
    const r = selectByMmr(cands, 2, 1.0);
    expect(r.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('λ=0 は多様性優先で重複類似を避ける', () => {
    const cands = [
      mk('a', 0.95, [1, 0, 0]),
      mk('b', 0.94, [1, 0, 0]), // 'a' に酷似
      mk('c', 0.90, [0, 1, 0]), // 'a' と直交
    ];
    const r = selectByMmr(cands, 2, 0.0);
    // 1 件目は 'a'、2 件目は 'a' と直交する 'c' を選ぶはず
    expect(r[0].id).toBe('a');
    expect(r[1].id).toBe('c');
  });
});

// ── retrieveChunks 結合テスト ───────────────────────────────────────────────

describe('retrieveChunks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('similarity 降順で top-5 を返す（threshold 通過）', async () => {
    const rows = [
      { id: '1', source_article_id: 'a', chunk_text: 'c1', themes: ['癒し'], emotional_tone: 'gentle', spiritual_concepts: [], similarity: 0.95, embedding: [1, 0, 0] },
      { id: '2', source_article_id: 'a', chunk_text: 'c2', themes: ['癒し'], emotional_tone: 'gentle', spiritual_concepts: [], similarity: 0.88, embedding: [0, 1, 0] },
      { id: '3', source_article_id: 'b', chunk_text: 'c3', themes: ['癒し'], emotional_tone: 'gentle', spiritual_concepts: [], similarity: 0.83, embedding: [0, 0, 1] },
      { id: '4', source_article_id: 'b', chunk_text: 'c4', themes: ['癒し'], emotional_tone: 'gentle', spiritual_concepts: [], similarity: 0.80, embedding: [1, 1, 0] },
      { id: '5', source_article_id: 'c', chunk_text: 'c5', themes: ['癒し'], emotional_tone: 'gentle', spiritual_concepts: [], similarity: 0.77, embedding: [0, 1, 1] },
    ];
    const supabase = makeSupabaseMock(rows);

    const result = await retrieveChunks(supabase, {
      theme: '癒し',
      persona_pain: '不安',
      keywords: ['瞑想'],
      topK: 5,
      similarityThreshold: 0.75,
      mmrLambda: 1.0, // 純類似度モードで決定論にする
    });

    expect(result.chunks.length).toBe(5);
    expect(result.warning).toBeUndefined();
    // λ=1 なら similarity 降順
    const sims = result.chunks.map((c) => c.similarity);
    for (let i = 1; i < sims.length; i++) {
      expect(sims[i]).toBeLessThanOrEqual(sims[i - 1]);
    }
    expect(result.chunks[0].id).toBe('1');
  });

  it('threshold 未満の chunk は捨てられる', async () => {
    const rows = [
      { id: '1', source_article_id: 'a', chunk_text: 'c1', themes: ['癒し'], emotional_tone: null, spiritual_concepts: [], similarity: 0.90, embedding: [1, 0] },
      { id: '2', source_article_id: 'a', chunk_text: 'c2', themes: ['癒し'], emotional_tone: null, spiritual_concepts: [], similarity: 0.74, embedding: [0, 1] }, // 切り捨て対象
      { id: '3', source_article_id: 'b', chunk_text: 'c3', themes: ['癒し'], emotional_tone: null, spiritual_concepts: [], similarity: 0.50, embedding: [1, 1] },
    ];
    const supabase = makeSupabaseMock(rows);

    const result = await retrieveChunks(supabase, {
      theme: '癒し',
      persona_pain: '不安',
      keywords: [],
      topK: 5,
      similarityThreshold: 0.75,
    });

    expect(result.chunks.length).toBe(1);
    expect(result.chunks[0].id).toBe('1');
    // 1 < topK=5 なので警告
    expect(result.warning).toBe('insufficient_grounding');
    expect(result.meta.afterThresholdCount).toBe(1);
    expect(result.meta.candidateCount).toBe(3);
  });

  it('MMR 多様性: 類似 chunk が混じっても異なる方向のものが選ばれる', async () => {
    const rows = [
      { id: 'a', source_article_id: 's', chunk_text: 'a', themes: ['癒し'], emotional_tone: null, spiritual_concepts: [], similarity: 0.95, embedding: [1, 0, 0] },
      { id: 'b', source_article_id: 's', chunk_text: 'b', themes: ['癒し'], emotional_tone: null, spiritual_concepts: [], similarity: 0.94, embedding: [1, 0, 0] }, // 'a' に酷似
      { id: 'c', source_article_id: 's', chunk_text: 'c', themes: ['癒し'], emotional_tone: null, spiritual_concepts: [], similarity: 0.90, embedding: [0, 1, 0] },
    ];
    const supabase = makeSupabaseMock(rows);

    const result = await retrieveChunks(supabase, {
      theme: '癒し',
      persona_pain: '',
      keywords: [],
      topK: 2,
      similarityThreshold: 0.75,
      mmrLambda: 0.3, // 多様性寄り
    });

    // 1 件目は 'a'（最高類似度）
    expect(result.chunks[0].id).toBe('a');
    // 2 件目は 'b'（重複）ではなく多様性で 'c' が選ばれるはず
    expect(result.chunks[1].id).toBe('c');
  });

  it('RPC 失敗時は warning=insufficient_grounding を返す', async () => {
    const supabase = makeSupabaseMock(null, { rpcError: { message: 'rpc not found' } });

    const result = await retrieveChunks(supabase, {
      theme: '癒し',
      persona_pain: '',
      keywords: [],
      topK: 5,
    });

    expect(result.chunks).toEqual([]);
    expect(result.warning).toBe('insufficient_grounding');
  });

  it('クエリ embedding は task_type=RETRIEVAL_QUERY で呼ばれる', async () => {
    const supabase = makeSupabaseMock([]);
    const spy = vi.mocked(embeddingClient.generateEmbedding);

    await retrieveChunks(supabase, {
      theme: '癒し',
      persona_pain: '不眠',
      keywords: ['瞑想'],
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [text, taskType] = spy.mock.calls[0];
    expect(taskType).toBe('RETRIEVAL_QUERY');
    expect(text).toContain('テーマ: 癒し');
    expect(text).toContain('不眠');
  });
});
