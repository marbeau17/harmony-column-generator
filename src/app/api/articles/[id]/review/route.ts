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
import type { VisibilityState } from '@/lib/publish-control/state-machine';
import { performReviewAction, type ReviewAction } from '@/lib/publish-control/review-actions';

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

  // P5-43 Step 3: 共有ヘルパー performReviewAction に処理を委譲。
  // visibility/route.ts の auto-approve とロジックを共通化している。
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
      return NextResponse.json(
        { error: result.message, code: 'ILLEGAL_TRANSITION', from: result.from, to: result.to },
        { status: 422 },
      );
    }
    if (result.code === 'CONCURRENT_UPDATE') {
      return NextResponse.json(
        { error: result.message, code: 'CONCURRENT_UPDATE' },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: 'state update failed', detail: result.message },
      { status: 502 },
    );
  }

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
