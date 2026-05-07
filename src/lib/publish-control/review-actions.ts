/**
 * P5-43 Step 3: レビュー action（submit / approve / reject）の単一実装。
 *
 * 設計: docs/refactor/publish-control-unification.md §5 Step 3
 *
 * 責務:
 *   - visibility_state 遷移 (state-machine 準拠)
 *   - approve 時のみ reviewed_at / reviewed_by を audit セット
 *   - publish_events への監査 INSERT
 *
 * 呼び出し元:
 *   - src/app/api/articles/[id]/review/route.ts (一次エントリ)
 *   - src/app/api/articles/[id]/visibility/route.ts (publish 操作の auto-approve パス)
 *
 * 重要: visibility_state を書き換えるのは本ヘルパーと visibility/route のみ。
 *      reviewed_at / reviewed_by は本ヘルパー (action='approve') のみが触る。
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { assertTransition, type VisibilityState } from './state-machine';
import { logger } from '@/lib/logger';

export type ReviewAction = 'submit' | 'approve' | 'reject';

const ACTION_TO_PUBLISH_EVENT: Record<ReviewAction, 'review_submit' | 'review_approve' | 'review_reject'> = {
  submit: 'review_submit',
  approve: 'review_approve',
  reject: 'review_reject',
};

const ACTION_TO_TARGET_STATE: Record<ReviewAction, VisibilityState> = {
  submit: 'pending_review',
  approve: 'idle',
  reject: 'draft',
};

export interface PerformReviewActionInput {
  /** Service role Supabase client (publish_events INSERT が必要なため) */
  service: SupabaseClient;
  articleId: string;
  action: ReviewAction;
  /** 期待される現在 state。optimistic concurrency に使う */
  currentState: VisibilityState;
  /** 操作主体 (audit 用) */
  actor: { id: string; email: string | null };
  /** ULID. 既存の publish_events.request_id と整合する識別子 */
  requestId: string;
  /** 追加の audit メモ */
  reason?: string;
}

export type PerformReviewActionResult =
  | { ok: true; from: VisibilityState; to: VisibilityState }
  | { ok: false; code: 'ILLEGAL_TRANSITION'; from: VisibilityState; to: VisibilityState; message: string }
  | { ok: false; code: 'CONCURRENT_UPDATE'; message: string }
  | { ok: false; code: 'UPDATE_FAILED'; message: string };

/**
 * レビュー action を実行する。state-machine による遷移検証 + DB UPDATE + 監査 INSERT を一括で行う。
 *
 * - approve: pending_review → idle、reviewed_at/reviewed_by を audit セット
 * - submit:  draft → pending_review
 * - reject:  pending_review → draft、reviewed_at は touch しない
 *
 * publish_events INSERT が失敗しても state UPDATE は維持し、warn ログのみ吐く（既存設計踏襲）。
 */
export async function performReviewAction(
  input: PerformReviewActionInput,
): Promise<PerformReviewActionResult> {
  const { service, articleId, action, currentState, actor, requestId, reason } = input;
  const targetState = ACTION_TO_TARGET_STATE[action];
  const start_ms = Date.now();

  logger.info('api', 'review_actions.perform.start', {
    article_id: articleId,
    action,
    from_state: currentState,
    to_state: targetState,
    actor_email: actor.email,
    request_id: requestId,
    has_reason: Boolean(reason),
  });

  // 1) state machine 検証
  try {
    assertTransition(currentState, targetState);
  } catch (err) {
    const error_message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    logger.warn('api', 'review_actions.perform.illegal_transition', {
      article_id: articleId,
      action,
      from_state: currentState,
      to_state: targetState,
      error_message,
      stack,
      elapsed_ms: Date.now() - start_ms,
    });
    return { ok: false, code: 'ILLEGAL_TRANSITION', from: currentState, to: targetState, message: error_message };
  }

  // 2) UPDATE 構築 (approve のみ audit 列を更新)
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    visibility_state: targetState,
    visibility_updated_at: nowIso,
  };
  if (action === 'approve') {
    patch['reviewed_at'] = nowIso;
    patch['reviewed_by'] = actor.email ?? 'publish-control-v2';
  }

  logger.info('api', 'review_actions.perform.patch_built', {
    article_id: articleId,
    action,
    patch_keys: Object.keys(patch),
    branch: action === 'approve' ? 'approve_audit_columns' : 'state_only',
  });

  // 3) optimistic concurrency: currentState と一致する行のみ更新
  const { error: updErr, data: updRows } = await service
    .from('articles')
    // guard-approved: review action state transition (P5-43 Step 3)
    .update(patch)
    .eq('id', articleId)
    .eq('visibility_state', currentState)
    .select('id');

  if (updErr) {
    logger.error('api', 'review_actions.perform.update_failed', {
      article_id: articleId,
      action,
      from_state: currentState,
      to_state: targetState,
      error_message: updErr.message,
      elapsed_ms: Date.now() - start_ms,
    });
    return { ok: false, code: 'UPDATE_FAILED', message: updErr.message };
  }
  if (!updRows || updRows.length === 0) {
    logger.warn('api', 'review_actions.perform.concurrent_update', {
      article_id: articleId,
      action,
      from_state: currentState,
      to_state: targetState,
      updated_rows: 0,
      elapsed_ms: Date.now() - start_ms,
    });
    return { ok: false, code: 'CONCURRENT_UPDATE', message: 'state changed by concurrent request' };
  }

  logger.info('api', 'review_actions.perform.update_ok', {
    article_id: articleId,
    action,
    from_state: currentState,
    to_state: targetState,
    updated_rows: updRows.length,
  });

  // 4) 監査 INSERT (失敗しても state は維持)
  const { error: evtErr } = await service.from('publish_events').insert({
    article_id: articleId,
    action: ACTION_TO_PUBLISH_EVENT[action],
    actor_id: actor.id,
    actor_email: actor.email,
    request_id: requestId,
    hub_deploy_status: 'skipped',
    reason,
  });
  if (evtErr) {
    logger.error('api', 'review_actions.perform.audit_failed', {
      article_id: articleId,
      action,
      error_message: evtErr.message,
    });
  } else {
    logger.info('api', 'review_actions.perform.audit_ok', {
      article_id: articleId,
      action,
      request_id: requestId,
    });
  }

  logger.info('api', 'review_actions.perform.end', {
    article_id: articleId,
    action,
    from_state: currentState,
    to_state: targetState,
    actor_email: actor.email,
    elapsed_ms: Date.now() - start_ms,
    ok: true,
  });

  return { ok: true, from: currentState, to: targetState };
}
