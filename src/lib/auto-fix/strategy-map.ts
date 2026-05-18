// ============================================================================
// src/lib/auto-fix/strategy-map.ts
// CheckItem.id → 既定/許可される修復戦略のマッピング (P5-19, P5-28 改訂)
//
// quality-checklist.ts で実際に発行される ID と一致させる:
//   error_patterns / image_placeholders / banned_book / medical / ai_patterns
//   literary / soul_count / love_count / content_length / keyword_density
//   cta_count / cta_urls / title_banned / title_length / h2_structure
//   meta_description / double_quotes / abstract_expressions / soft_endings
//   metaphors / broken_links
//
// 仕様書: docs/auto-fix-spec.md §2.2
// ============================================================================

import type { AutoFixType, FixStrategy } from './types';

export interface StrategyMapEntry {
  allowed: FixStrategy[];
  auto_fix_type?: AutoFixType;
  needs?: ('keywords' | 'detected_phrase' | 'target_value' | 'current_value' | 'claim_idx' | 'chapter_idx')[];
}

export const STRATEGY_MAP: Record<string, StrategyMapEntry> = {
  // ─── キーワード ────────────────────────────────────────────
  keyword_density: {
    allowed: ['auto-fix', 'regen-chapter', 'manual-edit', 'ignore-warn'],
    auto_fix_type: 'keyword',
    needs: ['keywords'],
  },

  // ─── 文体 ─────────────────────────────────────────────────
  soft_endings: {
    allowed: ['auto-fix', 'manual-edit', 'ignore-warn'],
    auto_fix_type: 'suffix',
    needs: ['target_value', 'current_value'],
  },
  abstract_expressions: {
    allowed: ['auto-fix', 'manual-edit', 'ignore-warn'],
    auto_fix_type: 'abstract',
    needs: ['detected_phrase'],
  },
  metaphors: {
    allowed: ['manual-edit', 'ignore-warn'],
  },
  literary: {
    allowed: ['manual-edit', 'ignore-warn'],
  },
  // P5-111: 由起子さん FB「""禁止」を deterministic に処理 ("→「」)。
  double_quotes: {
    allowed: ['deterministic-fix', 'manual-edit', 'ignore-warn'],
  },

  // ─── コンテンツ ─────────────────────────────────────────
  content_length: {
    allowed: ['auto-fix', 'regen-chapter', 'manual-edit', 'ignore-warn'],
    auto_fix_type: 'length',
    needs: ['target_value', 'current_value'],
  },
  h2_structure: {
    allowed: ['regen-chapter', 'manual-edit', 'ignore-warn'],
  },
  meta_description: {
    allowed: ['manual-edit', 'ignore-warn'],
  },

  // ─── 画像 ───────────────────────────────────────────────
  image_placeholders: {
    // P5-26 で run-completion 内自動置換、編集画面で「画像を反映」もある
    // P5-111: canonical helper を deterministic-fix 経由で UI 直叩き可能化
    allowed: ['deterministic-fix', 'manual-edit', 'ignore-warn'],
  },

  // ─── CTA ────────────────────────────────────────────────
  cta_count: {
    allowed: ['regen-chapter', 'manual-edit', 'ignore-warn'],
  },
  // P5-111: 不正 CTA href を canonical URL に一発置換 (regex のみ、本文は不変)
  cta_urls: {
    allowed: ['deterministic-fix', 'manual-edit', 'ignore-warn'],
  },

  // ─── タイトル ──────────────────────────────────────────
  title_banned: {
    allowed: ['manual-edit'],
  },
  title_length: {
    allowed: ['manual-edit', 'ignore-warn'],
  },

  // ─── 安全禁止 (auto-fix 不可、危険) ─────────────────────
  banned_book: { allowed: ['manual-edit'] },
  medical: { allowed: ['manual-edit'] },
  ai_patterns: { allowed: ['manual-edit', 'ignore-warn'] },
  // P5-111: AI 生成残骸 / IMAGE トークンを deterministic に除去 (text 限定)
  error_patterns: {
    allowed: ['deterministic-fix', 'manual-edit', 'ignore-warn'],
  },
  soul_count: { allowed: ['manual-edit', 'ignore-warn'] },
  love_count: { allowed: ['manual-edit', 'ignore-warn'] },
  broken_links: { allowed: ['manual-edit', 'ignore-warn'] },

  // ─── ハルシネーション (新形式・後方互換) ─────────────────
  hallucination_critical: {
    allowed: ['regen-chapter', 'manual-edit'],
    needs: ['chapter_idx'],
  },
  hallucination_warning: {
    allowed: ['auto-fix', 'manual-edit', 'ignore-warn'],
    auto_fix_type: 'claim',
    needs: ['claim_idx'],
  },
  tone_low: {
    allowed: ['auto-fix', 'regen-full', 'manual-edit', 'ignore-warn'],
    auto_fix_type: 'tone',
  },
};

/** 既定 fallback (未登録 id) */
export const DEFAULT_STRATEGY: StrategyMapEntry = {
  allowed: ['manual-edit', 'ignore-warn'],
};

export function getStrategyFor(checkItemId: string): StrategyMapEntry {
  return STRATEGY_MAP[checkItemId] ?? DEFAULT_STRATEGY;
}

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
