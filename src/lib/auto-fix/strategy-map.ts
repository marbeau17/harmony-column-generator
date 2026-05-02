// ============================================================================
// src/lib/auto-fix/strategy-map.ts
// CheckItem.id → 既定/許可される修復戦略のマッピング (P5-19)
//
// 仕様書: docs/auto-fix-spec.md §2.2
// ============================================================================

import type { AutoFixType, FixStrategy } from './types';

/** 各 check_item に対する許可された戦略 + 既定戦略 + auto-fix 種別 */
export interface StrategyMapEntry {
  /** UI に出すボタンの順番 (左→右、既定が先頭) */
  allowed: FixStrategy[];
  /** auto-fix の種別 (auto-fix が allowed の場合のみ意味あり) */
  auto_fix_type?: AutoFixType;
  /** 当該 item を auto-fix で修復する際の、Gemini に渡すパラメータ取得関数名 (UI 側ヒント) */
  needs?: ('keywords' | 'detected_phrase' | 'target_value' | 'current_value' | 'claim_idx' | 'chapter_idx')[];
}

/**
 * デフォルトマッピング表。
 * 未登録の check_item_id は `manual-edit` のみ許可される (安全側 fallback)。
 */
export const STRATEGY_MAP: Record<string, StrategyMapEntry> = {
  // ─── 文体 ─────────────────────────────────────────────────
  soft_ending_ratio: {
    allowed: ['auto-fix', 'manual-edit', 'ignore-warn'],
    auto_fix_type: 'suffix',
    needs: ['target_value', 'current_value'],
  },
  abstract_spiritual: {
    allowed: ['auto-fix', 'manual-edit', 'ignore-warn'],
    auto_fix_type: 'abstract',
    needs: ['detected_phrase'],
  },

  // ─── SEO ─────────────────────────────────────────────────
  keyword_occurrence: {
    allowed: ['auto-fix', 'regen-chapter', 'manual-edit'],
    auto_fix_type: 'keyword',
    needs: ['keywords'],
  },

  // ─── コンテンツ ─────────────────────────────────────────
  body_length: {
    allowed: ['auto-fix', 'regen-chapter', 'manual-edit'],
    auto_fix_type: 'length',
    needs: ['target_value', 'current_value'],
  },

  // ─── ハルシネーション ──────────────────────────────────
  hallucination_critical: {
    allowed: ['regen-chapter', 'manual-edit'],
    needs: ['chapter_idx'],
  },
  hallucination_warning: {
    allowed: ['auto-fix', 'manual-edit', 'ignore-warn'],
    auto_fix_type: 'claim',
    needs: ['claim_idx'],
  },

  // ─── トーン ─────────────────────────────────────────────
  tone_low: {
    allowed: ['auto-fix', 'regen-full', 'manual-edit'],
    auto_fix_type: 'tone',
  },

  // ─── 安全禁止 (auto-fix 不可、危険) ─────────────────────
  book_expression: { allowed: ['manual-edit'] },
  ai_pattern: { allowed: ['manual-edit', 'ignore-warn'] },
  medical_expression: { allowed: ['manual-edit'] },

  // ─── 画像/CTA ──────────────────────────────────────────
  image_placeholder: { allowed: ['manual-edit'] },
  cta_url_invalid: { allowed: ['manual-edit'] },
  cta_count: { allowed: ['regen-chapter', 'manual-edit'] },
};

/** 既定 fallback (未登録 id) */
export const DEFAULT_STRATEGY: StrategyMapEntry = {
  allowed: ['manual-edit', 'ignore-warn'],
};

/**
 * check_item_id に対する戦略マップを取得する。
 * 未登録なら DEFAULT_STRATEGY を返す。
 */
export function getStrategyFor(checkItemId: string): StrategyMapEntry {
  return STRATEGY_MAP[checkItemId] ?? DEFAULT_STRATEGY;
}

/**
 * 与えられた fix_strategy が check_item に対して許可されているか確認。
 * 不許可なら理由付きで返す (API バリデーション用)。
 */
export function isStrategyAllowed(
  checkItemId: string,
  strategy: FixStrategy,
): { allowed: true } | { allowed: false; reason: string } {
  const entry = getStrategyFor(checkItemId);
  if (entry.allowed.includes(strategy)) return { allowed: true };
  return {
    allowed: false,
    reason: `check_item_id="${checkItemId}" に対し戦略 "${strategy}" は許可されていません。許可: ${entry.allowed.join(', ')}`,
  };
}
