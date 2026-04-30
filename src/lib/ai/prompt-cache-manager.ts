// ============================================================================
// src/lib/ai/prompt-cache-manager.ts
// Gemini Context Cache をプロセス内で再利用する薄いマネージャ。
// spec §5.4 H10（Generator/Fixer）に従い、長尺 system prompt を TTL 1h で
// Gemini 側にキャッシュし、key 単位でメモリに resource ID をマップする。
//
// - 初回: createPromptCache を呼んで cacheName を取得し Map に保存
// - 2 回目以降: メモリヒットなら同じ cacheName を返す（API 呼び出し無し）
// - TTL 期限切れ: ローカル expiresAt を見て自動再生成
// - invalidatePromptCache(key): エントリを破棄（手動失効）
//
// 注意: メモリ Map はプロセスローカル（Vercel Function instance ごと）。
// 強整合は要求しない（キャッシュなのでミスしても正しく動く）。
// ============================================================================

import { createPromptCache } from './gemini-client';

interface CacheEntry {
  cacheName: string;
  expiresAt: Date;
}

/**
 * key → { cacheName, expiresAt } のプロセス内マップ。
 * テストで内部状態を初期化したい場合は invalidatePromptCache を使う。
 */
const cacheMap: Map<string, CacheEntry> = new Map();

/** 期限切れ判定の安全マージン（秒）: 残り 30s 未満なら再生成扱い */
const EXPIRY_SAFETY_MARGIN_MS = 30_000;

/** 既定 TTL（秒）= 1 時間。spec §5.4 推奨。 */
const DEFAULT_TTL_SECONDS = 3600;

/**
 * key に対して有効な cacheName を返す。無ければ作成する。
 *
 * 動作:
 *   1. cacheMap に key があり、expiresAt が十分先 → そのまま返す（API 呼び出し無し）
 *   2. それ以外 → createPromptCache を呼んで Map に格納してから返す
 */
export async function getOrCreatePromptCache(
  key: string,
  systemPrompt: string,
  options?: { ttlSeconds?: number; now?: () => number },
): Promise<string> {
  if (!key) {
    throw new Error('getOrCreatePromptCache: key must be non-empty');
  }
  if (!systemPrompt) {
    throw new Error('getOrCreatePromptCache: systemPrompt must be non-empty');
  }

  const now = options?.now ? options.now() : Date.now();
  const ttlSeconds = options?.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  const existing = cacheMap.get(key);
  if (existing) {
    const remainingMs = existing.expiresAt.getTime() - now;
    if (remainingMs > EXPIRY_SAFETY_MARGIN_MS) {
      return existing.cacheName;
    }
    // 期限切れに近い → エントリ破棄して再作成へ
    cacheMap.delete(key);
  }

  const created = await createPromptCache(systemPrompt, ttlSeconds);
  cacheMap.set(key, {
    cacheName: created.cacheName,
    expiresAt: created.expiresAt,
  });
  return created.cacheName;
}

/**
 * key に紐づくキャッシュエントリを破棄する。
 * Gemini 側の cachedContents は TTL に任せる（明示削除はしない）。
 */
export function invalidatePromptCache(key: string): void {
  cacheMap.delete(key);
}

/**
 * テスト用: 全エントリを破棄する。
 * （vi.beforeEach で呼ぶことでテスト同士の独立性を確保）
 */
export function _resetPromptCacheForTesting(): void {
  cacheMap.clear();
}
