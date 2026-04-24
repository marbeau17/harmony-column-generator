// POST /api/articles/[id]/visibility
// publish-control-v2: single-button hub visibility toggle.
// Spec: docs/specs/publish-control/SPEC.md §3.3
//
// Flag-gated: returns 404 unless PUBLISH_CONTROL_V2=on.
// Idempotent: client requestId (ULID) dedupes; deployed_hash short-circuits no-op.
// Atomic at the DB layer; FTP step is not part of the transaction (see §3.3 error taxonomy).

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { isPublishControlEnabled } from '@/lib/publish-control/feature-flag';
import { checkVisibilityGuard } from '@/lib/publish-control/guards';
import { isValidRequestId } from '@/lib/publish-control/idempotency';
import { assertTransition, isDanglingDeploying, type VisibilityState } from '@/lib/publish-control/state-machine';
import { renderSoftWithdrawalHtml } from '@/lib/publish-control/soft-withdrawal';
import { getFtpConfig, softWithdrawFile } from '@/lib/deploy/ftp-uploader';
import { logger } from '@/lib/logger';

export const maxDuration = 60;

type RouteParams = { params: { id: string } };

interface VisibilityBody {
  visible: boolean;
  requestId: string;
  reason?: string;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  if (!isPublishControlEnabled()) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const { id: articleId } = params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: VisibilityBody;
  try {
    body = (await req.json()) as VisibilityBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (typeof body.visible !== 'boolean') {
    return NextResponse.json({ error: '`visible` must be boolean' }, { status: 400 });
  }
  if (!isValidRequestId(body.requestId)) {
    return NextResponse.json({ error: '`requestId` must be a 26-char ULID' }, { status: 400 });
  }

  const service = await createServiceRoleClient();

  // Idempotency short-circuit via unique (article_id, request_id).
  const { data: prior } = await service
    .from('publish_events')
    .select('id, hub_deploy_status')
    .eq('article_id', articleId)
    .eq('request_id', body.requestId)
    .maybeSingle();
  if (prior) {
    return NextResponse.json({ status: 'duplicate', eventId: prior.id }, { status: 200 });
  }

  const { data: article, error: fetchErr } = await service
    .from('articles')
    // guard-approved: read-only select of publish-control columns
    .select('id, status, stage3_final_html, stage2_body_html, slug, seo_filename, title, is_hub_visible, visibility_state, visibility_updated_at')
    .eq('id', articleId)
    .maybeSingle();
  if (fetchErr || !article) {
    return NextResponse.json({ error: 'article not found' }, { status: 404 });
  }

  const guard = checkVisibilityGuard({
    status: article.status,
    stage3_final_html: article.stage3_final_html,
    is_hub_visible: Boolean(article.is_hub_visible),
    visible_target: body.visible,
  });
  if (!guard.ok) {
    if (guard.code === 'NOOP') {
      return NextResponse.json({ status: 'noop', message: guard.message }, { status: 200 });
    }
    return NextResponse.json({ error: guard.message, code: guard.code }, { status: 422 });
  }

  // Dangling-deploying recovery.
  const currentState = (article.visibility_state ?? 'idle') as VisibilityState;
  if (currentState === 'deploying') {
    const ts = article.visibility_updated_at ? new Date(article.visibility_updated_at) : new Date(0);
    if (!isDanglingDeploying('deploying', ts)) {
      return NextResponse.json({ error: 'another deploy is in progress' }, { status: 423 });
    }
  }

  assertTransition(currentState === 'deploying' ? 'failed' : currentState, 'deploying');

  // Flip visibility_state → 'deploying' with optimistic concurrency on visibility_updated_at.
  const deployStartedAt = new Date().toISOString();
  const { error: lockErr } = await service
    .from('articles')
    // guard-approved: visibility_state write
    .update({ visibility_state: 'deploying', visibility_updated_at: deployStartedAt })
    .eq('id', articleId)
    .eq('visibility_state', currentState);
  if (lockErr) {
    return NextResponse.json({ error: 'lock failed', detail: lockErr.message }, { status: 409 });
  }

  const slug = (article.slug ?? article.seo_filename ?? article.id) as string;
  let hubDeployStatus: 'success' | 'failed' | 'skipped' = 'skipped';
  let hubDeployError: string | null = null;

  try {
    if (body.visible) {
      // Publish path — we only flip flags here. The actual article-HTML FTP upload
      // is still owned by POST /api/articles/[id]/deploy (existing endpoint) and is
      // invoked by the UI after this call succeeds. The hub rebuild is fire-and-await
      // below.
    } else {
      // Soft withdrawal: overwrite slug/index.html with noindex notice.
      // Controlled by FTP_DRY_RUN in tests / when deploy is disabled.
      if (process.env.PUBLISH_CONTROL_FTP === 'on') {
        const cfg = await getFtpConfig();
        const html = renderSoftWithdrawalHtml({ title: article.title ?? undefined });
        const result = await softWithdrawFile(cfg, `${slug}/index.html`, html);
        hubDeployStatus = result.success ? 'success' : 'failed';
        hubDeployError = result.errors.join('; ') || null;
      }
    }

    // Success path — flip DB state.
    // Also mirror reviewed_at so the existing hub-generator query (status='published'
    // AND reviewed_at IS NOT NULL) stays consistent until the query is migrated in a
    // follow-up step. See SPEC §3.2.
    const patch: Record<string, unknown> = {
      is_hub_visible: body.visible,
      visibility_state: body.visible ? 'live' : 'unpublished',
      visibility_updated_at: new Date().toISOString(),
    };
    if (body.visible) {
      patch['reviewed_at'] = new Date().toISOString();
      patch['reviewed_by'] = user.email ?? 'publish-control-v2';
    } else {
      patch['reviewed_at'] = null;
      patch['reviewed_by'] = null;
    }

    const { error: updErr } = await service
      .from('articles')
      // guard-approved: publish-control-v2 visibility flip
      .update(patch)
      .eq('id', articleId);
    if (updErr) throw updErr;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await service
      .from('articles')
      // guard-approved: rollback of visibility_state on failure
      .update({ visibility_state: 'failed', visibility_updated_at: new Date().toISOString() })
      .eq('id', articleId);
    await service.from('publish_events').insert({
      article_id: articleId,
      action: body.visible ? 'publish' : 'unpublish',
      actor_id: user.id,
      actor_email: user.email,
      request_id: body.requestId,
      hub_deploy_status: 'failed',
      hub_deploy_error: msg,
      reason: body.reason,
    });
    logger.error('api', 'visibility.failed', { articleId, visible: body.visible, err: msg });
    return NextResponse.json({ error: 'visibility flip failed', detail: msg }, { status: 502 });
  }

  await service.from('publish_events').insert({
    article_id: articleId,
    action: body.visible ? 'publish' : 'unpublish',
    actor_id: user.id,
    actor_email: user.email,
    request_id: body.requestId,
    hub_deploy_status: hubDeployStatus,
    hub_deploy_error: hubDeployError,
    reason: body.reason,
  });

  // Fire-and-await the hub rebuild so the UI doesn't swallow errors.
  // Trigger the existing endpoint from the server side only when the overall
  // publish-control FTP bus is enabled.
  let hubWarning: string | null = null;
  if (process.env.PUBLISH_CONTROL_FTP === 'on') {
    try {
      const origin = new URL(req.url).origin;
      const res = await fetch(`${origin}/api/hub/deploy`, {
        method: 'POST',
        headers: {
          cookie: req.headers.get('cookie') ?? '',
        },
      });
      if (!res.ok) {
        hubWarning = `hub rebuild returned ${res.status}`;
        await service
          .from('articles')
          // guard-approved: mark hub-stale after partial success
          .update({ visibility_state: 'live_hub_stale' })
          .eq('id', articleId);
      }
    } catch (err) {
      hubWarning = err instanceof Error ? err.message : String(err);
      await service
        .from('articles')
        // guard-approved: mark hub-stale after partial success
        .update({ visibility_state: 'live_hub_stale' })
        .eq('id', articleId);
    }
  }

  const status = hubWarning ? 207 : 200;
  return NextResponse.json(
    {
      status: hubWarning ? 'partial' : 'ok',
      visible: body.visible,
      hubDeployStatus,
      hubWarning,
    },
    { status },
  );
}
