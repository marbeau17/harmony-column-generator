import { describe, it, expect } from 'vitest';
import { estimateGeminiCost, COST_PER_1M_TOKENS_USD } from '@/lib/ai/cost-tracker';

describe('estimateGeminiCost', () => {
  it('gemini-3.1-pro-preview の input/output/thinking を合算する', () => {
    const result = estimateGeminiCost({
      model: 'gemini-3.1-pro-preview',
      promptTokens: 1000,
      completionTokens: 2000,
      thinkingTokens: 10000,
    });
    // 1000/1M * 1.25 = 0.00125
    // 2000/1M * 10 = 0.02
    // 10000/1M * 10 = 0.1
    // 合計 = 0.12125
    expect(result.inputUsd).toBeCloseTo(0.00125, 8);
    expect(result.outputUsd).toBeCloseTo(0.02, 8);
    expect(result.thinkingUsd).toBeCloseTo(0.1, 8);
    expect(result.totalUsd).toBeCloseTo(0.12125, 8);
    expect(result.model).toBe('gemini-3.1-pro-preview');
  });

  it('text-embedding-004 は input のみで計算する', () => {
    const result = estimateGeminiCost({
      model: 'text-embedding-004',
      promptTokens: 350,
      completionTokens: 0,
    });
    // 350/1M * 0.025 = 0.00000875
    expect(result.inputUsd).toBeCloseTo(0.00000875, 10);
    expect(result.outputUsd).toBe(0);
    expect(result.thinkingUsd).toBe(0);
    expect(result.totalUsd).toBeCloseTo(0.00000875, 10);
  });

  it('未知のモデルは totalUsd === 0 を返す', () => {
    const result = estimateGeminiCost({
      model: 'gemini-unknown-model-xyz',
      promptTokens: 9999,
      completionTokens: 9999,
      thinkingTokens: 9999,
    });
    expect(result.totalUsd).toBe(0);
    expect(result.inputUsd).toBe(0);
    expect(result.outputUsd).toBe(0);
    expect(result.thinkingUsd).toBe(0);
    expect(result.totalUsdString).toBe('0.000000');
    expect(result.model).toBe('gemini-unknown-model-xyz');
  });

  it('totalUsdString は小数 6 桁の文字列を返す', () => {
    const result = estimateGeminiCost({
      model: 'gemini-3.1-pro-preview',
      promptTokens: 1000,
      completionTokens: 2000,
      thinkingTokens: 10000,
    });
    expect(result.totalUsdString).toBe('0.121250');
    expect(result.totalUsdString).toMatch(/^\d+\.\d{6}$/);

    const zero = estimateGeminiCost({
      model: 'unknown',
      promptTokens: 0,
      completionTokens: 0,
    });
    expect(zero.totalUsdString).toBe('0.000000');
    expect(zero.totalUsdString).toMatch(/^\d+\.\d{6}$/);
  });

  it('料金表に主要モデルが含まれる', () => {
    expect(COST_PER_1M_TOKENS_USD['gemini-3.1-pro-preview']).toBeDefined();
    expect(COST_PER_1M_TOKENS_USD['text-embedding-004']).toBeDefined();
  });
});
