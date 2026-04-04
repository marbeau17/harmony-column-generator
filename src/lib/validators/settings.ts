// ============================================================================
// src/lib/validators/settings.ts
// 設定関連の Zod バリデーションスキーマ
// ============================================================================

import { z } from 'zod';

// ─── 設定更新スキーマ ────────────────────────────────────────────────────────

export const updateSettingsSchema = z.object({
  target_word_count: z
    .number()
    .int('目標文字数は整数で指定してください')
    .min(500, '目標文字数は500以上で指定してください')
    .max(10000, '目標文字数は10000以下で指定してください')
    .optional(),
  gemini_model: z.string().min(1).optional(),
  default_persona: z.string().min(1).optional(),
  cta_url: z.string().url('有効なURLを入力してください').optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
