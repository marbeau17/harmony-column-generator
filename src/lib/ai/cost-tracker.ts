/**
 * Gemini モデル別の概算コスト（USD per 1M tokens）。
 * 数値は 2026-04 時点の Google AI 公開料金で、改定があれば本ファイルだけ更新する。
 */
export const COST_PER_1M_TOKENS_USD: Readonly<
  Record<string, { input: number; output: number; thinking?: number }>
> = {
  'gemini-3.1-pro-preview': { input: 1.25, output: 10.0, thinking: 10.0 },
  'gemini-3-pro-preview': { input: 1.25, output: 10.0, thinking: 10.0 },
  'gemini-2.5-flash': { input: 0.075, output: 0.3 },
  'text-embedding-004': { input: 0.025, output: 0 },
  'gemini-embedding-001': { input: 0.025, output: 0 },
} as const;

export type GeminiUsage = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  thinkingTokens?: number;
};

export type CostEstimate = {
  model: string;
  inputUsd: number;
  outputUsd: number;
  thinkingUsd: number;
  totalUsd: number;
  /** 数値が小さいので 6 桁丸めの文字列も同梱（grep しやすさのため） */
  totalUsdString: string;
};

/** 単一呼び出しの USD 概算を返す。未知モデルは 0 を返す。 */
export function estimateGeminiCost(usage: GeminiUsage): CostEstimate {
  const rate = COST_PER_1M_TOKENS_USD[usage.model];
  if (!rate) {
    return {
      model: usage.model,
      inputUsd: 0,
      outputUsd: 0,
      thinkingUsd: 0,
      totalUsd: 0,
      totalUsdString: '0.000000',
    };
  }
  const inputUsd = (usage.promptTokens / 1_000_000) * rate.input;
  const outputUsd = (usage.completionTokens / 1_000_000) * rate.output;
  const thinkingUsd = ((usage.thinkingTokens ?? 0) / 1_000_000) * (rate.thinking ?? 0);
  const totalUsd = inputUsd + outputUsd + thinkingUsd;
  return {
    model: usage.model,
    inputUsd,
    outputUsd,
    thinkingUsd,
    totalUsd,
    totalUsdString: totalUsd.toFixed(6),
  };
}
