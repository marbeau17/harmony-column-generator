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

    // 1. Find all articles in outline_approved status
    const { data: articles, error: articlesError } = await serviceClient
      .from('articles')
      .select('id, title, slug, keyword, theme')
      .eq('status', 'outline_approved')
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

    // 2. For each article, ensure a queue entry exists at 'outline' step
    const batchItems = [];

    for (const article of articles) {
      // Check existing queue entry
      const { data: existingQueue } = await serviceClient
        .from('generation_queue')
        .select('id, step, error_message, plan_id')
        .eq('article_id', article.id)
        .maybeSingle();

      let queueId: string;

      if (existingQueue && !existingQueue.error_message &&
          ['outline', 'body', 'images', 'seo_check'].includes(existingQueue.step)) {
        // Already has a valid queue entry
        queueId = existingQueue.id;
      } else if (existingQueue && existingQueue.error_message) {
        // Failed entry - reset it
        const { error: resetError } = await serviceClient
          .from('generation_queue')
          .update({
            step: 'outline',
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
      } else if (!existingQueue) {
        // No queue entry - find plan and create one
        const { data: plan } = await serviceClient
          .from('content_plans')
          .select('id')
          .eq('article_id', article.id)
          .maybeSingle();

        if (!plan) {
          logger.warn('api', 'batchGenerate.noPlan', { articleId: article.id });
          continue;
        }

        const { data: newQueue, error: insertError } = await serviceClient
          .from('generation_queue')
          .insert({
            plan_id: plan.id,
            article_id: article.id,
            step: 'outline',
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
