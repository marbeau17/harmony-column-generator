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

const seoSettingsSchema = z.object({
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
