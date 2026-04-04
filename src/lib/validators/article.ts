// ============================================================================
// src/lib/validators/article.ts
// 記事関連の Zod バリデーションスキーマ
// ============================================================================

import { z } from 'zod';
import {
  ARTICLE_STATUSES,
  PERSPECTIVE_TYPES,
} from '@/types/article';
import type { ArticleStatus, PerspectiveType } from '@/types/article';

// ─── 汎用バリデーション関数 ──────────────────────────────────────────────────

type ValidationSuccess<T> = { success: true; data: T };
type ValidationError = { success: false; error: z.ZodError };
type ValidationResult<T> = ValidationSuccess<T> | ValidationError;

/**
 * スキーマとデータを受け取り、バリデーション結果を返す
 */
export function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
): ValidationResult<T> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

// ─── UUID ────────────────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();

// ─── 記事作成スキーマ ────────────────────────────────────────────────────────

export const createArticleSchema = z.object({
  keyword: z
    .string()
    .min(1, 'キーワードは必須です')
    .max(255, 'キーワードは255文字以内で入力してください'),
  theme: z
    .string()
    .min(1, 'テーマは必須です')
    .max(100, 'テーマは100文字以内で入力してください'),
  target_persona: z
    .string()
    .min(1, 'ターゲットペルソナは必須です')
    .max(255, 'ターゲットペルソナは255文字以内で入力してください'),
  source_article_id: uuidSchema.optional(),
  perspective_type: z
    .enum(PERSPECTIVE_TYPES as unknown as [PerspectiveType, ...PerspectiveType[]])
    .optional(),
  target_word_count: z
    .number()
    .int('目標文字数は整数で指定してください')
    .min(500, '目標文字数は500以上で指定してください')
    .max(10000, '目標文字数は10000以下で指定してください')
    .default(2000),
});

export type CreateArticleInput = z.infer<typeof createArticleSchema>;

// ─── 記事更新スキーマ ────────────────────────────────────────────────────────

const relatedArticleSchema = z.object({
  href: z.string().min(1),
  title: z.string().min(1),
});

export const updateArticleSchema = z.object({
  title: z.string().max(500, 'タイトルは500文字以内で入力してください').optional(),
  slug: z.string().max(255).optional(),
  meta_description: z
    .string()
    .max(500, 'メタディスクリプションは500文字以内で入力してください')
    .optional(),
  keyword: z.string().min(1).max(255).optional(),
  theme: z.string().min(1).max(100).optional(),
  stage1_outline: z.unknown().optional(),
  stage3_final_html: z.string().optional(),
  published_html: z.string().optional(),
  published_at: z.string().optional(),
  related_articles: z.array(relatedArticleSchema).optional(),
  image_files: z.unknown().optional(),
  cta_texts: z.unknown().optional(),
});

export type UpdateArticleInput = z.infer<typeof updateArticleSchema>;

// ─── 構成案更新スキーマ ──────────────────────────────────────────────────────

const headingSchema: z.ZodType<{
  level: 'h2' | 'h3';
  text: string;
  estimated_words: number;
  children?: { level: 'h2' | 'h3'; text: string; estimated_words: number }[];
}> = z.object({
  level: z.enum(['h2', 'h3']),
  text: z.string().min(1),
  estimated_words: z.number().int().min(0),
  children: z
    .array(
      z.object({
        level: z.enum(['h2', 'h3']),
        text: z.string().min(1),
        estimated_words: z.number().int().min(0),
      }),
    )
    .optional(),
});

const imagePromptSchema = z.object({
  section_id: z.string().min(1),
  heading_text: z.string().min(1),
  prompt: z.string().min(1),
  suggested_filename: z.string().min(1),
});

const faqSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

export const updateOutlineSchema = z.object({
  seo_filename: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'SEOファイル名は半角英小文字・数字・ハイフンのみ使用可能です')
    .optional(),
  title_proposal: z
    .string()
    .min(1, 'タイトル案は必須です')
    .max(500, 'タイトル案は500文字以内で入力してください')
    .optional(),
  meta_description: z
    .string()
    .max(200, 'メタディスクリプションは200文字以内で入力してください')
    .optional(),
  headings: z.array(headingSchema),
  image_prompts: z.array(imagePromptSchema).optional(),
  faq: z.array(faqSchema).optional(),
});

export type UpdateOutlineInput = z.infer<typeof updateOutlineSchema>;

// ─── 記事一覧クエリスキーマ ──────────────────────────────────────────────────

export const listArticlesQuerySchema = z.object({
  status: z
    .enum(ARTICLE_STATUSES as unknown as [ArticleStatus, ...ArticleStatus[]])
    .optional(),
  keyword: z.string().max(255).optional(),
  limit: z
    .number()
    .int()
    .min(1, 'limitは1以上で指定してください')
    .max(100, 'limitは100以下で指定してください')
    .default(20),
  offset: z
    .number()
    .int()
    .min(0, 'offsetは0以上で指定してください')
    .default(0),
});

export type ListArticlesQuery = z.infer<typeof listArticlesQuerySchema>;
