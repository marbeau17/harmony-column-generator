// ============================================================================
// src/types/article.ts
// 記事関連の型定義
// スピリチュアルコラム向け（シングルテナント）
// ============================================================================

import type { Stage1OutlineResult } from './ai';
// P5-43 / spec v2.1 §3.1 — visibility_state は publish-control の 8 値を参照する。
import type { VisibilityState } from '@/lib/publish-control/state-machine';

// 再 export: 既存の callers が `@/types/article` 経由で取得できるようにする。
export type { VisibilityState } from '@/lib/publish-control/state-machine';

/**
 * 記事の意図ラベル（spec v2.1 §2.1）。
 *  - info       : 情報提供
 *  - empathy    : 共感寄り添い
 *  - solve      : 解決策提示
 *  - introspect : 内省促し
 */
export type ArticleIntent = 'info' | 'empathy' | 'solve' | 'introspect';

export const ARTICLE_INTENTS: readonly ArticleIntent[] = [
  'info',
  'empathy',
  'solve',
  'introspect',
] as const;

// ─── Enum / Union Types ──────────────────────────────────────────────────────

/** 記事のステータス */
export type ArticleStatus =
  | 'draft'
  | 'outline_pending'
  | 'outline_approved'
  | 'body_generating'
  | 'body_review'
  | 'editing'
  | 'published';

export const ARTICLE_STATUSES: readonly ArticleStatus[] = [
  'draft',
  'outline_pending',
  'outline_approved',
  'body_generating',
  'body_review',
  'editing',
  'published',
] as const;

// P5-59: 生成モードの厳密型。zero=新規生成 / source=書き換え / null=legacy。
//        従来 string 型で散在していた generation_mode を本ユニオンで統一する。
export type GenerationMode = 'zero' | 'source';

export const GENERATION_MODES: readonly GenerationMode[] = [
  'zero',
  'source',
] as const;

/** 視点タイプ（元記事→コラムへの変換アプローチ） */
export type PerspectiveType =
  | 'experience_to_lesson'
  | 'personal_to_universal'
  | 'concept_to_practice'
  | 'case_to_work'
  | 'past_to_modern'
  | 'deep_to_intro';

export const PERSPECTIVE_TYPES: readonly PerspectiveType[] = [
  'experience_to_lesson',
  'personal_to_universal',
  'concept_to_practice',
  'case_to_work',
  'past_to_modern',
  'deep_to_intro',
] as const;

/** テーマカテゴリ */
export type ThemeCategory =
  | 'soul_mission'
  | 'relationships'
  | 'grief_care'
  | 'self_growth'
  | 'healing'
  | 'daily_awareness'
  | 'spiritual_intro';

export const THEME_CATEGORIES: readonly ThemeCategory[] = [
  'soul_mission',
  'relationships',
  'grief_care',
  'self_growth',
  'healing',
  'daily_awareness',
  'spiritual_intro',
] as const;

/** ペルソナタイプ */
export type PersonaType =
  | 'spiritual_beginner'
  | 'self_growth_seeker'
  | 'grief_sufferer'
  | 'meditation_practitioner'
  | 'energy_worker'
  | 'life_purpose_seeker'
  | 'holistic_health_seeker';

export const PERSONA_TYPES: readonly PersonaType[] = [
  'spiritual_beginner',
  'self_growth_seeker',
  'grief_sufferer',
  'meditation_practitioner',
  'energy_worker',
  'life_purpose_seeker',
  'holistic_health_seeker',
] as const;

// ─── 関連記事 ────────────────────────────────────────────────────────────────

export interface RelatedArticle {
  href: string;
  title: string;
}

// ─── 記事インターフェース ────────────────────────────────────────────────────

export interface Article {
  id: string;
  status: ArticleStatus;
  title: string | null;
  slug: string | null;
  content: string | null;
  meta_description: string | null;
  keyword: string;
  theme: string;
  persona: string;
  source_article_id: string | null;
  perspective_type: PerspectiveType | null;
  target_word_count: number;

  /** Stage1 構成案 (JSON) */
  stage1_outline: Stage1OutlineResult | null;
  /** Stage2 本文HTML */
  stage2_body_html: string | null;
  /** Stage3 最終HTML */
  stage3_final_html: string | null;
  /** 公開用HTML（Stage3確定後のスナップショット） */
  published_html: string | null;

  /** 画像生成プロンプト (JSON) */
  image_prompts: unknown | null;
  /** 生成済み画像ファイル情報 (JSON) */
  image_files: unknown | null;
  /** CTA文言 (JSON) */
  cta_texts: unknown | null;
  /** FAQ データ (JSON) */
  faq_data: unknown | null;
  /** 構造化データ / JSON-LD (JSON) */
  structured_data: unknown | null;
  /** SEOスコア (JSON) */
  seo_score: unknown | null;
  /** 関連記事 (JSON) */
  related_articles: RelatedArticle[] | null;

  published_url: string | null;
  published_at: string | null;
  // audit-only: P5-43 Step 4 — reviewed_at / reviewed_by は監査用タイムスタンプ。
  //   状態判定 (ハブ表示・FTP deploy ゲート・sitemap・SSG) には使用しない。
  //   書込は POST /api/articles/[id]/review (action='approve') のみが行う。
  //   詳細: docs/refactor/publish-control-unification.md §3.2 / §5 Step 4。
  reviewed_at: string | null;
  reviewed_by: string | null;

  // ─── spec v2.1 §2.1 articles テーブル拡張 12 列 ────────────────────────────
  /** 生成モード（zero=新規生成 / source=既存記事書換）。DB 側 DEFAULT 'source'。 */
  generation_mode?: GenerationMode | null;
  /** 記事の意図ラベル。NULL 許可。 */
  intent?: ArticleIntent | null;
  /** LLMO 用 100-150字 概要（v2.1 で追加）。 */
  lead_summary?: string | null;
  /** 引用ハイライト 3 件（JSONB。配列形式を想定）。 */
  citation_highlights?: unknown;
  /** 物語アーク（v2.1 で TEXT→JSONB に訂正）。 */
  narrative_arc?: unknown;
  /** 感情曲線（JSONB）。 */
  emotion_curve?: unknown;
  /** 0-100 のハルシネーション安全性スコア。 */
  hallucination_score?: number | null;
  /** 0-1 の由起子トーン類似度スコア。 */
  yukiko_tone_score?: number | null;
  /** 可読性スコア。 */
  readability_score?: number | null;
  /** 品質ゲート override 配列（check_item_id ignore リスト。JSONB）。 */
  quality_overrides?: unknown;
  /** publish-control v2 の可視性ステート（spec §3.1 の 8 値）。 */
  visibility_state?: VisibilityState | null;
  /** visibility_state 最終更新時刻 (ISO8601)。 */
  visibility_updated_at?: string | null;

  // 既存（spec v2.1 で legacy/parallel 列として残置）
  is_hub_visible?: boolean | null;

  created_at: string;
  updated_at: string;
}

// ─── 元記事インターフェース ──────────────────────────────────────────────────

export interface SourceArticle {
  id: string;
  title: string;
  content: string;
  original_url: string | null;
  published_at: string | null;
  themes: string[];
  keywords: string[];
  theme_category?: string;
  is_processed: boolean;
  created_at: string;
}
