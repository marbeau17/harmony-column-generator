// ============================================================================
// src/app/api/queue/[id]/retry/route.ts
// POST /api/queue/:id/retry — 失敗したキューアイテムをリトライ（pendingに戻す）
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

type RouteParams = { params: { id: string } };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // 認証チェック
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const { id } = params;
    const serviceClient = await createServiceRoleClient();

    // 対象のキューアイテムを取得
    const { data: queueItem, error: fetchError } = await serviceClient
      .from('generation_queue')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) {
      logger.error('api', 'retryQueueItem.fetch', { id }, fetchError);
      return NextResponse.json(
        { error: 'キューアイテムの取得に失敗しました' },
        { status: 500 },
      );
    }

    if (!queueItem) {
      return NextResponse.json(
        { error: 'キューアイテムが見つかりません' },
        { status: 404 },
      );
    }

    if (queueItem.step !== 'failed') {
      return NextResponse.json(
        { error: 'このアイテムは失敗状態ではありません' },
        { status: 400 },
      );
    }

    // pending に戻してエラーメッセージをクリア
    const { error: updateError } = await serviceClient
      .from('generation_queue')
      .update({
        step: 'pending',
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      logger.error('api', 'retryQueueItem.update', { id }, updateError);
      return NextResponse.json(
        { error: 'キューアイテムの更新に失敗しました' },
        { status: 500 },
      );
    }

    logger.info('api', 'retryQueueItem', { id, previousStep: 'failed', newStep: 'pending' });

    return NextResponse.json({
      success: true,
      id,
      step: 'pending',
    });
  } catch (error) {
    logger.error('api', 'retryQueueItem', undefined, error);
    return NextResponse.json(
      { error: 'リトライに失敗しました' },
      { status: 500 },
    );
  }
}
