// ============================================================================
// src/lib/auto-fix/orchestrator.ts
// Auto-Fix オーケストレータ (P5-19)
//
// API ルートから呼ばれ、4 戦略をディスパッチする:
//   - auto-fix: 6 プロンプトのいずれかで Gemini 呼出 → 4 形態正規化
//   - regen-chapter: 既存 regenerate-segment ロジックを呼ぶ (将来拡張)
//   - regen-full: 同上 scope=full
//   - ignore-warn: quality_overrides 列に append
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateJson } from '@/lib/ai/gemini-client';
import { normalizeStage2Html } from '@/lib/ai/stage2-html-normalize';
import { buildAutoFixPrompt } from '@/lib/auto-fix/prompts';
import type {
  AutoFixParams,
  AutoFixResponse,
  IgnoreWarnParams,
  QualityOverride,
} from '@/lib/auto-fix/types';

const AUTO_FIX_TEMPERATURE = 0.5;
const AUTO_FIX_TOP_P = 0.9;
const AUTO_FIX_MAX_OUTPUT_TOKENS = 32000;

// 概算コスト (Gemini 3.1 Pro 入力 + 出力 token 単価ベース)
// 仕様書 §2.4 で「~$0.005-0.01」を提示しているが、実際は入力長に依存。
// UI 上の見積として固定値を返す。
const COST_ESTIMATE_USD: Record<string, number> = {
  suffix: 0.005,
  keyword: 0.005,
  abstract: 0.005,
  length: 0.01,
  claim: 0.005,
  tone: 0.015,
};

/**
 * auto-fix 戦略: 6 プロンプトのいずれかを実行して書換 HTML を返す。
 * 失敗時は throw。
 */
export async function runAutoFix(args: {
  bodyHtml: string;
  params: AutoFixParams;
}): Promise<{ after_html: string; cost_estimate: number }> {
  const { bodyHtml, params } = args;
  const { system, user } = buildAutoFixPrompt(bodyHtml, params);

  const t0 = Date.now();
  console.log('[auto-fix.gemini.begin]', {
    fix_type: params.fix_type,
    body_chars: bodyHtml.length,
    prompt_chars: system.length + user.length,
  });

  const { data } = await generateJson<unknown>(system, user, {
    temperature: AUTO_FIX_TEMPERATURE,
    topP: AUTO_FIX_TOP_P,
    maxOutputTokens: AUTO_FIX_MAX_OUTPUT_TOKENS,
  });

  const after_html = normalizeStage2Html(data);
  console.log('[auto-fix.gemini.end]', {
    fix_type: params.fix_type,
    after_chars: after_html.length,
    elapsed_ms: Date.now() - t0,
  });
  if (!after_html || after_html.length < 100) {
    throw new Error(
      `auto-fix returned empty/too short HTML (chars=${after_html.length})`,
    );
  }
  return {
    after_html,
    cost_estimate: COST_ESTIMATE_USD[params.fix_type] ?? 0.01,
  };
}

/**
 * ignore-warn 戦略: articles.quality_overrides に append。
 */
export async function appendQualityOverride(args: {
  supabase: SupabaseClient;
  articleId: string;
  checkItemId: string;
  ignoreParams: IgnoreWarnParams;
  userId: string | null;
  existingOverrides: QualityOverride[];
}): Promise<{ overrides: QualityOverride[] }> {
  const newOverride: QualityOverride = {
    check_item_id: args.checkItemId,
    ignored_at: new Date().toISOString(),
    reason: args.ignoreParams.reason,
    ignored_by: args.userId,
  };
  // 既存 override が同 check_item にあれば置換、なければ追加
  const filtered = args.existingOverrides.filter(
    (o) => o.check_item_id !== args.checkItemId,
  );
  const overrides = [...filtered, newOverride];

  const { error } = await args.supabase
    .from('articles')
    .update({ quality_overrides: overrides })
    .eq('id', args.articleId);
  if (error) {
    throw new Error(`quality_overrides update failed: ${error.message}`);
  }
  console.log('[auto-fix.override.appended]', {
    articleId: args.articleId,
    check_item_id: args.checkItemId,
    overrides_count: overrides.length,
  });
  return { overrides };
}

/**
 * 修復前後の差分サマリを生成 (UI 表示用、簡易な diff 文字列)。
 */
export function buildDiffSummary(before: string, after: string): string {
  const beforeLen = before.length;
  const afterLen = after.length;
  const delta = afterLen - beforeLen;
  const sign = delta >= 0 ? '+' : '';
  return `before=${beforeLen}, after=${afterLen}, delta=${sign}${delta} chars`;
}

export const AUTO_FIX_CONSTANTS = {
  TEMPERATURE: AUTO_FIX_TEMPERATURE,
  TOP_P: AUTO_FIX_TOP_P,
  MAX_OUTPUT_TOKENS: AUTO_FIX_MAX_OUTPUT_TOKENS,
  COST_ESTIMATE_USD,
} as const;

export type AutoFixDispatchResult = AutoFixResponse;
