// ============================================================================
// src/lib/logger.ts
// 構造化ロギングユーティリティ
// ============================================================================

type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';
type LogCategory = 'api' | 'ai' | 'auth' | 'db' | 'system' | 'generator' | 'deploy' | 'related-articles' | 'export';

interface LogEntry {
  level: LogLevel;
  category: LogCategory;
  action: string;
  tenantId?: string;
  userId?: string;
  details?: Record<string, unknown>;
  requestId?: string;
  durationMs?: number;
  error?: unknown;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

function getCurrentLevel(): LogLevel {
  const env = process.env.LOG_LEVEL?.toUpperCase();
  if (env && env in LEVEL_PRIORITY) return env as LogLevel;
  return process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] <= LEVEL_PRIORITY[getCurrentLevel()];
}

function emit(entry: LogEntry): void {
  if (!shouldLog(entry.level)) return;

  const payload: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level: entry.level,
    category: entry.category,
    action: entry.action,
  };
  if (entry.tenantId) payload.tenant_id = entry.tenantId;
  if (entry.userId) payload.user_id = entry.userId;
  if (entry.requestId) payload.request_id = entry.requestId;
  if (entry.durationMs !== undefined) payload.duration_ms = entry.durationMs;
  if (entry.details) payload.details = entry.details;
  if (entry.error) {
    payload.error =
      entry.error instanceof Error
        ? { message: entry.error.message, stack: entry.error.stack }
        : String(entry.error);
  }

  const json = JSON.stringify(payload);
  switch (entry.level) {
    case 'ERROR': console.error(json); break;
    case 'WARN': console.warn(json); break;
    case 'DEBUG': console.debug(json); break;
    default: console.log(json);
  }
}

// ─── 公開 API ───────────────────────────────────────────────────────────────

export const logger = {
  error(category: LogCategory, action: string, details?: Record<string, unknown>, error?: unknown) {
    emit({ level: 'ERROR', category, action, details, error });
  },
  warn(category: LogCategory, action: string, details?: Record<string, unknown>, error?: unknown) {
    emit({ level: 'WARN', category, action, details, error });
  },
  info(category: LogCategory, action: string, details?: Record<string, unknown>) {
    emit({ level: 'INFO', category, action, details });
  },
  debug(category: LogCategory, action: string, details?: Record<string, unknown>) {
    emit({ level: 'DEBUG', category, action, details });
  },

  /** 非同期処理の所要時間を自動計測するラッパー */
  async timed<T>(
    category: LogCategory,
    action: string,
    fn: () => Promise<T>,
    details?: Record<string, unknown>,
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      emit({ level: 'INFO', category, action, durationMs: Date.now() - start, details: { ...details, success: true } });
      return result;
    } catch (error) {
      emit({ level: 'ERROR', category, action, durationMs: Date.now() - start, details: { ...details, success: false }, error });
      throw error;
    }
  },
};
