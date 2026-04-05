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
//
// 内部API を fetch() で呼ぶ代わりに、AI ロジックを直接インポートして実行する。
// これにより Cookie 転送・認証バイパスの問題を根本的に回避する。
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { generateJson } from '@/lib/ai/gemini-client';
import {
  buildStage1SystemPrompt,
  buildStage1UserPrompt,
} from '@/lib/ai/prompts/stage1-outline';
import { executeStage2Chain } from '@/lib/ai/prompt-chain';
import {
  buildImagePromptSystemPrompt,
  buildImagePromptUserPrompt,
} from '@/lib/ai/prompts/image-prompt';
import type { ImagePromptsResult } from '@/lib/ai/prompts/image-prompt';
import { insertTocIntoHtml } from '@/lib/content/toc-generator';
import { logger } from '@/lib/logger';
import type { Stage1Input, Stage1OutlineResult, Stage2Input } from '@/types/ai';

// ─── Vercel / Next.js タイムアウト対策 ────────────────────────────────────────
export const maxDuration = 300; // 5分（AI生成は時間がかかるため）

// ─── 型エイリアス ──────────────────────────────────────────────────────────────
type ServiceClient = Awaited<ReturnType<typeof createServiceRoleClient>>;

// ─── キューステップ更新 ─────────────────────────────────────────────────────
// 注意: generation_queue テーブルには updated_at カラムがないため設定しない

async function updateQueueStep(
  serviceClient: ServiceClient,
  queueId: string,
  step: string,
  extraFields?: Record<string, unknown>,
) {
  const { error } = await serviceClient
    .from('generation_queue')
    .update({
      step,
      ...extraFields,
    })
    .eq('id', queueId);

  if (error) {
    throw new Error(`キューステップ更新に失敗: ${error.message}`);
  }
}

async function markFailed(
  serviceClient: ServiceClient,
  queueId: string,
  errorMessage: string,
) {
  await serviceClient
    .from('generation_queue')
    .update({
      step: 'failed',
      error_message: errorMessage,
    })
    .eq('id', queueId);
}

// ─── content_plans ステータス更新ヘルパー ──────────────────────────────────────
// CHECK 制約: proposed, approved, rejected, generating, completed, failed

