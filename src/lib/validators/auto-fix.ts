// ============================================================================
// src/lib/validators/auto-fix.ts
// POST /api/articles/[id]/auto-fix の zod スキーマ (P5-19)
// ============================================================================

import { z } from 'zod';

const autoFixTypeSchema = z.enum([
  'suffix',
  'keyword',
  'abstract',
  'length',
  'claim',
  'tone',
]);

const autoFixParamsSchema = z.object({
  fix_type: autoFixTypeSchema,
  target_value: z.number().optional(),
  keywords: z.array(z.string().min(1)).max(20).optional(),
  claim_idx: z.number().int().min(0).optional(),
  detected_phrase: z.string().optional(),
  current_value: z.number().optional(),
});

const regenChapterParamsSchema = z.object({
  chapter_idx: z.number().int().min(0),
});

const ignoreWarnParamsSchema = z.object({
  reason: z.string().min(1, '理由を入力してください').max(500),
});

export const autoFixRequestSchema = z
  .object({
    fix_strategy: z.enum(['auto-fix', 'regen-chapter', 'regen-full', 'ignore-warn', 'manual-edit']),
    check_item_id: z.string().min(1),
    auto_fix_params: autoFixParamsSchema.optional(),
    regen_params: regenChapterParamsSchema.optional(),
    ignore_params: ignoreWarnParamsSchema.optional(),
  })
  .refine(
    (v) =>
      v.fix_strategy !== 'auto-fix' || v.auto_fix_params !== undefined,
    { message: 'auto-fix 戦略には auto_fix_params が必須です' },
  )
  .refine(
    (v) =>
      v.fix_strategy !== 'regen-chapter' || v.regen_params !== undefined,
    { message: 'regen-chapter 戦略には regen_params が必須です' },
  )
  .refine(
    (v) =>
      v.fix_strategy !== 'ignore-warn' || v.ignore_params !== undefined,
    { message: 'ignore-warn 戦略には ignore_params (reason) が必須です' },
  );

export type AutoFixRequestInput = z.infer<typeof autoFixRequestSchema>;
