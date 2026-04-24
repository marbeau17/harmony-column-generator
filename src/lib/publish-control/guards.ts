import type { ArticleStatus } from '@/lib/db/articles';

export interface VisibilityGuardInput {
  status: ArticleStatus;
  stage3_final_html: string | null;
  is_hub_visible: boolean;
  visible_target: boolean;
}

export type GuardResult =
  | { ok: true }
  | { ok: false; code: 'NOT_PUBLISHED' | 'NO_HTML' | 'NOOP'; message: string };

export function checkVisibilityGuard(input: VisibilityGuardInput): GuardResult {
  if (input.visible_target === input.is_hub_visible) {
    return { ok: false, code: 'NOOP', message: 'already in target state' };
  }
  if (input.visible_target) {
    if (input.status !== 'published') {
      return {
        ok: false,
        code: 'NOT_PUBLISHED',
        message: `visible=true requires status='published' (got '${input.status}')`,
      };
    }
    if (!input.stage3_final_html) {
      return { ok: false, code: 'NO_HTML', message: 'stage3_final_html is empty' };
    }
  }
  return { ok: true };
}
