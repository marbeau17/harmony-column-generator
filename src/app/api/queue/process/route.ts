// ============================================================================
// src/app/api/queue/process/route.ts
// POST /api/queue/process
// キュー処理実行 — 次の1件を取得してステップに応じた処理を実行
//
// ステップ遷移:
//   pending   → 記事作成 + アウトライン生成 → outline
//   outline   → 本文生成                   → body
//   body      → 画像プロンプト生成          → images
//   images    → SEOスコアチェック           → seo_check
//   seo_check → 完了                       → completed
//   失敗時    → failed + error_message 記録
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

// ─── 内部 API 呼び出しヘルパー ──────────────────────────────────────────────

/**
 * 内部APIルートをサーバーサイドで呼び出す。
 * Next.js App Router の内部では fetch で自身の API を呼ぶ形にする。
 */
async function callInternalApi(
  request: NextRequest,
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; data: Record<string, unknown>; status: number }> {
  const origin = request.nextUrl.origin;
  const url = `${origin}${path}`;

  // 元リクエストの Cookie を転送して認証を引き継ぐ
  const cookieHeader = request.headers.get('cookie') || '';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  return { ok: response.ok, data, status: response.status };
}

// ─── キューステップ更新 ─────────────────────────────────────────────────────

async function updateQueueStep(
  serviceClient: Awaited<ReturnType<typeof createServiceRoleClient>>,
  queueId: string,
  step: string,
  extraFields?: Record<string, unknown>,
) {
  const { error } = await serviceClient
    .from('generation_queue')
    .update({
      step,
      updated_at: new Date().toISOString(),
      ...extraFields,
    })
    .eq('id', queueId);

  if (error) {
    throw new Error(`キューステップ更新に失敗: ${error.message}`);
  }
}

async function markFailed(
  serviceClient: Awaited<ReturnType<typeof createServiceRoleClient>>,
  queueId: string,
  errorMessage: string,
) {
  await serviceClient
    .from('generation_queue')
    .update({
      step: 'failed',
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    })
    .eq('id', queueId);
}

