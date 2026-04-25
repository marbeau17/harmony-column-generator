/**
 * E2E 環境変数バリデーション。必須キーが揃っていれば true、不足があれば skip 用の reason を返す。
 */
export interface EnvCheckResult {
  ok: boolean;
  missing: string[];
  reason?: string;
}

export function checkE2EEnv(required: string[]): EnvCheckResult {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length === 0) return { ok: true, missing: [] };
  return {
    ok: false,
    missing,
    reason: `Missing env vars: ${missing.join(', ')}. Set them in .env.local or pass inline.`,
  };
}
