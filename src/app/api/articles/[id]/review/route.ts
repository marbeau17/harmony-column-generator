/**
 * P5-43 Step 3: 由起子さん人間レビュー操作の単一エントリポイント。
 * 設計: docs/refactor/publish-control-unification.md §5 Step 3
 *
 * action:
 *   - 'submit'  : draft → pending_review (執筆完了→レビュー依頼)
 *   - 'approve' : pending_review → idle  (承認、デプロイ可能化、reviewed_at セット)
 *   - 'reject'  : pending_review → draft (差戻し、reviewed_at は audit のため keep)
 *
 * audit: publish_events に action='review_{submit|approve|reject}' で記録
 * reviewed_at / reviewed_by: approve 時のみ更新 (audit のみ目的、状態判断には使わない)
 *
 * Flag-gated: PUBLISH_CONTROL_V2=on でのみ稼働 (visibility/route.ts と同じパターン)。
 * Idempotent: client requestId (ULID) で重複実行を dedupe。
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { isPublishControlEnabled } from '@/lib/publish-control/feature-flag';
import { isValidRequestId } from '@/lib/publish-control/idempotency';
import { assertTransition, type VisibilityState } from '@/lib/publish-control/state-machine';
import { logger } from '@/lib/logger';

export const maxDuration = 60;

type RouteParams = { params: { id: string } };

type ReviewAction = 'submit' | 'approve' | 'reject';

interface ReviewBody {
  action: ReviewAction;
  requestId: string;
  reason?: string;
}

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

function isReviewAction(v: unknown): v is ReviewAction {
  return v === 'submit' || v === 'approve' || v === 'reject';
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  if (!isPublishControlEnabled()) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const { id: articleId } = params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: ReviewBody;
  try {
    body = (await req.json()) as ReviewBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!isReviewAction(body.action)) {
    return NextResponse.json(
      { error: "`action` must be one of 'submit' | 'approve' | 'reject'" },
      { status: 400 },
    );
  }
  if (!isValidRequestId(body.requestId)) {
    return NextResponse.json({ error: '`requestId` must be a 26-char ULID' }, { status: 400 });
  }

  const service = await createServiceRoleClient();

  // Idempotency short-circuit via unique (article_id, request_id).
  const { data: prior } = await service
    .from('publish_events')
    .select('id, action')
    .eq('article_id', articleId)
    .eq('request_id', body.requestId)
    .maybeSingle();
  if (prior) {
    return NextResponse.json({ status: 'duplicate', eventId: prior.id }, { status: 200 });
  }

  const { data: article, error: fetchErr } = await service
    .from('articles')
    // guard-approved: read-only select of publish-control columns
    .select('id, visibility_state, visibility_updated_at')
    .eq('id', articleId)
    .maybeSingle();
  if (fetchErr || !article) {
    return NextResponse.json({ error: 'article not found' }, { status: 404 });
  }

  const currentState = (article.visibility_state ?? 'idle') as VisibilityState;
  const targetState = ACTION_TO_TARGET_STATE[body.action];

  // State machine 検証 (draft→pending_review / pending_review→idle / pending_review→draft)
  try {
    assertTransition(currentState, targetState);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: msg, code: 'ILLEGAL_TRANSITION', from: currentState, to: targetState },
      { status: 422 },
    );
  }

  // 状態 + audit 列の更新。approve 時のみ reviewed_at / reviewed_by を更新する。
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    visibility_state: targetState,
    visibility_updated_at: nowIso,
  };
  if (body.action === 'approve') {
    patch['reviewed_at'] = nowIso;
    patch['reviewed_by'] = user.email ?? 'publish-control-v2';
  }

  // Optimistic concurrency: 取得時の visibility_state と一致する行のみ更新する。
  const { error: updErr, data: updRows } = await service
    .from('articles')
    // guard-approved: review action state transition (P5-43 Step 3)
    .update(patch)
    .eq('id', articleId)
    .eq('visibility_state', currentState)
    .select('id');
  if (updErr) {
    logger.error('api', 'review.update_failed', { articleId, action: body.action, err: updErr.message });
    return NextResponse.json({ error: 'state update failed', detail: updErr.message }, { status: 502 });
  }
  if (!updRows || updRows.length === 0) {
    // 競合: 別リクエストが先に状態を変えた。
    return NextResponse.json(
      { error: 'state changed by concurrent request', code: 'CONCURRENT_UPDATE' },
      { status: 409 },
    );
  }

  // Audit ログ INSERT。state 変更後に追記し、失敗しても状態は維持する (logger に記録)。
  const { error: evtErr } = await service.from('publish_events').insert({
    article_id: articleId,
    action: ACTION_TO_PUBLISH_EVENT[body.action],
    actor_id: user.id,
    actor_email: user.email,
    request_id: body.requestId,
    hub_deploy_status: 'skipped',
    reason: body.reason,
  });
  if (evtErr) {
    logger.error('api', 'review.audit_failed', { articleId, action: body.action, err: evtErr.message });
  }

  logger.info('api', 'review.ok', {
    articleId,
    action: body.action,
    from: currentState,
    to: targetState,
    actor: user.email,
  });

  return NextResponse.json(
    {
      status: 'ok',
      action: body.action,
      from: currentState,
      to: targetState,
    },
    { status: 200 },
  );
}
