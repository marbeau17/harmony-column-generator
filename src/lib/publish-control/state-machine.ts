/**
 * Publish Control 可視性ステートマシン
 *
 * P5-43 Step 1 / 設計 §5 参照:
 *   既存の deploy/live フロー (idle → deploying → live など) を維持しつつ、
 *   レビュー前ワークフロー用ノード `'draft'` と `'pending_review'` を additive 拡張で追加。
 *
 *   - draft:          記事の下書き。レビュー提出のみ可能。
 *   - pending_review: レビュー待ち。承認 → idle / 差戻し → draft の二択。
 *   - idle:           承認済み (デプロイ可能)。再 review への戻しもサポート。
 *
 *   既存ノード (deploying / live / live_hub_stale / unpublished / failed) の
 *   遷移は一切変更せず、後方互換を維持する。
 */
import { logger } from '@/lib/logger';

export type VisibilityState =
  | 'draft'
  | 'pending_review'
  | 'idle'
  | 'deploying'
  | 'live'
  | 'live_hub_stale'
  | 'unpublished'
  | 'failed';

const TRANSITIONS: Record<VisibilityState, VisibilityState[]> = {
  draft:          ['pending_review'],
  pending_review: ['idle', 'draft'], // approve_review or reject_review
  idle:           ['deploying', 'pending_review'], // unpublish back to review
  deploying:      ['live', 'live_hub_stale', 'failed'],
  live:           ['deploying'],
  live_hub_stale: ['deploying'],
  unpublished:    ['deploying'],
  failed:         ['deploying', 'idle'],
};

/**
 * `from` から `to` への遷移が許可されているかを判定する。
 * 不明なステートが渡された場合は false を返す。
 */
export function canTransition(from: VisibilityState, to: VisibilityState): boolean {
  const allowed = TRANSITIONS[from]?.includes(to) ?? false;
  // 同期 validator: start/end ペアではなく単発の判定ログを残す
  logger.info('api', 'state_machine.can_transition', {
    from_state: from,
    to_state: to,
    allowed,
  });
  return allowed;
}

/**
 * `from` から `to` への遷移を強制する。
 * 不正な遷移の場合は Error を throw する。
 */
export function assertTransition(from: VisibilityState, to: VisibilityState): void {
  const allowed = TRANSITIONS[from]?.includes(to) ?? false;
  if (!allowed) {
    // 不正遷移は guard 出力として想定範囲内なので warn (error ではない)
    const error_message = `illegal visibility transition: ${from} → ${to}`;
    logger.warn('api', 'state_machine.assert_transition', {
      from_state: from,
      to_state: to,
      allowed: false,
      error_message,
    });
    throw new Error(error_message);
  }
  logger.info('api', 'state_machine.assert_transition', {
    from_state: from,
    to_state: to,
    allowed: true,
  });
}

export const STALE_DEPLOYING_MS = 60_000;

export function isDanglingDeploying(state: VisibilityState, updatedAt: Date, now = new Date()): boolean {
  if (state !== 'deploying') {
    logger.info('api', 'state_machine.is_dangling_deploying', {
      from_state: state,
      dangling: false,
      reason: 'not_deploying',
    });
    return false;
  }
  const elapsed_ms = now.getTime() - updatedAt.getTime();
  const dangling = elapsed_ms > STALE_DEPLOYING_MS;
  logger.info('api', 'state_machine.is_dangling_deploying', {
    from_state: state,
    elapsed_ms,
    dangling,
    threshold_ms: STALE_DEPLOYING_MS,
  });
  return dangling;
}
