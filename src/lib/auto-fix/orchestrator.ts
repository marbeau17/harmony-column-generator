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

// ─── P5-111 post-validate guards ──────────────────────────────────────────
// AI 書換出力が「記事を壊している」ことを物理的に検知して throw する。
// runAutoFix → DB UPDATE の手前に必ず通すこと。

const MIN_BODY_RETENTION_RATIO = 0.8; // 80% 未満に縮んだら NG
const MIN_BODY_LENGTH = 200;          // 絶対下限

function countMatches(html: string, re: RegExp): number {
  return (html.match(re) || []).length;
}

interface PostValidateResult {
  ok: boolean;
  reason?: string;
  before: Record<string, number>;
  after: Record<string, number>;
}

/**
 * AI 出力の構造変化を before/after で比較。違反があれば ok=false で reason を返す。
 * チェック観点:
 *   1. 本文長が 20% 超縮小していないか
 *   2. 本文絶対長 >= 200 chars
 *   3. h2 数 / img タグ数 / CTA ブロック数 / 画像 placeholder 数が after で
 *      **減っていない** こと (増加は OK、減少は NG)
 *   4. <script> タグが before に無かった場合、after で新規注入されていないこと
 *      (prompt injection / XSS 防止)
 */
export function postValidateAutoFix(before: string, after: string): PostValidateResult {
  const beforeStats: Record<string, number> = {
    length: before.length,
    h2: countMatches(before, /<h2[\s>]/gi),
    h3: countMatches(before, /<h3[\s>]/gi),
    img: countMatches(before, /<img[\s>]/gi),
    cta: countMatches(before, /class="harmony-cta[\s"]/g),
    placeholder:
      countMatches(before, /<!--IMAGE:[^>]*-->/g) +
      countMatches(before, /\[IMG_(HERO|BODY|SUMMARY)\]/g),
    script: countMatches(before, /<script[\s>]/gi),
  };
  const afterStats: Record<string, number> = {
    length: after.length,
    h2: countMatches(after, /<h2[\s>]/gi),
    h3: countMatches(after, /<h3[\s>]/gi),
    img: countMatches(after, /<img[\s>]/gi),
    cta: countMatches(after, /class="harmony-cta[\s"]/g),
    placeholder:
      countMatches(after, /<!--IMAGE:[^>]*-->/g) +
      countMatches(after, /\[IMG_(HERO|BODY|SUMMARY)\]/g),
    script: countMatches(after, /<script[\s>]/gi),
  };

  if (afterStats.length < MIN_BODY_LENGTH) {
    return {
      ok: false,
      reason: `本文が極端に短い (${afterStats.length} chars < ${MIN_BODY_LENGTH})。AI 出力が破損している可能性`,
      before: beforeStats,
      after: afterStats,
    };
  }
  if (
    beforeStats.length > 0 &&
    afterStats.length / beforeStats.length < MIN_BODY_RETENTION_RATIO
  ) {
    const ratio = ((afterStats.length / beforeStats.length) * 100).toFixed(1);
    return {
      ok: false,
      reason: `本文が ${ratio}% に縮小 (前 ${beforeStats.length} → 後 ${afterStats.length} chars)。許容下限 ${MIN_BODY_RETENTION_RATIO * 100}%`,
      before: beforeStats,
      after: afterStats,
    };
  }
  if (afterStats.h2 < beforeStats.h2) {
    return {
      ok: false,
      reason: `H2 見出し数が減少 (前 ${beforeStats.h2} → 後 ${afterStats.h2})。記事構造が破損`,
      before: beforeStats,
      after: afterStats,
    };
  }
  if (afterStats.img < beforeStats.img) {
    return {
      ok: false,
      reason: `<img> タグが減少 (前 ${beforeStats.img} → 後 ${afterStats.img})。AI が画像を消した可能性`,
      before: beforeStats,
      after: afterStats,
    };
  }
  if (afterStats.cta < beforeStats.cta) {
    return {
      ok: false,
      reason: `CTA ブロックが減少 (前 ${beforeStats.cta} → 後 ${afterStats.cta})。CTA が消去された可能性`,
      before: beforeStats,
      after: afterStats,
    };
  }
  if (afterStats.placeholder < beforeStats.placeholder) {
    return {
      ok: false,
      reason: `画像プレースホルダが減少 (前 ${beforeStats.placeholder} → 後 ${afterStats.placeholder})。画像反映前に消去された可能性`,
      before: beforeStats,
      after: afterStats,
    };
  }
  if (afterStats.script > beforeStats.script) {
    return {
      ok: false,
      reason: `<script> タグが新規注入されました (前 ${beforeStats.script} → 後 ${afterStats.script})。AI prompt injection の疑い`,
      before: beforeStats,
      after: afterStats,
    };
  }

  return { ok: true, before: beforeStats, after: afterStats };
}

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
  // P5-111: AI 書換は記事破壊の最大の発生源。before/after を比較して構造変化を
  // 検知し、許容外なら throw して DB UPDATE 自体を block する (silent corruption 禁止)。
  const validation = postValidateAutoFix(bodyHtml, after_html);
  if (!validation.ok) {
    console.error('[auto-fix.post_validate.failed]', {
      fix_type: params.fix_type,
      reason: validation.reason,
      before: validation.before,
      after: validation.after,
    });
    throw new Error(`AI auto-fix が記事を破壊している疑いがあります: ${validation.reason}`);
  }
  console.log('[auto-fix.post_validate.ok]', {
    fix_type: params.fix_type,
    before: validation.before,
    after: validation.after,
  });
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
