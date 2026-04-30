// ============================================================================
// test/unit/tone-run-checks.test.ts
// runToneChecks の統合動作を検証する。
//
// 戦略:
//   - yukiko-scoring / centroid-similarity / generateEmbedding を vi.mock で stub
//   - 3 シナリオ:
//       1) 通常ケース: tone.passed=true && similarity>=0.85 → passed=true
//       2) centroid 不在: similarity 取得失敗時は 0、passed は tone.passed のみで判定
//       3) tone NG: tone.passed=false → similarity に関わらず passed=false
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// モック宣言（import 前）
// ─────────────────────────────────────────────────────────────────────────────

const mockScoreYukikoTone = vi.fn();
const mockCentroidSimilarity = vi.fn();
const mockGenerateEmbedding = vi.fn();

vi.mock('@/lib/tone/yukiko-scoring', () => ({
  scoreYukikoTone: (...args: unknown[]) => mockScoreYukikoTone(...args),
}));

vi.mock('@/lib/tone/centroid-similarity', () => ({
  centroidSimilarity: (...args: unknown[]) => mockCentroidSimilarity(...args),
}));

vi.mock('@/lib/ai/embedding-client', () => ({
  generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
}));

// ─────────────────────────────────────────────────────────────────────────────
// テスト対象（mock 後に import）
// ─────────────────────────────────────────────────────────────────────────────

import { runToneChecks } from '@/lib/tone/run-tone-checks';

// ─────────────────────────────────────────────────────────────────────────────
// 共通フィクスチャ
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_HTML = '<p>サンプル本文です。</p>';
const FAKE_EMBEDDING = [0.1, 0.2, 0.3];

function buildToneScore(overrides: Partial<{
  total: number;
  passed: boolean;
  blockers: string[];
}> = {}) {
  return {
    total: overrides.total ?? 0.9,
    passed: overrides.passed ?? true,
    blockers: overrides.blockers ?? [],
    breakdown: {
      perspectiveShift: 1,
      doublePostAvoidance: 1,
      concretenessReverse: 1,
      deepResonance: 1,
      softEnding: 1,
      metaphorOriginality: 1,
      hiraganaRatio: 1,
      rhythmShortLong: 1,
      noDoubleQuote: 1,
      noSpiritualAssertion: 1,
      ctaNaturalInsertion: 1,
      emojiRestraint: 1,
      ctaUrlPresence: 1,
      forbiddenPhraseAbsence: 1,
    },
  };
}

describe('runToneChecks', () => {
  beforeEach(() => {
    mockScoreYukikoTone.mockReset();
    mockCentroidSimilarity.mockReset();
    mockGenerateEmbedding.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('通常ケース: tone.passed=true かつ similarity>=0.85 で passed=true', async () => {
    mockScoreYukikoTone.mockReturnValue(buildToneScore({ total: 0.9, passed: true }));
    mockGenerateEmbedding.mockResolvedValue(FAKE_EMBEDDING);
    mockCentroidSimilarity.mockResolvedValue(0.9);

    const result = await runToneChecks(SAMPLE_HTML);

    expect(result.tone.passed).toBe(true);
    expect(result.centroidSimilarity).toBeCloseTo(0.9, 6);
    expect(result.passed).toBe(true);

    // generateEmbedding は RETRIEVAL_DOCUMENT で呼ばれていること
    expect(mockGenerateEmbedding).toHaveBeenCalledWith(SAMPLE_HTML, 'RETRIEVAL_DOCUMENT');
    expect(mockCentroidSimilarity).toHaveBeenCalledWith(FAKE_EMBEDDING);
  });

  it('centroid 不在: similarity 取得失敗時は 0 にフォールバックし、passed は tone.passed のみで判定', async () => {
    mockScoreYukikoTone.mockReturnValue(buildToneScore({ total: 0.9, passed: true }));
    mockGenerateEmbedding.mockResolvedValue(FAKE_EMBEDDING);
    mockCentroidSimilarity.mockRejectedValue(
      new Error('centroidSimilarity: no active centroid in yukiko_style_centroid'),
    );

    const result = await runToneChecks(SAMPLE_HTML);

    expect(result.tone.passed).toBe(true);
    expect(result.centroidSimilarity).toBe(0);
    // tone.passed=true のみで合格扱い
    expect(result.passed).toBe(true);
  });

  it('tone NG: tone.passed=false なら similarity に関わらず passed=false', async () => {
    mockScoreYukikoTone.mockReturnValue(
      buildToneScore({ total: 0, passed: false, blockers: ['noDoubleQuote'] }),
    );
    mockGenerateEmbedding.mockResolvedValue(FAKE_EMBEDDING);
    mockCentroidSimilarity.mockResolvedValue(0.95);

    const result = await runToneChecks(SAMPLE_HTML);

    expect(result.tone.passed).toBe(false);
    expect(result.centroidSimilarity).toBeCloseTo(0.95, 6);
    expect(result.passed).toBe(false);
  });

  it('embedding 自体が失敗した場合も similarity=0 でフォールバックし、tone.passed のみで判定', async () => {
    mockScoreYukikoTone.mockReturnValue(buildToneScore({ total: 0.9, passed: true }));
    mockGenerateEmbedding.mockRejectedValue(new Error('GEMINI_API_KEY is not set'));

    const result = await runToneChecks(SAMPLE_HTML);

    expect(result.centroidSimilarity).toBe(0);
    expect(result.passed).toBe(true);
    // centroidSimilarity は呼ばれない
    expect(mockCentroidSimilarity).not.toHaveBeenCalled();
  });

  it('similarity < 0.85 ならば tone.passed=true でも passed=false', async () => {
    mockScoreYukikoTone.mockReturnValue(buildToneScore({ total: 0.9, passed: true }));
    mockGenerateEmbedding.mockResolvedValue(FAKE_EMBEDDING);
    mockCentroidSimilarity.mockResolvedValue(0.7);

    const result = await runToneChecks(SAMPLE_HTML);

    expect(result.tone.passed).toBe(true);
    expect(result.centroidSimilarity).toBeCloseTo(0.7, 6);
    expect(result.passed).toBe(false);
  });
});
