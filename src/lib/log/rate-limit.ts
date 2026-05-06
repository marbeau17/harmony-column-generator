// ============================================================================
// src/lib/log/rate-limit.ts
// /api/log エンドポイント向けの IP ベース簡易 rate limit。
// route.ts に直書きすると Next.js App Router が「不正な route export」として
// ビルド失敗するため、純粋ロジックは本モジュールに分離する。
// ============================================================================

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_EVENTS = 100;

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

/**
 * IP ベースの rate limit。同一 client から 100 events / 分を超えたら deny。
 * 戻り値: true = 許可 / false = 拒否
 */
export function checkRateLimit(
  clientKey: string,
  now: number = Date.now(),
): boolean {
  const bucket = rateBuckets.get(clientKey);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(clientKey, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX_EVENTS) {
    return false;
  }
  bucket.count += 1;
  return true;
}

/**
 * テスト用に内部状態をクリアするヘルパ。本番では呼ばれない。
 */
export function _resetRateLimitForTests(): void {
  rateBuckets.clear();
}

export const RATE_LIMIT_MAX_PER_MINUTE = RATE_LIMIT_MAX_EVENTS;
