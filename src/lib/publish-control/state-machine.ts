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
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * `from` から `to` への遷移を強制する。
 * 不正な遷移の場合は Error を throw する。
 */
export function assertTransition(from: VisibilityState, to: VisibilityState): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal visibility transition: ${from} → ${to}`);
  }
}

export const STALE_DEPLOYING_MS = 60_000;

export function isDanglingDeploying(state: VisibilityState, updatedAt: Date, now = new Date()): boolean {
  if (state !== 'deploying') return false;
  return now.getTime() - updatedAt.getTime() > STALE_DEPLOYING_MS;
}
