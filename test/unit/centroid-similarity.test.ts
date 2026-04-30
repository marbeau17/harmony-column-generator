// ============================================================================
// test/unit/centroid-similarity.test.ts
// centroid-similarity の cosine similarity 計算が、固定 fixture に対し
// 仕様通りのスコアを返すことを検証する。
//
// 戦略:
//   - Supabase クライアントを vi.mock で stub し、is_active=true の centroid 行を
//     固定値で返すようにする
//   - 入力 embedding を 3 通り（0.85 / 0.80 / 0.70 になるように設計）用意し、
//     計算結果が ±1e-6 以内で一致することを確認
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Supabase stub
// ─────────────────────────────────────────────────────────────────────────────
//
// centroidSimilarity 内では:
//   supabase.from('yukiko_style_centroid')
//     .select(...)
//     .eq('is_active', true)
//     .order('computed_at', { ascending: false })
//     .limit(1)
//     .maybeSingle();
//
// チェーンの末端 maybeSingle() が { data, error } を返せばよい。
// data.embedding はテストごとに差し替えたいので、可変の参照を持たせる。

let mockCentroidEmbedding: number[] | null = null;
let mockCentroidError: { message: string } | null = null;

vi.mock('@/lib/supabase/server', () => {
  const buildChain = () => {
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.maybeSingle = vi.fn().mockImplementation(async () => {
      if (mockCentroidError) return { data: null, error: mockCentroidError };
      if (!mockCentroidEmbedding) return { data: null, error: null };
      return {
        data: {
          id: 1,
          version: 'centroid-test',
          embedding: mockCentroidEmbedding,
          ngram_hash: {},
          sample_size: 3,
          computed_at: '2026-04-24T00:00:00Z',
        },
        error: null,
      };
    });
    return chain;
  };

  const fakeClient = {
    from: vi.fn().mockImplementation(() => buildChain()),
  };

  return {
    createServiceRoleClient: vi.fn(async () => fakeClient),
  };
});

// Gemini API もテスト中に呼ばれないようガード（centroidSimilarity 自体は呼ばないが、
// import グラフに乗るため念のため stub）
vi.mock('@/lib/ai/gemini-client', () => ({
  generateEmbedding: vi.fn(async () => {
    throw new Error('generateEmbedding should not be called in this test');
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// テスト対象 import（vi.mock 宣言後）
// ─────────────────────────────────────────────────────────────────────────────
import { centroidSimilarity, cosineSimilarity } from '@/lib/tone/centroid-similarity';

/**
 * cosθ = target を満たすベクトル b を centroid a=[1, 0] に対して構築する。
 * b = (cosθ, sinθ) なら ||a||=||b||=1 で cos(a,b) = cosθ。
 */
function makeUnitVecAtCos(target: number): number[] {
  // 数値誤差対策で sin は abs 値を使用、符号は仕様上不問
  const sin = Math.sqrt(Math.max(0, 1 - target * target));
  return [target, sin];
}

const CENTROID_BASE: number[] = [1, 0];

describe('cosineSimilarity (pure)', () => {
  it('returns 1 for identical unit vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 10);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it('throws on dim mismatch', () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow(/dim mismatch/);
  });

  it('throws on zero vector', () => {
    expect(() => cosineSimilarity([0, 0], [1, 0])).toThrow(/zero-norm/);
  });
});

describe('centroidSimilarity (with mocked DB)', () => {
  beforeEach(() => {
    mockCentroidEmbedding = CENTROID_BASE;
    mockCentroidError = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns ~0.85 when input vector is at cosθ=0.85 from centroid', async () => {
    const input = makeUnitVecAtCos(0.85);
    const score = await centroidSimilarity(input);
    expect(score).toBeCloseTo(0.85, 6);
  });

  it('returns ~0.80 when input vector is at cosθ=0.80 from centroid', async () => {
    const input = makeUnitVecAtCos(0.80);
    const score = await centroidSimilarity(input);
    expect(score).toBeCloseTo(0.80, 6);
  });

  it('returns ~0.70 when input vector is at cosθ=0.70 from centroid', async () => {
    const input = makeUnitVecAtCos(0.70);
    const score = await centroidSimilarity(input);
    expect(score).toBeCloseTo(0.70, 6);
  });

  it('throws when no active centroid is present', async () => {
    mockCentroidEmbedding = null;
    await expect(centroidSimilarity([1, 0])).rejects.toThrow(/no active centroid/);
  });

  it('throws when DB returns error', async () => {
    mockCentroidError = { message: 'connection refused' };
    await expect(centroidSimilarity([1, 0])).rejects.toThrow(/connection refused/);
  });

  it('throws on empty input embedding', async () => {
    await expect(centroidSimilarity([])).rejects.toThrow(/non-empty/);
  });

  it('parses pgvector string format embedding', async () => {
    // pgvector 互換: "[1,0]" 形式で返ってきても透過処理できること
    mockCentroidEmbedding = '[1,0]' as unknown as number[];
    const score = await centroidSimilarity(makeUnitVecAtCos(0.85));
    expect(score).toBeCloseTo(0.85, 6);
  });
});
