// ============================================================================
// src/lib/utils/client-error-logger.ts
// ----------------------------------------------------------------------------
// 管理画面のクライアント側で発生するエラーを必ず console.error で吐き出す
// 共通ヘルパー。Vercel の runtime logs から原因を特定できるようにする。
//
// 使い方:
//   try {
//     ...
//   } catch (err) {
//     logClientError('ftp-upload', err, { articleId });
//     throw err;
//   }
//
//   if (!res.ok) {
//     logClientError('ftp-upload-http', new Error(`HTTP ${res.status}`), { body });
//   }
// ============================================================================

/**
 * クライアント側エラーを構造化ログとして console.error に出力する。
 * Vercel logs（および将来的には /api/logs エンドポイント）に拾わせる前提。
 *
 * @param context  発生箇所を示す短い識別子（例: 'ftp-upload', 'settings-save'）
 * @param err      catch した例外、または new Error(...) でラップした擬似例外
 * @param extra    任意の付加情報（articleId / status / responseBody など）
 */
export function logClientError(
  context: string,
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  // Vercel runtime logs 上で grep しやすいよう [client-error] プレフィックスを固定。
  // 第 2 引数は構造化されたまま JSON.stringify される（Vercel が自動で展開）。
  console.error(`[client-error] ${context}: ${message}`, {
    ...extra,
    stack,
  });
  // 将来: ここから /api/logs に POST して Supabase に保存する拡張を想定。
}
