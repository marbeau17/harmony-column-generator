// ============================================================================
// src/lib/ai/prompt-chain.ts
// プロンプトチェーン実行エンジン
// 3ステップ: [Writing] → [Proofreading] → [QualityCheck]
//
// 3つのサブステップを順次実行し、各段階の結果をログとともに返す。
// フォールバック戦略:
//   - Writing失敗 → 中断（エラーthrow）
//   - Proofreading失敗 → スキップ（Writing結果をそのまま使用）
//   - QualityCheck失敗 → スキップ（Proofreading結果をそのまま使用）
// ============================================================================

import { generateText } from '@/lib/ai/gemini-client';
import { logger } from '@/lib/logger';
import {
  buildWritingSystemPrompt,
  buildWritingUserPrompt,
} from '@/lib/ai/prompts/stage2-writing';
import {
  buildProofreadingSystemPrompt,
  buildProofreadingUserPrompt,
  parseProofreadingResponse,
} from '@/lib/ai/prompts/stage2-proofreading';
import {
  buildQualityCheckSystemPrompt,
  buildQualityCheckUserPrompt,
  parseQualityCheckResponse,
} from '@/lib/ai/prompts/stage2-qualitycheck';
import type {
  Stage2Input,
  WritingResult,
  ProofreadResult,
  FactcheckResult,
  Stage2ChainResult,
  ChainStepName,
} from '@/types/ai';
import type { QualityIssue } from '@/lib/ai/prompts/stage2-qualitycheck';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

export type { Stage2Input, WritingResult, ProofreadResult, FactcheckResult, Stage2ChainResult, ChainStepName };

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type CtaPosition = 'after_intro' | 'mid_article' | 'in_summary';

export interface ChainStepResult {
  step: ChainStepName | 'qualitycheck';
  success: boolean;
  durationMs: number;
  tokenUsage: TokenUsage;
  rawOutput: string;
  error?: string;
  parsedOutput?: Record<string, unknown>;
}

// ─── チェーンログ構築ヘルパー ────────────────────────────────────────────────

interface ChainLog {
  chainId: string;
  articleId: string;
  startedAt: string;
  completedAt?: string;
  totalDurationMs?: number;
  steps: ChainStepResult[];
}

