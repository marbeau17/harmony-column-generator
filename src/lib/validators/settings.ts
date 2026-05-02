// ============================================================================
// src/lib/validators/settings.ts
// 設定関連の Zod バリデーションスキーマ
// ============================================================================

import { z } from 'zod';

// ─── セクション別スキーマ ───────────────────────────────────────────────────

const basicSettingsSchema = z.object({
  site_name: z.string().optional(),
  author_name: z.string().optional(),
  author_profile: z.string().optional(),
});

const aiSettingsSchema = z.object({
  gemini_model: z.string().min(1).optional(),
  default_char_count: z
    .number()
    .int('目標文字数は整数で指定してください')
    .min(500, '目標文字数は500以上で指定してください')
    .max(5000, '目標文字数は5000以下で指定してください')
    .optional(),
  default_persona: z.string().optional(),
  default_theme: z.string().optional(),
});

const ctaItemSchema = z.object({
  url: z.string().url('有効なURLを入力してください').optional().or(z.literal('')),
  buttonText: z.string().optional(),
  catchText: z.string().optional(),
  subText: z.string().optional(),
  bannerUrl: z.string().optional(),
  bannerAlt: z.string().optional(),
});

const ctaSettingsSchema = z.object({
  cta2: ctaItemSchema.optional(),
  cta3: ctaItemSchema.optional(),
});

// schema.org 構造化データ設定 (詳細は docs/schema-org-settings-spec.md)
// すべて optional。未指定フィールドは DEFAULT_SEO_SETTINGS でフォールバック。
const seoSettingsSchema = z.object({
  // サイト基本
  site_url: z.string().optional(),
  site_name: z.string().optional(),
  site_logo_url: z.string().optional(),
  og_default_image_url: z.string().optional(),

  // 著者 (Person)
  author_name: z.string().optional(),
  author_job_title: z.string().optional(),
  author_profile_url: z.string().optional(),
  author_image_url: z.string().optional(),
  author_bio: z.string().optional(),
  author_same_as: z.array(z.string()).optional(),
  author_knows_about: z.array(z.string()).optional(),

  // 発行元 (Organization)
  publisher_name: z.string().optional(),
  publisher_url: z.string().optional(),
  publisher_logo_url: z.string().optional(),

  // パンくず
  breadcrumb_home_label: z.string().optional(),
  breadcrumb_section_label: z.string().optional(),
  breadcrumb_section_url: z.string().optional(),

  // スキーマ ON/OFF
  enable_article_schema: z.boolean().optional(),
  enable_faq_schema: z.boolean().optional(),
  enable_breadcrumb_schema: z.boolean().optional(),
  enable_person_schema: z.boolean().optional(),

  // 後方互換 (既存)
  author_jsonld: z.string().optional(),
  disclaimer: z.string().optional(),
});

const sectionSchemas = {
  basic: basicSettingsSchema,
  ai: aiSettingsSchema,
  cta: ctaSettingsSchema,
  seo: seoSettingsSchema,
} as const;

export type SettingsSection = keyof typeof sectionSchemas;

// ─── 設定更新スキーマ（section + data） ─────────────────────────────────────

export const updateSettingsSchema = z.object({
  section: z.enum(['basic', 'ai', 'cta', 'seo']),
  data: z.record(z.unknown()),
});

/**
 * セクションに応じたデータのバリデーションを行う
 */
export function validateSectionData(section: SettingsSection, data: unknown) {
  const schema = sectionSchemas[section];
  if (!schema) {
    return { success: false as const, error: `不明なセクション: ${section}` };
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    return { success: false as const, error: result.error.flatten() };
  }
  return { success: true as const, data: result.data };
}

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
