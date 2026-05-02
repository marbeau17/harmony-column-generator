// ============================================================================
// src/lib/validators/batch-zero-generate.ts
// POST /api/articles/zero-generate-batch の zod スキーマ (P5-21)
// ============================================================================

import { z } from 'zod';
import { zeroGenerateRequestSchema } from '@/lib/validators/zero-generate';

export const BATCH_MIN_JOBS = 1;
export const BATCH_MAX_JOBS = 10;

export const batchZeroGenerateRequestSchema = z.object({
  jobs: z
    .array(zeroGenerateRequestSchema)
    .min(BATCH_MIN_JOBS, `jobs は ${BATCH_MIN_JOBS} 件以上必要です`)
    .max(BATCH_MAX_JOBS, `jobs は最大 ${BATCH_MAX_JOBS} 件までです`),
});

export type BatchZeroGenerateRequest = z.infer<typeof batchZeroGenerateRequestSchema>;

export interface BatchJobLaunchResult {
  index: number;
  job_id?: string;
  status: 'queued' | 'failed';
  error?: string;
}

export interface BatchZeroGenerateResponse {
  batch_id: string;
  jobs: BatchJobLaunchResult[];
}
