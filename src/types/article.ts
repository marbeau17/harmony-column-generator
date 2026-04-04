// ============================================================================
// src/types/article.ts
// 記事関連の型定義
// スピリチュアルコラム向け（シングルテナント）
// ============================================================================

import type { Stage1OutlineResult } from './ai';

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
  is_processed: boolean;
  created_at: string;
}
