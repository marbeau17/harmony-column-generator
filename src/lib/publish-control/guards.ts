import type { ArticleStatus } from '@/lib/db/articles';

export interface VisibilityGuardInput {
  status: ArticleStatus;
  stage3_final_html: string | null;
  is_hub_visible: boolean;
  visible_target: boolean;
}

export type GuardResult =
  | { ok: true }
  | { ok: false; code: 'NOT_PUBLISHABLE' | 'NO_HTML' | 'NOOP'; message: string };

/**
 * P5-47: Step 3 移行に整合するよう guard を緩和。
 *   - 旧: visible=true 時に status==='published' を厳密要求
 *   - 新: visibility_state を SOT とし、status は editing or published を許容
 *         (visibility/route.ts 側で editing → published の自動遷移を担う)
 *
 * 拒否対象は「明らかに公開準備未完」の状態のみ:
 *   draft / outline_pending / outline_approved / body_generating / body_review
 *
 * editing は「執筆完了 + レビュー承認済み」とみなし許容する
 * (Step 3 後は visibility_state='idle' が承認済みの実状態)。
 */
const PUBLISHABLE_STATUSES: readonly ArticleStatus[] = ['editing', 'published'];

export function checkVisibilityGuard(input: VisibilityGuardInput): GuardResult {
  if (input.visible_target === input.is_hub_visible) {
    return { ok: false, code: 'NOOP', message: 'already in target state' };
  }
  if (input.visible_target) {
    if (!PUBLISHABLE_STATUSES.includes(input.status)) {
      return {
        ok: false,
        code: 'NOT_PUBLISHABLE',
        message: `visible=true requires status ∈ {editing, published} (got '${input.status}')`,
      };
    }
    if (!input.stage3_final_html) {
      return { ok: false, code: 'NO_HTML', message: 'stage3_final_html is empty' };
    }
  }
  return { ok: true };
}