async function updatePlanStatus(
  serviceClient: ServiceClient,
  planId: string,
  status: 'proposed' | 'approved' | 'rejected' | 'generating' | 'completed' | 'failed',
  extraFields?: Record<string, unknown>,
) {
  const { error } = await serviceClient
    .from('content_plans')
    .update({
      status,
      updated_at: new Date().toISOString(),
      ...extraFields,
    })
    .eq('id', planId);

  if (error) {
    logger.warn('api', 'processQueue.updatePlanStatus_failed', {
      planId,
      status,
      error: error.message,
    });
  }
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
    const processingSteps = ['pending', 'outline', 'body', 'images', 'seo_check'];

    const { data: queueItem, error: fetchError } = await serviceClient
      .from('generation_queue')
      .select('*, content_plan:content_plans(*)')
      .in('step', processingSteps)
      .is('error_message', null)
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

    // started_at を記録（初回のみ）
    if (!queueItem.started_at) {
      await serviceClient
        .from('generation_queue')
        .update({ started_at: new Date().toISOString() })
        .eq('id', queueItem.id);
    }

    try {
      switch (currentStep) {
        // ── pending → 記事作成 + アウトライン生成 → outline ──
        case 'pending': {
          // content_plans のステータスを generating に遷移
          await updatePlanStatus(serviceClient, plan.id, 'generating');

          // --- 1. 記事を articles テーブルに insert ---
          const insertPayload: Record<string, unknown> = {
            keyword: plan.keyword,
            theme: plan.theme || null,
            persona: plan.persona || null,
            perspective_type: plan.perspective_type || null,
            target_word_count: plan.target_word_count || 2000,
            status: 'draft',
          };

          // source_article_ids がある場合、最初のものを source_article_id に設定
          if (Array.isArray(plan.source_article_ids) && plan.source_article_ids.length > 0) {
            insertPayload.source_article_id = plan.source_article_ids[0];
          }

          const { data: newArticle, error: insertError } = await serviceClient
            .from('articles')
            .insert(insertPayload)
            .select('*')
            .single();

          if (insertError || !newArticle) {
            throw new Error(`記事の作成に失敗: ${insertError?.message || '不明なエラー'}`);
          }

          const articleId = newArticle.id as string;

          // --- 2. content_plans.article_id を設定 ---
          await serviceClient
            .from('content_plans')
            .update({
              article_id: articleId,
              updated_at: new Date().toISOString(),
            })
            .eq('id', plan.id);

          // --- 3. generation_queue.article_id を設定 ---
          await serviceClient
            .from('generation_queue')
            .update({ article_id: articleId })
            .eq('id', queueItem.id);

          // --- 4. 元記事の内容を取得（ある場合） ---
          let sourceArticleContent: string | undefined;
          if (newArticle.source_article_id) {
            const { data: sourceArticle } = await serviceClient
              .from('source_articles')
              .select('title, content')
              .eq('id', newArticle.source_article_id)
              .single();
            if (sourceArticle) {
              sourceArticleContent = `【元記事タイトル】${sourceArticle.title}\n\n${sourceArticle.content}`;
            }
          }

          // --- 5. アウトライン生成（AI直接呼び出し） ---
          const stage1Input: Stage1Input = {
            keyword: plan.keyword || '',
            theme: plan.theme || 'spiritual_intro',
            targetPersona: plan.persona || 'spiritual_beginner',
            perspectiveType: plan.perspective_type || 'concept_to_practice',
            targetWordCount: plan.target_word_count ?? 2000,
            sourceArticleId: (newArticle.source_article_id as string) || undefined,
            sourceArticleContent,
          };

          const systemPrompt = buildStage1SystemPrompt(stage1Input);
          const userPrompt = buildStage1UserPrompt(stage1Input);

          const { data: outlineResult, response: outlineResponse } =
            await generateJson<Stage1OutlineResult>(systemPrompt, userPrompt, {
              temperature: 0.8,
              maxOutputTokens: 16384,
              timeoutMs: 120_000,
            });

          if (outlineResponse.finishReason === 'MAX_TOKENS') {
            throw new Error('AI出力がトークン上限で切り捨てられました。');
          }
          if (outlineResponse.finishReason === 'SAFETY') {
            throw new Error('AIの安全フィルターにより生成がブロックされました。');
          }
          if (
            !outlineResult ||
            !Array.isArray(outlineResult.headings) ||
            outlineResult.headings.length === 0
          ) {
            throw new Error('AIの構成案に必須フィールド（見出し）が含まれていません。');
          }

          // 画像プロンプトを最大3枚に制限
          if (outlineResult.image_prompts && outlineResult.image_prompts.length > 3) {
            outlineResult.image_prompts = outlineResult.image_prompts.slice(0, 3);
          }

          // --- 6. 記事を更新: アウトライン保存 + ステータス → outline_approved ---
          // 自動生成パイプラインではプランが承認済みなので、outline_pending をスキップして
          // outline_approved に直接遷移させ、次の本文生成ステップに進めるようにする
          const outlineData = {
            seo_filename: outlineResult.seo_filename,
            title_proposal: outlineResult.title_proposal,
            meta_description: outlineResult.meta_description,
            quick_answer: outlineResult.quick_answer || '',
            headings: outlineResult.headings || [],
            faq: outlineResult.faq || [],
            image_prompts: outlineResult.image_prompts || [],
            cta_positions: outlineResult.cta_positions || [],
            cta_texts: outlineResult.cta_texts || [],
          };

          const generationLog = JSON.stringify({
            stage: 'stage1_outline',
            timestamp: new Date().toISOString(),
            tokenUsage: outlineResponse.tokenUsage,
            finishReason: outlineResponse.finishReason,
          });

          // --- スラッグ重複チェック ---
          let finalSlug = outlineResult.seo_filename;
          if (finalSlug) {
            const { data: existingArticle } = await serviceClient
              .from('articles')
              .select('id')
              .eq('slug', finalSlug)
              .neq('id', articleId)
              .maybeSingle();

            if (existingArticle) {
              // 重複あり: 連番サフィックスを付与して一意にする
              let suffix = 2;
              let candidateSlug = `${finalSlug}-${suffix}`;
              // eslint-disable-next-line no-constant-condition
              while (true) {
                const { data: dup } = await serviceClient
                  .from('articles')
                  .select('id')
                  .eq('slug', candidateSlug)
                  .neq('id', articleId)
                  .maybeSingle();
                if (!dup) break;
                suffix++;
                candidateSlug = `${finalSlug}-${suffix}`;
              }
              finalSlug = candidateSlug;
              logger.info('api', 'processQueue.slug_deduplicated', {
                original: outlineResult.seo_filename,
                resolved: finalSlug,
                articleId,
              });
            }
          }

          const { error: articleUpdateError } = await serviceClient
            .from('articles')
            .update({
              status: 'outline_approved',
              slug: finalSlug,
              title: outlineResult.title_proposal,
              meta_description: outlineResult.meta_description,
              stage1_outline: outlineData,
              image_prompts: outlineResult.image_prompts || [],
              cta_texts: outlineResult.cta_texts || [],
              faq_data: outlineResult.faq || [],
              ai_generation_log: generationLog,
              updated_at: new Date().toISOString(),
            })
            .eq('id', articleId);

          if (articleUpdateError) {
            throw new Error(`記事のアウトライン保存に失敗: ${articleUpdateError.message}`);
          }

          // --- 7. キューステップを進める ---
          await updateQueueStep(serviceClient, queueItem.id, 'outline');

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
          const articleId = queueItem.article_id;
          if (!articleId) {
            throw new Error('article_id が設定されていません');
          }

          // 記事を取得
          const { data: article, error: articleError } = await serviceClient
            .from('articles')
            .select('*')
            .eq('id', articleId)
            .single();

          if (articleError || !article) {
            throw new Error('記事が見つかりません');
          }

          // ステータスが outline_approved であることを確認
          // draft の場合は前ステップでエラーが発生した可能性があるため、
          // outline データが存在すれば outline_approved に自動修復する
          if (article.status === 'draft' && article.stage1_outline) {
            logger.info('api', 'processQueue.auto_recover_status', {
              articleId,
              from: 'draft',
              to: 'outline_approved',
            });
            await serviceClient
              .from('articles')
              .update({ status: 'outline_approved', updated_at: new Date().toISOString() })
              .eq('id', articleId);
          } else if (article.status !== 'outline_approved' && article.status !== 'body_generating') {
            throw new Error(
              `記事ステータスが「${article.status}」のため本文生成できません（outline_approved が必要）`,
            );
          }

          const rawOutline = article.stage1_outline as Record<string, unknown> | null;
          if (
            !rawOutline ||
            !Array.isArray(rawOutline.headings) ||
            rawOutline.headings.length === 0
          ) {
            throw new Error('構成案（stage1_outline）が存在しないか、見出しがありません');
          }

          // ステータス遷移: outline_approved → body_generating
          await serviceClient
            .from('articles')
            .update({
              status: 'body_generating',
              updated_at: new Date().toISOString(),
            })
            .eq('id', articleId);

          // 本文生成チェーン実行（AI直接呼び出し）
          const outline = article.stage1_outline as unknown as Stage1OutlineResult;
          const stage2Input: Stage2Input = {
            articleId,
            outline,
            keyword: article.keyword || '',
            theme: article.theme || 'spiritual_intro',
            targetPersona: article.persona || 'spiritual_beginner',
            perspectiveType: article.perspective_type || 'concept_to_practice',
            targetWordCount: article.target_word_count ?? 2000,
          };

          let chainResult;
          try {
            chainResult = await executeStage2Chain(stage2Input);
          } catch (chainError) {
            // 失敗時は outline_approved に戻す（再試行可能にする）
            await serviceClient
              .from('articles')
              .update({
                status: 'outline_approved',
                updated_at: new Date().toISOString(),
              })
              .eq('id', articleId);
            throw chainError;
          }

          // TOC（目次）を本文に挿入
          const bodyHtmlWithToc = insertTocIntoHtml(chainResult.bodyHtml);

          // 本文保存 + ステータス → body_review
          const fullLog =
            (article.ai_generation_log || '') +
            '\n---\n' +
            chainResult.generationLog;

          await serviceClient
            .from('articles')
            .update({
              status: 'body_review',
              stage2_body_html: bodyHtmlWithToc,
              ai_generation_log: fullLog,
              updated_at: new Date().toISOString(),
            })
            .eq('id', articleId);

          await updateQueueStep(serviceClient, queueItem.id, 'body');

          logger.info('api', 'processQueue.outline_complete', {
            queueId: queueItem.id,
            articleId,
          });

          return NextResponse.json({
            processed: true,
            queueId: queueItem.id,
            previousStep: 'outline',
            currentStep: 'body',
            articleId,
          });
        }

        // ── body → 画像プロンプト生成 → images ──
        case 'body': {
          const articleId = queueItem.article_id;
          if (!articleId) {
            throw new Error('article_id が設定されていません');
          }

          // 記事を取得
          const { data: article, error: articleError } = await serviceClient
            .from('articles')
            .select('*')
            .eq('id', articleId)
            .single();

          if (articleError || !article) {
            throw new Error('記事が見つかりません');
          }

          const outline = article.stage1_outline as Record<string, unknown> | null;
          if (!outline || !outline.headings) {
            throw new Error('構成案（stage1_outline）が未生成です');
          }

          // 画像プロンプト生成（AI直接呼び出し）
          const headings = outline.headings as { level: string; text: string }[];
          const sections = headings.map((h) => h.text);

          const imagePositions: { position: string; context: string }[] = [
            {
              position: 'hero',
              context: `記事タイトル「${article.title || (outline.title_proposal as string) || ''}」のアイキャッチ画像`,
            },
            {
              position: 'body',
              context:
                sections.length > 1
                  ? `本文セクション「${sections[1]}」に対応する挿入画像`
                  : '本文中の挿入画像',
            },
            {
              position: 'summary',
              context: `まとめセクション「${sections[sections.length - 1] || ''}」に対応する締めくくり画像`,
            },
          ];

          const imgSystemPrompt = buildImagePromptSystemPrompt();
          const imgUserPrompt = buildImagePromptUserPrompt({
            title: (article.title || (outline.title_proposal as string) || '') as string,
            theme: (article.theme || '') as string,
            sections,
            imagePositions,
          });

          const { data: imgResult, response: imgResponse } =
            await generateJson<ImagePromptsResult>(imgSystemPrompt, imgUserPrompt, {
              temperature: 0.8,
              maxOutputTokens: 4096,
              timeoutMs: 55_000,
            });

          if (imgResponse.finishReason === 'MAX_TOKENS') {
            throw new Error('画像プロンプト生成: AI出力がトークン上限で切り捨てられました。');
          }
          if (!imgResult || !Array.isArray(imgResult.prompts) || imgResult.prompts.length === 0) {
            throw new Error('画像プロンプト生成: AIが有効なプロンプトを返しませんでした。');
          }

          // DB に保存
          await serviceClient
            .from('articles')
            .update({
              image_prompts: imgResult.prompts,
              updated_at: new Date().toISOString(),
            })
            .eq('id', articleId);

          await updateQueueStep(serviceClient, queueItem.id, 'images');

          logger.info('api', 'processQueue.body_complete', {
            queueId: queueItem.id,
            articleId,
            promptsCount: imgResult.prompts.length,
          });

          return NextResponse.json({
            processed: true,
            queueId: queueItem.id,
            previousStep: 'body',
            currentStep: 'images',
            articleId,
          });
        }

        // ── images → 実際の画像生成 + SEOスコアチェック → seo_check ──
        case 'images': {
          const articleId = queueItem.article_id;
          if (!articleId) {
            throw new Error('article_id が設定されていません');
          }

          // 記事を取得
          const { data: article, error: articleError } = await serviceClient
            .from('articles')
            .select('*')
            .eq('id', articleId)
            .single();

          if (articleError || !article) {
            throw new Error('記事が見つかりません');
          }

          // ── 実際の画像生成（Banana Pro） ──
          const imagePrompts = article.image_prompts as { prompt: string; position: string; alt_text_ja?: string }[] | null;
          if (imagePrompts && imagePrompts.length > 0) {
            try {
              const { generateImage } = await import('@/lib/ai/gemini-client');
              const { uploadImage } = await import('@/lib/storage/image-storage');
              const imageFiles: { position: string; url: string; alt: string; filename: string }[] = [];

              for (const imgPrompt of imagePrompts.slice(0, 3)) {
                try {
                  logger.info('api', 'processQueue.generating_image', { articleId, position: imgPrompt.position });
                  const result = await generateImage(imgPrompt.prompt, { timeoutMs: 90_000 });
                  const url = await uploadImage(articleId, imgPrompt.position, result.imageBuffer, result.mimeType);
                  imageFiles.push({
                    position: imgPrompt.position,
                    url,
                    alt: imgPrompt.alt_text_ja || '',
                    filename: `${imgPrompt.position}.webp`,
                  });
                  logger.info('api', 'processQueue.image_generated', { articleId, position: imgPrompt.position, url });
                } catch (imgErr) {
                  logger.warn('api', 'processQueue.image_failed', { articleId, position: imgPrompt.position, error: String(imgErr) });
                  // 1枚失敗しても続行
                }
              }

              if (imageFiles.length > 0) {
                await serviceClient
                  .from('articles')
                  .update({ image_files: imageFiles, updated_at: new Date().toISOString() })
                  .eq('id', articleId);
                logger.info('api', 'processQueue.images_saved', { articleId, count: imageFiles.length });
              }
            } catch (imgGenErr) {
              logger.warn('api', 'processQueue.image_generation_error', { articleId, error: String(imgGenErr) });
              // 画像生成全体が失敗しても続行（SEOチェックへ進む）
            }
          }

          const bodyHtml = (article.stage2_body_html || article.stage3_final_html) as string | null;
          if (!bodyHtml) {
            throw new Error('品質チェック対象の本文がありません');
          }

          // 品質チェック（AI直接呼び出し）
          const qcSystemPrompt = buildQualityCheckSystemPrompt();
          const qcUserPrompt = buildQualityCheckUserPrompt(bodyHtml, article.keyword || '');

          const { data: qcResult } = await generateJson<{
            overall_score: number;
            passed: boolean;
            issues: { type: string; severity: string; location: string; description: string; suggestion: string }[];
            summary: string;
          }>(qcSystemPrompt, qcUserPrompt, {
            temperature: 0.2,
            maxOutputTokens: 4096,
            timeoutMs: 60_000,
          });

          // 結果をサニタイズ
          const qualityResult = {
            overall_score: qcResult?.overall_score ?? 0,
            passed: qcResult?.passed ?? false,
            issues: Array.isArray(qcResult?.issues) ? qcResult.issues : [],
            summary: qcResult?.summary ?? '品質チェックが完了しました。',
          };

          const errorCount = qualityResult.issues.filter(
            (i: { severity: string }) => i.severity === 'error',
          ).length;
          if (errorCount > 0) {
            qualityResult.passed = false;
          }

          // 結果を DB に保存
          await serviceClient
            .from('articles')
            .update({
              seo_score: qualityResult,
              updated_at: new Date().toISOString(),
            })
            .eq('id', articleId);

          await updateQueueStep(serviceClient, queueItem.id, 'seo_check');

          logger.info('api', 'processQueue.images_complete', {
            queueId: queueItem.id,
            articleId,
            qualityScore: qualityResult.overall_score,
            passed: qualityResult.passed,
          });

          return NextResponse.json({
            processed: true,
            queueId: queueItem.id,
            previousStep: 'images',
            currentStep: 'seo_check',
            articleId,
          });
        }

        // ── seo_check → 完了 → completed ──
        case 'seo_check': {
          // キューを completed に更新 + completed_at を記録
          await updateQueueStep(serviceClient, queueItem.id, 'completed', {
            completed_at: new Date().toISOString(),
          });

          // プランステータスを completed に更新
          await updatePlanStatus(serviceClient, plan.id, 'completed');

          // 記事ステータスを editing に遷移（公開前レビュー待ち）
          if (queueItem.article_id) {
            await serviceClient
              .from('articles')
              .update({
                status: 'editing',
                updated_at: new Date().toISOString(),
              })
              .eq('id', queueItem.article_id);
          }

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

      logger.error(
        'api',
        'processQueue.step_failed',
        {
          queueId: queueItem.id,
          step: currentStep,
          errorMessage,
        },
        stepError,
      );

      // キューを failed に更新
      await markFailed(serviceClient, queueItem.id, errorMessage);

      // プランも failed に更新
      await updatePlanStatus(serviceClient, plan.id, 'failed');

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

// ─── 品質チェック用プロンプト（quality-check route.ts から移植） ─────────────

function buildQualityCheckSystemPrompt(): string {
  return `あなたはスピリチュアルコンテンツの品質管理エキスパートです。

## あなたの役割
以下の観点でスピリチュアルコラム記事の品質チェックを行い、問題点をJSON形式で報告してください。

## チェック項目

### 1. 医療境界チェック（最重要）
- 「○○が治る」「○○に効果がある」「○○で改善する」等の医療効果の断定は **error**
- 「医学的根拠」「科学的に証明」等の虚偽の権威づけは **error**
- 「○○と言われています」「○○と感じる方もいます」等の柔らかい表現は **OK**
- 薬機法・景表法に抵触しうる表現は **error**

### 2. 倫理チェック
- 宗教的断定（「○○が唯一の真理」「○○でないと救われない」）は **error**
- 過度な不安煽り（「このままでは不幸になる」「放置すると大変なことに」）は **error**
- 差別的表現・特定の宗教や信条の否定は **error**
- 金銭的誘導（「今すぐ買わないと」「限定○○名」）は **warning**

### 3. スピリチュアル用語チェック
- チャクラ名称の正確性（第1〜第7）
- エネルギーワーク用語の正しい使用
- 表記揺れ（カタカナ・英語の混在）
- 根拠なく特定の効能を謳っている場合は **warning**

### 4. 構造チェック
- CTA（<div class="harmony-cta">）が3箇所存在するか
- 画像プレースホルダー（<!--IMAGE:hero:-->, <!--IMAGE:body:-->, <!--IMAGE:summary:-->）が3箇所存在するか
- FAQ（<div class="harmony-faq">）が存在するか
- 見出し階層（H2 → H3）が正しいか

## 出力JSON スキーマ
{
  "overall_score": 85,
  "passed": true,
  "issues": [
    {
      "type": "medical_claim | religious_assertion | anxiety_inducing | term_error | structure_issue | ethical_concern",
      "severity": "error | warning | info",
      "location": "該当箇所のテキスト（前後20文字程度）",
      "description": "問題の説明",
      "suggestion": "修正案"
    }
  ],
  "summary": "全体的な品質評価のサマリー（100文字程度）"
}

## 注意
- issue が1件もない場合は issues を空配列で返す
- error レベルの問題がある場合は passed を false にする
- overall_score は error:-15点, warning:-5点, info:-1点 として 100点から減点する（最低0点）
- レスポンスは JSON のみ（前後の説明文は不要）`;
}

function buildQualityCheckUserPrompt(bodyHtml: string, keyword: string): string {
  return `以下のスピリチュアルコラム記事の品質チェックを行ってください。

## メインキーワード
${keyword}

## チェック対象の記事本文
${bodyHtml}

上記の記事について、品質チェック結果をJSON形式で出力してください。`;
}
