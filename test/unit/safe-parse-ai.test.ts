// ============================================================================
// test/unit/safe-parse-ai.test.ts
// safeParseAi() の単体テスト（4ケース）
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { safeParseAi } from '@/lib/ai/safe-parse';
import { logger } from '@/lib/logger';

describe('safeParseAi — AI 出力の Zod 検証共通ヘルパー', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('スキーマに合致する入力をそのまま返す（warnは呼ばれない）', () => {
    const schema = z.object({ title: z.string(), score: z.number() });
    const raw = { title: 'ヒーリング入門', score: 87 };

    const got = safeParseAi(schema, raw, 'unit-test:valid');

    expect(got).toEqual({ title: 'ヒーリング入門', score: 87 });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('スキーマ違反は null を返し、ai/schema_violation を warn する', () => {
    const schema = z.object({ title: z.string(), score: z.number() });
    const raw = { title: 'タロット', score: 'NOT_A_NUMBER' };

    const got = safeParseAi(schema, raw, 'unit-test:invalid');

    expect(got).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [category, action, details] = warnSpy.mock.calls[0];
    expect(category).toBe('ai');
    expect(action).toBe('schema_violation');
    expect(details).toMatchObject({ context: 'unit-test:invalid' });
    expect(Array.isArray((details as { issues: unknown[] }).issues)).toBe(true);
    const issues = (details as { issues: Array<{ path: string; message: string }> }).issues;
    expect(issues[0].path).toBe('score');
    expect(typeof issues[0].message).toBe('string');
  });

  it('issue は先頭3件までに切り詰められる', () => {
    const schema = z.object({
      a: z.string(),
      b: z.string(),
      c: z.string(),
      d: z.string(),
      e: z.string(),
    });
    // すべての必須フィールド欠落 → 5件の issue
    const raw = {};

    const got = safeParseAi(schema, raw, 'unit-test:truncate');

    expect(got).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const details = warnSpy.mock.calls[0][2] as { issues: unknown[] };
    expect(details.issues).toHaveLength(3);
  });

  it('ネストされた path はドット連結される', () => {
    const schema = z.object({
      meta: z.object({
        seo: z.object({ keyword: z.string() }),
      }),
    });
    const raw = { meta: { seo: { keyword: 123 } } };

    const got = safeParseAi(schema, raw, 'unit-test:nested');

    expect(got).toBeNull();
    const details = warnSpy.mock.calls[0][2] as { issues: Array<{ path: string }> };
    expect(details.issues[0].path).toBe('meta.seo.keyword');
  });
});
