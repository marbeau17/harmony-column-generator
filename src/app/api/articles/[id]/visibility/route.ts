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
import { performReviewAction } from '@/lib/publish-control/review-actions';
import { ulid } from '@/lib/publish-control/ulid';
import { renderSoftWithdrawalHtml } from '@/lib/publish-control/soft-withdrawal';
import { getFtpConfig, softWithdrawFile } from '@/lib/deploy/ftp-uploader';
import { logger } from '@/lib/logger';
import { sendSlackNotification } from '@/lib/notify/slack';

export const maxDuration = 60;

type RouteParams = { params: { id: string } };

interface VisibilityBody {
  visible: boolean;
  requestId: string;
  reason?: string;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const startedAt = Date.now();
  const { id: articleId } = params;
  logger.info('api', 'visibility.start', { article_id: articleId });

  if (!isPublishControlEnabled()) {
    logger.warn('api', 'visibility.feature_flag_off', { article_id: articleId });
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    logger.warn('api', 'visibility.auth_failed', { article_id: articleId, status: 401 });
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  logger.info('api', 'visibility.auth_ok', { article_id: articleId, user_id: user.id });

  let body: VisibilityBody;
  try {
    body = (await req.json()) as VisibilityBody;
  } catch (e) {
    logger.warn('api', 'visibility.invalid_json', { article_id: articleId, error_message: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  logger.info('api', 'visibility.body_parsed', {
    article_id: articleId,
    visible: body.visible,
    requestId: body.requestId,
    has_reason: Boolean(body.reason),
  });
  if (typeof body.visible !== 'boolean') {
    logger.warn('api', 'visibility.body_invalid', { article_id: articleId, reason: 'visible_not_boolean' });
    return NextResponse.json({ error: '`visible` must be boolean' }, { status: 400 });
  }
  if (!isValidRequestId(body.requestId)) {
    logger.warn('api', 'visibility.body_invalid', { article_id: articleId, reason: 'invalid_request_id' });
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
    logger.info('api', 'visibility.duplicate', { article_id: articleId, eventId: prior.id, elapsed_ms: Date.now() - startedAt });
    return NextResponse.json({ status: 'duplicate', eventId: prior.id }, { status: 200 });
  }

  const { data: article, error: fetchErr } = await service
    .from('articles')
    // guard-approved: read-only select of publish-control columns
    .select('id, status, stage3_final_html, stage2_body_html, slug, seo_filename, title, is_hub_visible, visibility_state, visibility_updated_at, published_at')
    .eq('id', articleId)
    .maybeSingle();
  if (fetchErr || !article) {
    logger.warn('api', 'visibility.article_not_found', { article_id: articleId, error_message: fetchErr?.message });
    return NextResponse.json({ error: 'article not found' }, { status: 404 });
  }
  logger.info('api', 'visibility.article_found', {
    article_id: articleId,
    slug: article.slug,
    status: article.status,
    visibility_state: article.visibility_state,
    is_hub_visible: article.is_hub_visible,
  });

  const guard = checkVisibilityGuard({
    status: article.status,
    stage3_final_html: article.stage3_final_html,
    is_hub_visible: Boolean(article.is_hub_visible),
    visible_target: body.visible,
  });
  if (!guard.ok) {
    if (guard.code === 'NOOP') {
      logger.info('api', 'visibility.guard_noop', { article_id: articleId, message: guard.message });
      return NextResponse.json({ status: 'noop', message: guard.message }, { status: 200 });
    }
    logger.warn('api', 'visibility.guard_failed', { article_id: articleId, code: guard.code, message: guard.message });
    return NextResponse.json({ error: guard.message, code: guard.code }, { status: 422 });
  }
  logger.info('api', 'visibility.guard_ok', { article_id: articleId, visible_target: body.visible });

  // 第4ゲート: hallucination critical = 0（公開試行時のみ）
  if (body.visible) {
    const { count: criticalCount } = await service
      .from('article_claims')
      .select('id', { count: 'exact', head: true })
      .eq('article_id', articleId)
      .eq('risk', 'critical');
    if (criticalCount && criticalCount > 0) {
      logger.warn('api', 'visibility.hallucination_critical_blocked', {
        article_id: articleId,
        criticalCount,
      });
      return NextResponse.json({
        error: 'hallucination critical not zero',
        code: 'HALLUCINATION_CRITICAL',
        criticalCount,
      }, { status: 422 });
    }
    logger.info('api', 'visibility.hallucination_check_ok', { article_id: articleId });
  }

  // Dangling-deploying recovery.
  let currentState = (article.visibility_state ?? 'idle') as VisibilityState;
  logger.info('api', 'visibility.current_state', { article_id: articleId, from_state: currentState });
  if (currentState === 'deploying') {
    const ts = article.visibility_updated_at ? new Date(article.visibility_updated_at) : new Date(0);
    if (!isDanglingDeploying('deploying', ts)) {
      logger.warn('api', 'visibility.deploy_in_progress', {
        article_id: articleId,
        visibility_updated_at: article.visibility_updated_at,
      });
      return NextResponse.json({ error: 'another deploy is in progress' }, { status: 423 });
    }
    logger.warn('api', 'visibility.dangling_deploying_recovered', {
      article_id: articleId,
      visibility_updated_at: article.visibility_updated_at,
    });
  }

  // P5-64 (2026-05-03): visible=true で visibility_state='pending_review' の場合、
  //   publish ボタンクリック = 由起子さん確認意思の表明とみなして自動承認。
  //
  // P5-43 Step 3 リファクタ: review_actions.performReviewAction(action='approve') に
  //   処理を委譲し、reviewed_at / reviewed_by の audit 書込みは review API と同じ
  //   ロジックで行う。これにより visibility_state 直接書換のレシピがこのルート内
  //   から消え、書き手 (writer) は review API or 通常の publish/unpublish 遷移のみとなる。
  //   旧実装は assertTransition('pending_review','deploying') で throw → 500 になって
  //   いた (P5-47 が status='editing' の自動遷移しか考慮していなかった補完)。
  if (body.visible && currentState === 'pending_review') {
    logger.info('api', 'visibility.auto_approve.start', {
      article_id: articleId,
      user_id: user.id,
      from_state: 'pending_review',
    });
    const approveResult = await performReviewAction({
      service,
      articleId,
      action: 'approve',
      currentState: 'pending_review',
      actor: { id: user.id, email: user.email ?? null },
      // ULID は冪等性キー。auto-approve は同じ requestId(=publish 用) と分けるため
      // 別 ULID を生成する。publish_events は (article_id, request_id) ユニーク制約のみ。
      requestId: ulid(),
      reason: 'auto-approve via publish action',
    });
    if (!approveResult.ok) {
      logger.error('api', 'visibility.auto_approve.failed', {
        article_id: articleId,
        code: approveResult.code,
        error_message: approveResult.message,
      });
      return NextResponse.json(
        { error: 'auto-approve failed', detail: approveResult.message, code: approveResult.code },
        { status: approveResult.code === 'CONCURRENT_UPDATE' ? 409 : 502 },
      );
    }
    logger.info('api', 'visibility.auto_approved', {
      article_id: articleId,
      user_id: user.id,
      from_state: 'pending_review',
      to_state: 'idle',
    });
    currentState = 'idle';
  }

  try {
    assertTransition(currentState === 'deploying' ? 'failed' : currentState, 'deploying');
    logger.info('api', 'visibility.assert_transition_ok', {
      article_id: articleId,
      from_state: currentState,
      to_state: 'deploying',
    });
  } catch (e) {
    logger.error('api', 'visibility.assert_transition_failed', {
      article_id: articleId,
      from_state: currentState,
      to_state: 'deploying',
      error_message: e instanceof Error ? e.message : String(e),
      stack: (e as Error)?.stack?.slice(0, 500),
    }, e);
    throw e;
  }

  // Flip visibility_state → 'deploying' with optimistic concurrency on visibility_updated_at.
  const deployStartedAt = new Date().toISOString();
  const lockStartMs = Date.now();
  logger.info('api', 'visibility.lock.start', {
    article_id: articleId,
    from_state: currentState,
    to_state: 'deploying',
  });
  const { error: lockErr } = await service
    .from('articles')
    // guard-approved: visibility_state write
    .update({ visibility_state: 'deploying', visibility_updated_at: deployStartedAt })
    .eq('id', articleId)
    .eq('visibility_state', currentState);
  if (lockErr) {
    logger.error('api', 'visibility.lock.failed', {
      article_id: articleId,
      from_state: currentState,
      error_message: lockErr.message,
    });
    return NextResponse.json({ error: 'lock failed', detail: lockErr.message }, { status: 409 });
  }
  logger.info('api', 'visibility.lock.ok', {
    article_id: articleId,
    elapsed_ms: Date.now() - lockStartMs,
  });

  const slug = (article.slug ?? article.seo_filename ?? article.id) as string;
  let hubDeployStatus: 'success' | 'failed' | 'skipped' = 'skipped';
  let hubDeployError: string | null = null;

  try {
    if (body.visible) {
      // Publish path — we only flip flags here. The actual article-HTML FTP upload
      // is still owned by POST /api/articles/[id]/deploy (existing endpoint) and is
      // invoked by the UI after this call succeeds. The hub rebuild is fire-and-await
      // below.
      logger.info('api', 'visibility.branch.publish_path', { article_id: articleId, slug });
    } else {
      // Soft withdrawal: overwrite slug/index.html with noindex notice.
      // Controlled by FTP_DRY_RUN in tests / when deploy is disabled.
      logger.info('api', 'visibility.branch.unpublish_path', {
        article_id: articleId,
        slug,
        ftp_enabled: process.env.PUBLISH_CONTROL_FTP === 'on',
      });
      if (process.env.PUBLISH_CONTROL_FTP === 'on') {
        const ftpStartMs = Date.now();
        const cfg = await getFtpConfig();
        const html = renderSoftWithdrawalHtml({ title: article.title ?? undefined });
        const result = await softWithdrawFile(cfg, `${slug}/index.html`, html);
        hubDeployStatus = result.success ? 'success' : 'failed';
        hubDeployError = result.errors.join('; ') || null;
        logger.info('api', 'visibility.soft_withdraw.done', {
          article_id: articleId,
          slug,
          success: result.success,
          elapsed_ms: Date.now() - ftpStartMs,
          error_message: hubDeployError,
        });
      }
    }

    // Success path — flip DB state.
    // P5-43 Step 3: review 操作は /api/articles/[id]/review に分離。
    // 本ルートでは visibility_state / is_hub_visible / visibility_updated_at の
    // 更新のみを担い、reviewed_at / reviewed_by は触らない（writers migration）。
    const patch: Record<string, unknown> = {
      is_hub_visible: body.visible,
      visibility_state: body.visible ? 'live' : 'unpublished',
      visibility_updated_at: new Date().toISOString(),
    };

    // P5-47: 公開試行時、status='editing' なら 'published' に自動遷移し、
    //        slug が未設定なら title から auto-generate する。
    //        これで一覧ページの PublishButton から end-to-end で公開できる
    //        (従来は editor の handlePublish フローを通る必要があった)。
    if (body.visible && article.status === 'editing') {
      logger.info('api', 'visibility.auto_promote_editing', {
        article_id: articleId,
        from_status: 'editing',
        to_status: 'published',
        had_slug: Boolean(article.slug),
        had_published_at: Boolean(article.published_at),
      });
      patch.status = 'published';
      if (!article.published_at) {
        patch.published_at = new Date().toISOString();
      }
      if (!article.slug && article.title) {
        const { generateSlug } = await import('@/lib/seo/meta-generator');
        let candidate = generateSlug(article.title);
        // 衝突チェック
        const { data: collisions } = await service
          .from('articles')
          .select('id, slug')
          .eq('slug', candidate)
          .neq('id', articleId);
        if (collisions && collisions.length > 0) {
          let i = 2;
          while (i < 50) {
            const c = `${candidate}-${i}`;
            const { data: c2 } = await service
              .from('articles')
              .select('id')
              .eq('slug', c)
              .neq('id', articleId)
              .maybeSingle();
            if (!c2) {
              candidate = c;
              break;
            }
            i++;
          }
        }
        patch.slug = candidate;
        logger.info('api', 'visibility.slug_generated', { article_id: articleId, slug: candidate });
      }
    }

    const updateStartMs = Date.now();
    logger.info('api', 'visibility.update.start', {
      article_id: articleId,
      patch_keys: Object.keys(patch),
      to_state: patch.visibility_state,
    });
    const { error: updErr } = await service
      .from('articles')
      // guard-approved: publish-control-v2 visibility flip
      .update(patch)
      .eq('id', articleId);
    if (updErr) throw updErr;
    logger.info('api', 'visibility.update.end', {
      article_id: articleId,
      elapsed_ms: Date.now() - updateStartMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('api', 'visibility.transition.failed', {
      article_id: articleId,
      visible: body.visible,
      from_state: currentState,
      to_state: 'failed',
      error_message: msg,
      stack: (err as Error)?.stack?.slice(0, 500),
      elapsed_ms: Date.now() - startedAt,
    }, err);
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
    logger.error('api', 'visibility.failed', { article_id: articleId, visible: body.visible, error_message: msg });
    return NextResponse.json({ error: 'visibility flip failed', detail: msg }, { status: 502 });
  }

  logger.info('api', 'visibility.publish_event.insert', {
    article_id: articleId,
    action: body.visible ? 'publish' : 'unpublish',
    hub_deploy_status: hubDeployStatus,
  });

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
    const hubFireMs = Date.now();
    logger.info('api', 'visibility.hub_rebuild.fire', { article_id: articleId });
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
        logger.warn('api', 'visibility.hub_rebuild.fail', {
          article_id: articleId,
          status: res.status,
          elapsed_ms: Date.now() - hubFireMs,
        });
        await service
          .from('articles')
          // guard-approved: mark hub-stale after partial success
          .update({ visibility_state: 'live_hub_stale' })
          .eq('id', articleId);
      } else {
        logger.info('api', 'visibility.hub_rebuild.ok', {
          article_id: articleId,
          elapsed_ms: Date.now() - hubFireMs,
        });
      }
    } catch (err) {
      hubWarning = err instanceof Error ? err.message : String(err);
      logger.error('api', 'visibility.hub_rebuild.error', {
        article_id: articleId,
        error_message: hubWarning,
        stack: (err as Error)?.stack?.slice(0, 500),
        elapsed_ms: Date.now() - hubFireMs,
      }, err);
      await service
        .from('articles')
        // guard-approved: mark hub-stale after partial success
        .update({ visibility_state: 'live_hub_stale' })
        .eq('id', articleId);
    }
    if (hubWarning) await sendSlackNotification(`⚠️ live_hub_stale: article=${articleId} hub deploy failed (${hubWarning})`);
  }

  const status = hubWarning ? 207 : 200;
  const finalState = hubWarning ? 'live_hub_stale' : (body.visible ? 'live' : 'unpublished');
  logger.info('api', 'visibility.end', {
    article_id: articleId,
    elapsed_ms: Date.now() - startedAt,
    final_state: finalState,
    visible: body.visible,
    hubDeployStatus,
    hubWarning,
    http_status: status,
  });
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
