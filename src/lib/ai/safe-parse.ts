// ============================================================================
// src/lib/ai/safe-parse.ts
// AI 出力の Zod スキーマ検証共通ヘルパー
// 検証失敗時は構造化ログ（先頭3件の issue）を出して null を返す。
// ============================================================================

import type { ZodSchema } from 'zod';
import { logger } from '@/lib/logger';

export function safeParseAi<T>(schema: ZodSchema<T>, raw: unknown, context: string): T | null {
  const result = schema.safeParse(raw);
  if (!result.success) {
    logger.warn('ai', 'schema_violation', {
      context,
      issues: result.error.issues.slice(0, 3).map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return null;
  }
  return result.data;
}
