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
 * Idempotent: client requestId (ULID) で重複実行を dedupe。
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { isValidRequestId } from '@/lib/publish-control/idempotency';
import type { VisibilityState } from '@/lib/publish-control/state-machine';
import { performReviewAction, type ReviewAction } from '@/lib/publish-control/review-actions';
import { logger } from '@/lib/logger';

export const maxDuration = 60;

type RouteParams = { params: { id: string } };

interface ReviewBody {
  action: ReviewAction;
  requestId: string;
  reason?: string;
}

function isReviewAction(v: unknown): v is ReviewAction {
  return v === 'submit' || v === 'approve' || v === 'reject';
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const startedAt = Date.now();
  const { id: articleId } = params;
  logger.info('api', 'review.start', { article_id: articleId });

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    logger.warn('api', 'review.auth_failed', { article_id: articleId, status: 401 });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  logger.info('api', 'review.auth_ok', { article_id: articleId, user_id: user.id });

  let body: ReviewBody;
  try {
    body = (await req.json()) as ReviewBody;
  } catch (e) {
    logger.warn('api', 'review.invalid_json', { article_id: articleId, error_message: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  logger.info('api', 'review.body_parsed', {
    article_id: articleId,
    action: body.action,
    requestId: body.requestId,
    has_reason: Boolean(body.reason),
  });
  if (!isReviewAction(body.action)) {
    logger.warn('api', 'review.body_invalid', { article_id: articleId, reason: 'invalid_action', received: body.action });
    return NextResponse.json(
      { error: "`action` must be one of 'submit' | 'approve' | 'reject'" },
      { status: 400 },
    );
  }
  if (!isValidRequestId(body.requestId)) {
    logger.warn('api', 'review.body_invalid', { article_id: articleId, reason: 'invalid_request_id' });
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
    logger.info('api', 'review.duplicate', {
      article_id: articleId,
      eventId: prior.id,
      action: body.action,
      elapsed_ms: Date.now() - startedAt,
    });
    return NextResponse.json({ status: 'duplicate', eventId: prior.id }, { status: 200 });
  }

  const { data: article, error: fetchErr } = await service
    .from('articles')
    // guard-approved: read-only select of publish-control columns
    .select('id, visibility_state, visibility_updated_at')
    .eq('id', articleId)
    .maybeSingle();
  if (fetchErr || !article) {
    logger.warn('api', 'review.article_not_found', { article_id: articleId, error_message: fetchErr?.message });
    return NextResponse.json({ error: 'article not found' }, { status: 404 });
  }

  const currentState = (article.visibility_state ?? 'idle') as VisibilityState;
  logger.info('api', 'review.article_found', {
    article_id: articleId,
    visibility_state: currentState,
    visibility_updated_at: article.visibility_updated_at,
  });

  // P5-43 Step 3: 共有ヘルパー performReviewAction に処理を委譲。
  // visibility/route.ts の auto-approve とロジックを共通化している。
  // P5-43 Step 3 ブランチ別ログ: action='approve'/'reject'/'submit' のどれを実行したかを明示。
  logger.info('api', `review.action_${body.action}`, {
    article_id: articleId,
    user_id: user.id,
    from_state: currentState,
    reason: body.reason,
  });

  const updateStartMs = Date.now();
  const result = await performReviewAction({
    service,
    articleId,
    action: body.action,
    currentState,
    actor: { id: user.id, email: user.email ?? null },
    requestId: body.requestId,
    reason: body.reason,
  });

  if (!result.ok) {
    if (result.code === 'ILLEGAL_TRANSITION') {
      logger.warn('api', 'review.update_failed', {
        article_id: articleId,
        action: body.action,
        code: 'ILLEGAL_TRANSITION',
        from_state: result.from,
        to_state: result.to,
        error_message: result.message,
        elapsed_ms: Date.now() - updateStartMs,
      });
      return NextResponse.json(
        { error: result.message, code: 'ILLEGAL_TRANSITION', from: result.from, to: result.to },
        { status: 422 },
      );
    }
    if (result.code === 'CONCURRENT_UPDATE') {
      logger.warn('api', 'review.update_failed', {
        article_id: articleId,
        action: body.action,
        code: 'CONCURRENT_UPDATE',
        error_message: result.message,
        elapsed_ms: Date.now() - updateStartMs,
      });
      return NextResponse.json(
        { error: result.message, code: 'CONCURRENT_UPDATE' },
        { status: 409 },
      );
    }
    logger.error('api', 'review.update_failed', {
      article_id: articleId,
      action: body.action,
      code: result.code,
      error_message: result.message,
      elapsed_ms: Date.now() - updateStartMs,
    });
    return NextResponse.json(
      { error: 'state update failed', detail: result.message },
      { status: 502 },
    );
  }

  logger.info('api', 'review.update_ok', {
    article_id: articleId,
    action: body.action,
    from_state: result.from,
    to_state: result.to,
    reviewed_at_written: body.action === 'approve',
    elapsed_ms: Date.now() - updateStartMs,
  });

  logger.info('api', 'review.end', {
    article_id: articleId,
    action: body.action,
    final_state: result.to,
    elapsed_ms: Date.now() - startedAt,
  });

  return NextResponse.json(
    {
      status: 'ok',
      action: body.action,
      from: result.from,
      to: result.to,
    },
    { status: 200 },
  );
}
