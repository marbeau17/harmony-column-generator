// ============================================================================
// src/lib/validators/regenerate-segment.ts
// POST /api/articles/[id]/regenerate-segment のリクエスト検証スキーマ
//
// scope:
//   - 'sentence' : target_idx で指定された sentence_idx の文だけ再生成
//   - 'chapter'  : target_idx で指定された H2 章だけ再生成
//   - 'full'     : 全体（Stage1 → Stage2）を再生成
//
// target_idx は sentence / chapter で必須（>= 0 の整数）。full では無視。
// ============================================================================

import { z } from 'zod';

export const regenerateScopeSchema = z.enum(['sentence', 'chapter', 'full']);
export type RegenerateScope = z.infer<typeof regenerateScopeSchema>;

export const regenerateSegmentRequestSchema = z
  .object({
    scope: regenerateScopeSchema,
    target_idx: z
      .number()
      .int('target_idx は整数で指定してください')
      .min(0, 'target_idx は 0 以上で指定してください')
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.scope === 'sentence' || val.scope === 'chapter') {
      if (typeof val.target_idx !== 'number') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['target_idx'],
          message: `scope=${val.scope} の場合 target_idx は必須です`,
        });
      }
    }
  });

export type RegenerateSegmentRequest = z.infer<
  typeof regenerateSegmentRequestSchema
>;