// ─── ハンドラー ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // 認証チェック
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const serviceClient = await createServiceRoleClient();

    // 最優先の pending / 処理中キューアイテムを1件取得
    // pending を優先し、それがなければ途中ステップのものを取得
    const processingSteps = ['pending', 'outline', 'body', 'images', 'seo_check'];

    const { data: queueItem, error: fetchError } = await serviceClient
      .from('generation_queue')
      .select('*, content_plan:content_plans(*)')
      .in('step', processingSteps)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      logger.error('api', 'processQueue.fetch', undefined, fetchError);
      return NextResponse.json(
        { error: 'キューの取得に失敗しました' },
        { status: 500 },
      );
    }

    if (!queueItem) {
      return NextResponse.json({
        message: '処理対象のキューアイテムがありません。',
        processed: false,
      });
    }

    const plan = queueItem.content_plan;
    if (!plan) {
      await markFailed(serviceClient, queueItem.id, '関連するコンテンツプランが見つかりません');
      return NextResponse.json(
        { error: '関連するコンテンツプランが見つかりません' },
        { status: 500 },
      );
    }

    logger.info('api', 'processQueue.start', {
      queueId: queueItem.id,
      planId: plan.id,
      currentStep: queueItem.step,
      keyword: plan.keyword,
    });

    const currentStep = queueItem.step as string;

    try {
      switch (currentStep) {
        // ── pending → 記事作成 + アウトライン生成 → outline ──
        case 'pending': {
          // 記事作成 + アウトライン生成を一括で実行
          const outlineResult = await callInternalApi(request, '/api/ai/generate-outline', {
            keyword: plan.keyword,
            theme: plan.theme,
            targetPersona: plan.persona,
            perspectiveType: plan.perspective_type,
            targetWordCount: plan.target_word_count,
          });

          if (!outlineResult.ok) {
            throw new Error(
              `アウトライン生成に失敗: ${(outlineResult.data as Record<string, unknown>).error || '不明なエラー'}`,
            );
          }

          const articleId = (outlineResult.data as Record<string, unknown>).articleId as string;

          // キューにarticle_idを記録し、ステップを進める
          await updateQueueStep(serviceClient, queueItem.id, 'outline', {
            article_id: articleId,
          });

          // 記事のステータスを outline_approved に遷移
          // (自動承認: プランが既に承認済みのため)
          await serviceClient
            .from('articles')
            .update({
              status: 'outline_approved',
              updated_at: new Date().toISOString(),
            })
            .eq('id', articleId);

          // プランステータスを processing に更新
          await serviceClient
            .from('content_plans')
            .update({
              status: 'processing',
              updated_at: new Date().toISOString(),
            })
            .eq('id', plan.id);

          logger.info('api', 'processQueue.pending_complete', {
            queueId: queueItem.id,
            articleId,
          });

          return NextResponse.json({
            processed: true,
            queueId: queueItem.id,
            previousStep: 'pending',
            currentStep: 'outline',
            articleId,
          });
        }

        // ── outline → 本文生成 → body ──
        case 'outline': {
          if (!queueItem.article_id) {
            throw new Error('article_id が設定されていません');
          }

          const bodyResult = await callInternalApi(request, '/api/ai/generate-body', {
            articleId: queueItem.article_id,
          });

          if (!bodyResult.ok) {
            throw new Error(
              `本文生成に失敗: ${(bodyResult.data as Record<string, unknown>).error || '不明なエラー'}`,
            );
          }

          await updateQueueStep(serviceClient, queueItem.id, 'body');

          logger.info('api', 'processQueue.outline_complete', {
            queueId: queueItem.id,
            articleId: queueItem.article_id,
          });

          return NextResponse.json({
            processed: true,
            queueId: queueItem.id,
            previousStep: 'outline',
            currentStep: 'body',
            articleId: queueItem.article_id,
          });
        }

        // ── body → 画像プロンプト生成 → images ──
        case 'body': {
          if (!queueItem.article_id) {
            throw new Error('article_id が設定されていません');
          }

          const imageResult = await callInternalApi(request, '/api/ai/generate-image-prompts', {
            articleId: queueItem.article_id,
          });

          if (!imageResult.ok) {
            throw new Error(
              `画像プロンプト生成に失敗: ${(imageResult.data as Record<string, unknown>).error || '不明なエラー'}`,
            );
          }

          await updateQueueStep(serviceClient, queueItem.id, 'images');

          logger.info('api', 'processQueue.body_complete', {
            queueId: queueItem.id,
            articleId: queueItem.article_id,
          });

          return NextResponse.json({
            processed: true,
            queueId: queueItem.id,
            previousStep: 'body',
            currentStep: 'images',
            articleId: queueItem.article_id,
          });
        }

        // ── images → SEOスコアチェック → seo_check ──
        case 'images': {
          if (!queueItem.article_id) {
            throw new Error('article_id が設定されていません');
          }

          const seoResult = await callInternalApi(request, '/api/ai/quality-check', {
            articleId: queueItem.article_id,
            saveResult: true,
          });

          if (!seoResult.ok) {
            throw new Error(
              `SEOチェックに失敗: ${(seoResult.data as Record<string, unknown>).error || '不明なエラー'}`,
            );
          }

          await updateQueueStep(serviceClient, queueItem.id, 'seo_check');

          logger.info('api', 'processQueue.images_complete', {
            queueId: queueItem.id,
            articleId: queueItem.article_id,
          });

          return NextResponse.json({
            processed: true,
            queueId: queueItem.id,
            previousStep: 'images',
            currentStep: 'seo_check',
            articleId: queueItem.article_id,
          });
        }

        // ── seo_check → 完了 → completed ──
        case 'seo_check': {
          await updateQueueStep(serviceClient, queueItem.id, 'completed');

          // プランステータスを completed に更新
          await serviceClient
            .from('content_plans')
            .update({
              status: 'completed',
              updated_at: new Date().toISOString(),
            })
            .eq('id', plan.id);

          logger.info('api', 'processQueue.completed', {
            queueId: queueItem.id,
            planId: plan.id,
            articleId: queueItem.article_id,
          });

          return NextResponse.json({
            processed: true,
            queueId: queueItem.id,
            previousStep: 'seo_check',
            currentStep: 'completed',
            articleId: queueItem.article_id,
          });
        }

        default: {
          return NextResponse.json(
            { error: `不明なステップ: ${currentStep}` },
            { status: 400 },
          );
        }
      }
    } catch (stepError) {
      const errorMessage = stepError instanceof Error ? stepError.message : String(stepError);

      logger.error('api', 'processQueue.step_failed', {
        queueId: queueItem.id,
        step: currentStep,
        errorMessage,
      }, stepError);

      // キューを failed に更新
      await markFailed(serviceClient, queueItem.id, errorMessage);

      return NextResponse.json(
        {
          processed: false,
          queueId: queueItem.id,
          step: currentStep,
          error: errorMessage,
        },
        { status: 500 },
      );
    }
  } catch (error) {
    logger.error('api', 'processQueue', undefined, error);
    return NextResponse.json(
      { error: 'キュー処理に失敗しました' },
      { status: 500 },
    );
  }
}
