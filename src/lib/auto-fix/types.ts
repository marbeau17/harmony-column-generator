// ============================================================================
// src/lib/auto-fix/types.ts
// Auto-Fix 機能の型定義 (P5-19)
// ============================================================================

import type { ChecklistResult } from '@/lib/content/quality-checklist';

export type FixStrategy =
  | 'auto-fix'
  | 'regen-chapter'
  | 'regen-full'
  | 'ignore-warn'
  | 'manual-edit';

export type AutoFixType =
  | 'suffix'      // 語尾不足
  | 'keyword'     // キーワード未出現
  | 'abstract'    // 抽象表現
  | 'length'      // 文字数不足
  | 'claim'       // ハルシネーション claim
  | 'tone';       // トーン全体

export interface AutoFixParams {
  fix_type: AutoFixType;
  target_value?: number;
  keywords?: string[];
  claim_idx?: number;
  detected_phrase?: string;
  current_value?: number;
}

export interface RegenChapterParams {
  chapter_idx: number;
}

export interface IgnoreWarnParams {
  reason: string;
}

export interface AutoFixRequest {
  fix_strategy: FixStrategy;
  check_item_id: string;
  auto_fix_params?: AutoFixParams;
  regen_params?: RegenChapterParams;
  ignore_params?: IgnoreWarnParams;
}

export interface AutoFixResponse {
  ok: boolean;
  fix_strategy: FixStrategy;
  check_item_id: string;
  before_html?: string;
  after_html?: string;
  diff_summary?: string;
  recheck?: ChecklistResult;
  /** 概算コスト (USD) */
  cost_estimate?: number;
  error_message?: string;
}

export interface QualityOverride {
  check_item_id: string;
  ignored_at: string;     // ISO datetime
  reason: string;
  ignored_by?: string | null;  // user uuid
}