function createChainLog(articleId: string): ChainLog {
  return {
    chainId: `chain_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    articleId,
    startedAt: new Date().toISOString(),
    steps: [],
  };
}

// ─── IMAGE プレースホルダー補正 ─────────────────────────────────────────────
// AI が生成したプレースホルダーを hero / body / summary の3枚固定に正規化する。

const FIXED_IMAGE_SLOTS = [
  { section_id: 'hero', suggested_filename: 'hero.jpg' },
  { section_id: 'body', suggested_filename: 'body.jpg' },
  { section_id: 'summary', suggested_filename: 'summary.jpg' },
] as const;

function normalizeImagePlaceholders(bodyHtml: string): string {
  // Collect all <!--IMAGE:...--> placeholders in document order
  const placeholderPattern = /<!--IMAGE:[^>]+-->/g;
  const matches = [...bodyHtml.matchAll(placeholderPattern)];

  if (matches.length === 0) return bodyHtml;

  let result = bodyHtml;
  // Process in reverse order so that replacement indices remain valid
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    if (i < FIXED_IMAGE_SLOTS.length) {
      // Replace with the fixed slot (hero/body/summary)
      const slot = FIXED_IMAGE_SLOTS[i];
      const corrected = `<!--IMAGE:${slot.section_id}:${slot.suggested_filename}-->`;
      result =
        result.substring(0, m.index!) +
        corrected +
        result.substring(m.index! + m[0].length);
    } else {
      // More placeholders than 3 slots — remove excess
      result =
        result.substring(0, m.index!) +
        result.substring(m.index! + m[0].length);
    }
  }

  return result;
}

// ─── CTA配置ノーマライズ ────────────────────────────────────────────────────
// CTA位置を after_intro / mid_article / in_summary の3箇所に正規化する。

function extractCtaPositions(bodyMarkdown: string): CtaPosition[] {
  const positions: CtaPosition[] = [];

  // after_intro: 記事冒頭付近のCTA
  if (
    bodyMarkdown.includes('<!--CTA:after_intro-->') ||
    bodyMarkdown.match(/<!--CTA_POSITION-->/i)
  ) {
    positions.push('after_intro');
  }

  // mid_article: 記事中盤のCTA
  if (
    bodyMarkdown.includes('<!--CTA:mid_article-->') ||
    bodyMarkdown.includes('<div class="mid-cta-wrapper">')
  ) {
    positions.push('mid_article');
  }

  // in_summary: まとめ部分のCTA
  if (bodyMarkdown.includes('<!--CTA:in_summary-->')) {
    positions.push('in_summary');
  }

  // デフォルト: 何も見つからなければ3箇所すべて配置
  if (positions.length === 0) {
    return ['after_intro', 'mid_article', 'in_summary'];
  }

  return positions;
}

// ─── メイン: チェーン実行 ────────────────────────────────────────────────────

/**
 * 3段階プロンプトチェーンを実行する。
 * Writing(temp0.7) → Proofreading(temp0.3) → QualityCheck(temp0.2)
 *
 * @param input - 構成案 + 記事情報
 * @param onProgress - 進捗コールバック（オプション）
 * @param options - スキップオプション、APIキー、モデル指定
 * @returns 最終結果 + 全ステップの生成ログ
 */
export async function executeStage2Chain(
  input: Stage2Input,
  onProgress?: (step: ChainStepName | 'qualitycheck', status: 'started' | 'completed') => void,
  options?: { skipQualityCheck?: boolean; apiKey?: string; model?: string },
): Promise<Stage2ChainResult> {
  const chainLog = createChainLog(input.articleId);
  const chainStart = Date.now();

  logger.info('ai', 'chain.start', {
    chainId: chainLog.chainId,
    articleId: input.articleId,
    keyword: input.keyword,
  });

  // ════════════════════════════════════════════════════════════════════════
  // ステップ 1: Writing (temp 0.7)
  // ════════════════════════════════════════════════════════════════════════

  onProgress?.('writing', 'started');
  let writingResult: WritingResult;
  let writingStepResult: ChainStepResult;

  {
    const stepStart = Date.now();
    const systemPrompt = buildWritingSystemPrompt(input);
    const userPrompt = buildWritingUserPrompt(input);

    try {
      const response = await generateText(systemPrompt, userPrompt, {
        temperature: 0.7,
        maxOutputTokens: 8192,
        timeoutMs: 120_000,
        maxRetries: 0, // チェーン内ではリトライしない（フォールバックで対応）
        apiKey: options?.apiKey,
        model: options?.model,
      });

      let bodyClean = response.text.trim();

      // ── IMAGE プレースホルダー補正（3枚固定: hero/body/summary）──
      const before = bodyClean;
      bodyClean = normalizeImagePlaceholders(bodyClean);
      if (before !== bodyClean) {
        logger.info('ai', 'chain.writing.image_placeholders_normalized', {
          chainId: chainLog.chainId,
          fixedSlots: FIXED_IMAGE_SLOTS.length,
          placeholdersBefore: (before.match(/<!--IMAGE:[^>]+-->/g) || []).length,
          placeholdersAfter: (bodyClean.match(/<!--IMAGE:[^>]+-->/g) || []).length,
        });
      }

      // CTA配置を3箇所に正規化
      const ctaPositions = extractCtaPositions(bodyClean);

      const imagePlaceholders = [...bodyClean.matchAll(/<!--IMAGE:([^>]+)-->/g)]
        .map((m) => m[1]);

      writingResult = {
        bodyMarkdown: bodyClean,
        chartData: null,
        ctaPositions,
        tablePositions: [],
        imagePlaceholders,
      };

      writingStepResult = {
        step: 'writing',
        success: true,
        durationMs: Date.now() - stepStart,
        tokenUsage: response.tokenUsage,
        rawOutput: bodyClean.substring(0, 500) + '...',
      };

      logger.info('ai', 'chain.writing.complete', {
        chainId: chainLog.chainId,
        durationMs: writingStepResult.durationMs,
        outputLength: bodyClean.length,
        ctaPositions,
        tokenUsage: response.tokenUsage,
      });
    } catch (error) {
      writingStepResult = {
        step: 'writing',
        success: false,
        durationMs: Date.now() - stepStart,
        tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        rawOutput: '',
        error: error instanceof Error ? error.message : String(error),
      };
      chainLog.steps.push(writingStepResult);
      logger.error('ai', 'chain.writing.failed', {
        chainId: chainLog.chainId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Writing失敗 → 中断
      throw new Error(`執筆ステップが失敗しました: ${writingStepResult.error}`);
    }
  }

  chainLog.steps.push(writingStepResult);
  onProgress?.('writing', 'completed');

  // ════════════════════════════════════════════════════════════════════════
  // ステップ 2: Proofreading (temp 0.3)
  // ════════════════════════════════════════════════════════════════════════

  onProgress?.('proofreading', 'started');
  let proofreadResult: ProofreadResult;
  let proofreadStepResult: ChainStepResult;

  {
    const stepStart = Date.now();
    const systemPrompt = buildProofreadingSystemPrompt();
    const userPrompt = buildProofreadingUserPrompt(writingResult.bodyMarkdown);

    try {
      const response = await generateText(systemPrompt, userPrompt, {
        temperature: 0.3, // 校閲は低温で正確に
        maxOutputTokens: 8192,
        timeoutMs: 60_000,
        maxRetries: 0,
        apiKey: options?.apiKey,
        model: options?.model,
      });

      const parsed = parseProofreadingResponse(response.text);
      proofreadResult = {
        correctedMarkdown: parsed.correctedText,
        corrections: parsed.corrections,
      };

      proofreadStepResult = {
        step: 'proofreading',
        success: true,
        durationMs: Date.now() - stepStart,
        tokenUsage: response.tokenUsage,
        rawOutput: response.text.substring(0, 500) + '...',
        parsedOutput: {
          correctionsCount: parsed.corrections.length,
          corrections: parsed.corrections,
        },
      };

      logger.info('ai', 'chain.proofreading.complete', {
        chainId: chainLog.chainId,
        durationMs: proofreadStepResult.durationMs,
        correctionsCount: parsed.corrections.length,
        tokenUsage: response.tokenUsage,
      });
    } catch (error) {
      // Proofreading失敗 → スキップ（Writing結果をそのまま使用）
      logger.warn('ai', 'chain.proofreading.failed_fallback', {
        chainId: chainLog.chainId,
        error: error instanceof Error ? error.message : String(error),
      });

      proofreadResult = {
        correctedMarkdown: writingResult.bodyMarkdown,
        corrections: [],
      };

      proofreadStepResult = {
        step: 'proofreading',
        success: false,
        durationMs: Date.now() - stepStart,
        tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        rawOutput: '',
        error: `校閲スキップ（フォールバック）: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  chainLog.steps.push(proofreadStepResult);
  onProgress?.('proofreading', 'completed');

  // ════════════════════════════════════════════════════════════════════════
  // skipQualityCheck: 品質チェックをスキップして校閲結果をそのまま返す
  // ════════════════════════════════════════════════════════════════════════

  if (options?.skipQualityCheck) {
    const totalDurationMs = Date.now() - chainStart;
    chainLog.completedAt = new Date().toISOString();
    chainLog.totalDurationMs = totalDurationMs;

    logger.info('ai', 'chain.complete_skip_qualitycheck', {
      chainId: chainLog.chainId,
      articleId: input.articleId,
      totalDurationMs,
      stepsSucceeded: chainLog.steps.filter((s) => s.success).length,
      stepsFailed: chainLog.steps.filter((s) => !s.success).length,
    });

    return {
      bodyHtml: proofreadResult.correctedMarkdown,
      chartData: null,
      generationLog: JSON.stringify(chainLog, null, 2),
      writingResult,
      proofreadResult,
      factcheckResult: {
        finalMarkdown: proofreadResult.correctedMarkdown,
        factIssues: [],
        chartData: null,
      },
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // ステップ 3: QualityCheck (temp 0.2)
  // ════════════════════════════════════════════════════════════════════════

  onProgress?.('qualitycheck', 'started');
  let factcheckResult: FactcheckResult;
  let qualityCheckStepResult: ChainStepResult;

  {
    const stepStart = Date.now();
    const systemPrompt = buildQualityCheckSystemPrompt();
    const userPrompt = buildQualityCheckUserPrompt(
      proofreadResult.correctedMarkdown,
      input.theme,
      input.keyword,
    );

    try {
      const response = await generateText(systemPrompt, userPrompt, {
        temperature: 0.2, // 品質チェックは最も低温で
        maxOutputTokens: 8192,
        timeoutMs: 60_000,
        maxRetries: 0,
        apiKey: options?.apiKey,
        model: options?.model,
      });

      const parsed = parseQualityCheckResponse(response.text);
      factcheckResult = {
        finalMarkdown: parsed.finalText,
        factIssues: parsed.factIssues,
        chartData: null,
      };

      qualityCheckStepResult = {
        step: 'qualitycheck',
        success: true,
        durationMs: Date.now() - stepStart,
        tokenUsage: response.tokenUsage,
        rawOutput: response.text.substring(0, 500) + '...',
        parsedOutput: {
          issuesCount: parsed.qualityIssues.length,
          qualityIssues: parsed.qualityIssues as unknown as Record<string, unknown>[],
        },
      };

      logger.info('ai', 'chain.qualitycheck.complete', {
        chainId: chainLog.chainId,
        durationMs: qualityCheckStepResult.durationMs,
        issuesCount: parsed.qualityIssues.length,
        tokenUsage: response.tokenUsage,
      });
    } catch (error) {
      // QualityCheck失敗 → スキップ（Proofreading結果をそのまま使用）
      logger.warn('ai', 'chain.qualitycheck.failed_fallback', {
        chainId: chainLog.chainId,
        error: error instanceof Error ? error.message : String(error),
      });

      factcheckResult = {
        finalMarkdown: proofreadResult.correctedMarkdown,
        factIssues: [],
        chartData: null,
      };

      qualityCheckStepResult = {
        step: 'qualitycheck',
        success: false,
        durationMs: Date.now() - stepStart,
        tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        rawOutput: '',
        error: `品質チェックスキップ（フォールバック）: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  chainLog.steps.push(qualityCheckStepResult);
  onProgress?.('qualitycheck', 'completed');

  // ════════════════════════════════════════════════════════════════════════
  // 結果集約
  // ════════════════════════════════════════════════════════════════════════

  const totalDurationMs = Date.now() - chainStart;
  chainLog.completedAt = new Date().toISOString();
  chainLog.totalDurationMs = totalDurationMs;

  logger.info('ai', 'chain.complete', {
    chainId: chainLog.chainId,
    articleId: input.articleId,
    totalDurationMs,
    stepsSucceeded: chainLog.steps.filter((s) => s.success).length,
    stepsFailed: chainLog.steps.filter((s) => !s.success).length,
  });

  return {
    bodyHtml: factcheckResult.finalMarkdown,
    chartData: factcheckResult.chartData,
    generationLog: JSON.stringify(chainLog, null, 2),
    writingResult,
    proofreadResult,
    factcheckResult,
  };
}
