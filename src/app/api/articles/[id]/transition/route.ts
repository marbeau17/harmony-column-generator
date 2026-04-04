// ============================================================================
// src/app/api/articles/[id]/transition/route.ts
// 記事ステータス遷移API
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  getArticleById,
  transitionArticleStatus,
  type ArticleStatus,
} from '@/lib/db/articles';
import { logger } from '@/lib/logger';

const VALID_STATUSES: ArticleStatus[] = [
  'draft',
  'outline_pending',
  'outline_approved',
  'body_generating',
  'body_review',
  'editing',
  'published',
];

type RouteParams = { params: { id: string } };

// ─── POST /api/articles/[id]/transition ────────────────────────────────────

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    // 認証チェック
    const supabase = createServerSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const { id } = params;

    // リクエストボディ取得
    const body = await request.json();
    const { status } = body;

    // ステータス値の検証
    if (!status || typeof status !== 'string') {
      return NextResponse.json(
        { error: 'status は必須です' },
        { status: 400 },
      );
    }

    if (!VALID_STATUSES.includes(status as ArticleStatus)) {
      return NextResponse.json(
        {
          error: `無効なステータスです: ${status}`,
          validStatuses: VALID_STATUSES,
        },
        { status: 400 },
      );
    }

    // 記事の存在確認
    const existing = await getArticleById(id);
    if (!existing) {
      return NextResponse.json(
        { error: '記事が見つかりません' },
        { status: 404 },
      );
    }

    // ステータス遷移実行（transitionArticleStatus 内で VALID_TRANSITIONS を検証）
    const updated = await transitionArticleStatus(id, status as ArticleStatus);

    logger.info('api', 'transitionArticleStatus', {
      articleId: id,
      from: existing.status,
      to: status,
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'ステータス遷移に失敗しました';

    // VALID_TRANSITIONS 違反の場合は 400 で返す
    if (message.includes('Invalid status transition')) {
      logger.warn('api', 'transitionArticleStatus', {
        articleId: params.id,
        error: message,
      });
      return NextResponse.json({ error: message }, { status: 400 });
    }

    logger.error('api', 'transitionArticleStatus', { articleId: params.id }, error);
    return NextResponse.json(
      { error: 'ステータス遷移に失敗しました' },
      { status: 500 },
    );
  }
}
