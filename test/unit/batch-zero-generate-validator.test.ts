import { describe, it, expect } from 'vitest';
import {
  batchZeroGenerateRequestSchema,
  BATCH_MIN_JOBS,
  BATCH_MAX_JOBS,
} from '@/lib/validators/batch-zero-generate';

const validJob = {
  theme_id: '11111111-1111-1111-1111-111111111111',
  persona_id: '22222222-2222-2222-2222-222222222222',
  keywords: ['チャクラ'],
  intent: 'info' as const,
  target_length: 2000,
};

describe('batchZeroGenerateRequestSchema', () => {
  it('1 件の有効な job が通る', () => {
    const r = batchZeroGenerateRequestSchema.safeParse({ jobs: [validJob] });
    expect(r.success).toBe(true);
  });

  it('10 件 (上限) も通る', () => {
    const r = batchZeroGenerateRequestSchema.safeParse({
      jobs: Array.from({ length: BATCH_MAX_JOBS }, () => ({ ...validJob })),
    });
    expect(r.success).toBe(true);
  });

  it('0 件は不可 (min 1)', () => {
    const r = batchZeroGenerateRequestSchema.safeParse({ jobs: [] });
    expect(r.success).toBe(false);
  });

  it('11 件は不可 (max 10)', () => {
    const r = batchZeroGenerateRequestSchema.safeParse({
      jobs: Array.from({ length: BATCH_MAX_JOBS + 1 }, () => ({ ...validJob })),
    });
    expect(r.success).toBe(false);
  });

  it('必須項目欠如した job が混じれば不可', () => {
    const broken = { ...validJob, theme_id: 'not-uuid' };
    const r = batchZeroGenerateRequestSchema.safeParse({
      jobs: [validJob, broken],
    });
    expect(r.success).toBe(false);
  });

  it('intent が不正なら不可', () => {
    const broken = { ...validJob, intent: 'unknown' };
    const r = batchZeroGenerateRequestSchema.safeParse({ jobs: [broken] });
    expect(r.success).toBe(false);
  });

  it('target_length が範囲外でも個別 schema で拒否', () => {
    const broken = { ...validJob, target_length: 100 };
    const r = batchZeroGenerateRequestSchema.safeParse({ jobs: [broken] });
    expect(r.success).toBe(false);
  });

  it('jobs キー欠如は不可', () => {
    const r = batchZeroGenerateRequestSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('BATCH_MIN_JOBS / BATCH_MAX_JOBS が公開されている', () => {
    expect(BATCH_MIN_JOBS).toBe(1);
    expect(BATCH_MAX_JOBS).toBe(10);
  });
});
