// ============================================================================
// src/app/api/articles/[id]/route.ts
// 記事詳細取得 / 記事更新 / 記事削除 API
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  getArticleById,
  updateArticle,
  deleteArticle,
} from '@/lib/db/articles';
import { updateArticleSchema, validate } from '@/lib/validators/article';
import { validateArticleContentPayload } from '@/lib/validators/article-content';
import { logger } from '@/lib/logger';

type RouteParams = { params: { id: string } };

// ─── GET /api/articles/[id] ─────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: RouteParams) {
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

    const article = await getArticleById(id);
    if (!article) {
      return NextResponse.json(
        { error: '記事が見つかりません' },
        { status: 404 },
      );
    }

    logger.info('api', 'getArticle', { articleId: id });

    return NextResponse.json({ data: article });
  } catch (error) {
    logger.error('api', 'getArticle', { articleId: params.id }, error);
    return NextResponse.json(
      { error: '記事の取得に失敗しました' },
      { status: 500 },
    );
  }
}

// ─── PUT /api/articles/[id] ─────────────────────────────────────────────────

export async function PUT(request: NextRequest, { params }: RouteParams) {
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

    // 記事の存在確認
    const existing = await getArticleById(id);
    if (!existing) {
      return NextResponse.json(
        { error: '記事が見つかりません' },
        { status: 404 },
      );
    }

    // リクエストボディ取得 & バリデーション
    const body = await request.json();
    const result = validate(updateArticleSchema, body);
    if (!result.success) {
      return NextResponse.json(
        { error: 'バリデーションエラー', details: result.error.flatten() },
        { status: 400 },
      );
    }

    // P5-32: stage2/stage3 契約検証 (Layer 4)
    // template 混入 / body のみで stage3 上書き等を save 時に reject
    const contentCheck = validateArticleContentPayload(
      result.data as Record<string, unknown>,
    );
    if (!contentCheck.ok) {
      logger.warn('api', 'updateArticle.content_violation', {
        articleId: id,
        issues: contentCheck.issues,
      });
      return NextResponse.json(
        {
          error: '記事内容の契約違反が検出されました',
          details: { issues: contentCheck.issues },
        },
        { status: 400 },
      );
    }

    // 記事更新
    const updated = await updateArticle(id, result.data);

    logger.info('api', 'updateArticle', {
      articleId: id,
      updatedFields: Object.keys(result.data),
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    logger.error('api', 'updateArticle', { articleId: params.id }, error);
    return NextResponse.json(
      { error: '記事の更新に失敗しました' },
      { status: 500 },
    );
  }
}

// ─── DELETE /api/articles/[id] ──────────────────────────────────────────────

export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

    // 記事の存在確認
    const existing = await getArticleById(id);
    if (!existing) {
      return NextResponse.json(
        { error: '記事が見つかりません' },
        { status: 404 },
      );
    }

    // 記事削除
    await deleteArticle(id);

    logger.info('api', 'deleteArticle', { articleId: id });

    return NextResponse.json({ data: { id, deleted: true } });
  } catch (error) {
    logger.error('api', 'deleteArticle', { articleId: params.id }, error);
    return NextResponse.json(
      { error: '記事の削除に失敗しました' },
      { status: 500 },
    );
  }
}
