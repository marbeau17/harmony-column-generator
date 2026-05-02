// ============================================================================
// src/lib/publish/hub-rebuild-trigger.ts
// ハブページ再生成 (rebuildHub) を要求する統一エントリポイント
//
// 設計意図 (P5-42): ハブ再生成のトリガーが現在 4 箇所に分散している。
//   - articles/page.tsx 確認チェックボックス ON/OFF
//   - articles/page.tsx 一括サーバー更新ボタン
//   - articles/[id]/page.tsx ハブ再生成ボタン
//   - api/articles/[id]/visibility (publish-control v2)
//
// 段階的に本ヘルパーへ集約予定。本 PR では新規ファイル作成のみで、
// 既存呼び出し箇所の置換は別 PR で行う。
// ============================================================================

import { logger } from '@/lib/logger';

/**
 * ハブページ再生成を要求する統一エントリポイント。
 * 内部で `fetch('${appUrl}/api/hub/rebuild')` を POST で呼ぶ。
 * エラーは warn ログに留め、呼び出し元へは throw せず結果オブジェクトで返す。
 */
export async function triggerHubRebuild(opts: {
  /** ロギング用の発火元識別子 (例: "checkbox_toggle", "deploy_button", "visibility_change") */
  reason: string;
  /** 関連記事 ID (任意・ロギング用) */
  articleId?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { reason, articleId } = opts;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  logger.info('deploy', 'hub-rebuild-triggered', { reason, articleId });

  try {
    const res = await fetch(`${appUrl}/api/hub/rebuild`, { method: 'POST' });
    if (!res.ok) {
      const message = `hub rebuild failed: ${res.status} ${res.statusText}`;
      logger.warn('deploy', 'hub-rebuild-failed', {
        reason,
        articleId,
        status: res.status,
        statusText: res.statusText,
      });
      return { ok: false, error: message };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      'deploy',
      'hub-rebuild-error',
      { reason, articleId },
      error,
    );
    return { ok: false, error: message };
  }
}
