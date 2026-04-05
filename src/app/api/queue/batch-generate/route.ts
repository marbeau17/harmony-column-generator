// POST /api/queue/batch-generate
// Finds all outline_approved articles, ensures they have queue entries, returns the list

import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

export const maxDuration = 60;

export async function POST() {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const serviceClient = await createServiceRoleClient();

    // 1. Find all articles in outline_approved or body_review status
    const { data: articles, error: articlesError } = await serviceClient
      .from('articles')
      .select('id, title, slug, keyword, theme, status')
      .in('status', ['outline_approved', 'body_review', 'editing'])
      .order('created_at', { ascending: true });

    if (articlesError) {
      throw new Error(`記事の取得に失敗: ${articlesError.message}`);
    }

    if (!articles || articles.length === 0) {
      return NextResponse.json({
        batchItems: [],
        totalCount: 0,
        message: '処理対象の記事がありません',
      });
    }

    // 2. For each article, determine the starting queue step based on status
    const batchItems = [];

    // Map article status to the appropriate queue starting step
    const statusToStep: Record<string, string> = {
      outline_approved: 'outline',  // needs body generation
      body_review: 'body',          // needs image prompts
      editing: 'images',            // needs image generation + SEO + publish
    };

    for (const article of articles) {
      const targetStep = statusToStep[article.status] || 'outline';

      // Check existing queue entry
      const { data: existingQueue } = await serviceClient
        .from('generation_queue')
        .select('id, step, error_message, plan_id')
        .eq('article_id', article.id)
        .maybeSingle();

      let queueId: string;

      if (existingQueue && !existingQueue.error_message &&
          ['outline', 'body', 'images', 'seo_check'].includes(existingQueue.step)) {
        // Already has a valid queue entry - reset it for batch processing
        await serviceClient
          .from('generation_queue')
          .update({ started_at: null })
          .eq('id', existingQueue.id);
        queueId = existingQueue.id;
      } else if (existingQueue && existingQueue.error_message) {
        // Failed entry - reset to appropriate step
        const { error: resetError } = await serviceClient
          .from('generation_queue')
          .update({
            step: targetStep,
            error_message: null,
            started_at: null,
            completed_at: null,
          })
          .eq('id', existingQueue.id);
        if (resetError) {
          logger.warn('api', 'batchGenerate.resetFailed', { articleId: article.id, error: resetError.message });
          continue;
        }
        queueId = existingQueue.id;
      } else if (existingQueue && existingQueue.step === 'completed') {
        // Already completed - create new queue entry at the right step
        const { data: newQueue, error: insertError } = await serviceClient
          .from('generation_queue')
          .insert({
            plan_id: existingQueue.plan_id,
            article_id: article.id,
            step: targetStep,
            priority: 0,
          })
          .select('id')
          .single();
        if (insertError) {
          logger.warn('api', 'batchGenerate.reinsertFailed', { articleId: article.id, error: insertError.message });
          continue;
        }
        queueId = newQueue.id;
      } else if (!existingQueue) {
        // No queue entry - find plan and create one
        const { data: plan } = await serviceClient
          .from('content_plans')
          .select('id')
          .eq('article_id', article.id)
          .maybeSingle();

        const planId = plan?.id || null;

        const { data: newQueue, error: insertError } = await serviceClient
          .from('generation_queue')
          .insert({
            plan_id: planId,
            article_id: article.id,
            step: targetStep,
            priority: 0,
          })
          .select('id')
          .single();

        if (insertError) {
          logger.warn('api', 'batchGenerate.insertFailed', { articleId: article.id, error: insertError.message });
          continue;
        }
        queueId = newQueue.id;
      } else {
        // existingQueue with completed step - skip
        continue;
      }

      batchItems.push({
        queueId,
        articleId: article.id,
        keyword: article.keyword || '',
        title: article.title || article.slug || '',
        currentStep: 'outline',
      });
    }

    // Reset started_at for all batch items to ensure they can be picked up
    if (batchItems.length > 0) {
      const queueIds = batchItems.map((b: { queueId: string }) => b.queueId);
      await serviceClient
        .from('generation_queue')
        .update({ started_at: null, error_message: null })
        .in('id', queueIds);
      logger.info('api', 'batchGenerate.reset_started_at', { count: queueIds.length });
    }

    logger.info('api', 'batchGenerate.prepared', { totalCount: batchItems.length });

    return NextResponse.json({
      batchItems,
      totalCount: batchItems.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('api', 'batchGenerate.error', { error: message });
    return NextResponse.json({ error: `一括生成の準備に失敗: ${message}` }, { status: 500 });
  }
}
