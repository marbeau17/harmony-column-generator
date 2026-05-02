// ============================================================================
// src/lib/validators/zero-generate.ts
// ゼロ生成 API (POST /api/articles/zero-generate) のリクエスト検証スキーマ
//
// spec §12.1 を独立ファイルで定義し、API ルート / テスト / 将来の SSE 進捗ハンドラ
// から再利用できるようにする。
// ============================================================================

import { z } from 'zod';

/**
 * ZG-Intent: 記事の方向性 4 分類。
 * - info        : 情報提供型
 * - empathy     : 共感型
 * - solve       : 課題解決型
 * - introspect  : 内省・自己探求型
 */
export const intentSchema = z.enum(['info', 'empathy', 'solve', 'introspect']);

export type ZeroGenerateIntent = z.infer<typeof intentSchema>;

/**
 * POST /api/articles/zero-generate のリクエストボディ。
 *
 * - keywords は 1〜8 件
 * - target_length は 500〜10000（既存 createArticleSchema と整合）
 */
export const zeroGenerateRequestSchema = z.object({
  theme_id: z
    .string()
    .uuid('theme_id は UUID 形式で指定してください'),
  persona_id: z
    .string()
    .uuid('persona_id は UUID 形式で指定してください'),
  keywords: z
    .array(z.string().min(1, 'キーワードは空文字不可'))
    .min(1, 'keywords は1件以上必要です')
    .max(8, 'keywords は最大8件までです'),
  intent: intentSchema,
  target_length: z
    .number()
    .int('target_length は整数で指定してください')
    .min(500, 'target_length は500以上で指定してください')
    .max(10000, 'target_length は10000以下で指定してください'),
});

export type ZeroGenerateRequest = z.infer<typeof zeroGenerateRequestSchema>;

/**
 * POST /api/articles/zero-generate/suggest-keywords のリクエストボディ。
 *
 * - theme_id / persona_id 必須（候補生成のための context）
 * - intent / exclude は optional（ユーザがまだ選択していない初期段階でも呼べる）
 * - exclude は既に追加済キーワード（提案で重複させないため）
 */
export const suggestKeywordsRequestSchema = z.object({
  theme_id: z.string().uuid('theme_id は UUID 形式で指定してください'),
  persona_id: z.string().uuid('persona_id は UUID 形式で指定してください'),
  intent: intentSchema.optional(),
  exclude: z.array(z.string()).max(20).optional(),
});

export type SuggestKeywordsRequest = z.infer<typeof suggestKeywordsRequestSchema>;

/** 候補の出所。persona = DB の search_patterns 由来 / ai = Gemini 提案。 */
export type KeywordSuggestionSource = 'persona' | 'ai';

export interface KeywordSuggestion {
  keyword: string;
  source: KeywordSuggestionSource;
  rationale: string;
  /** 0..1 のスコア（並び替え用、UI 表示には使わない） */
  score: number;
}

export interface SuggestKeywordsResponse {
  candidates: KeywordSuggestion[];
  /** ペルソナ + テーマ要約。UI でデバッグ確認用に表示してもよい */
  context: {
    theme_name: string;
    persona_name: string;
    persona_age_range: string | null;
  };
}
