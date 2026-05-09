// ============================================================================
// src/app/api/articles/[id]/route.ts
// 記事詳細取得 / 記事更新 / 記事削除 API
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  createServerSupabaseClient,
  createServiceRoleClient,
} from '@/lib/supabase/server';
import {
  getArticleById,
  updateArticle,
  deleteArticle,
} from '@/lib/db/articles';
import { updateArticleSchema, validate } from '@/lib/validators/article';
import { validateArticleContentPayload } from '@/lib/validators/article-content';
import { generateSlug } from '@/lib/seo/meta-generator';
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

    // P5-100: kishotenketsu_approved_at を立てるなら kishotenketsu 本体が必須。
    // payload に approved_at を新規セットするのに、payload にも DB にも
    // kishotenketsu プランが無い場合は「中身の無い承認」になり仕様違反。
    {
      const data = result.data as {
        kishotenketsu?: unknown;
        kishotenketsu_approved_at?: string | null;
      };
      const payloadHasApprovedAt = Object.prototype.hasOwnProperty.call(
        data,
        'kishotenketsu_approved_at',
      );
      const settingApprovedAt =
        payloadHasApprovedAt &&
        typeof data.kishotenketsu_approved_at === 'string' &&
        data.kishotenketsu_approved_at.length > 0;
      if (settingApprovedAt) {
        const payloadHasPlan = Object.prototype.hasOwnProperty.call(
          data,
          'kishotenketsu',
        );
        const payloadPlan = data.kishotenketsu;
        const dbPlan = (existing as { kishotenketsu?: unknown } | null)
          ?.kishotenketsu;
        const incomingPlanIsObject =
          payloadHasPlan && payloadPlan != null && typeof payloadPlan === 'object';
        const dbPlanIsObject = dbPlan != null && typeof dbPlan === 'object';
        if (!incomingPlanIsObject && !dbPlanIsObject) {
          logger.warn('api', 'updateArticle.kishotenketsu_approve_without_plan', {
            articleId: id,
          });
          return NextResponse.json(
            {
              error:
                '起承転結プランが存在しない状態で承認時刻を設定することはできません',
              code: 'KISHOTENKETSU_PLAN_REQUIRED',
            },
            { status: 400 },
          );
        }
      }
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

    // slug 自動生成: title が含まれており、かつ既存 slug が空 (null/empty) で
    // payload に明示的な slug 指定が無い場合のみ補完する。
    // (preserve-article-content: 既に slug が入っている記事には触らない)
    const payload = { ...result.data };
    const existingSlug =
      typeof existing.slug === 'string' ? existing.slug.trim() : '';
    const payloadHasSlug = Object.prototype.hasOwnProperty.call(
      payload,
      'slug',
    );
    if (
      typeof payload.title === 'string' &&
      payload.title.length > 0 &&
      existingSlug === '' &&
      !payloadHasSlug
    ) {
      const baseSlug = generateSlug(payload.title);
      const adminClient = await createServiceRoleClient();
      let candidate = baseSlug;
      let suffix = 2;
      // 衝突時は -2, -3, ... を付与して unique な slug を確定させる
      // 万一 service-role SELECT に失敗した場合はループを抜けて baseSlug を採用
      // (ハードフェイルさせるとリリース不可になるため安全側に倒す)
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data: clash, error: clashError } = await adminClient
          .from('articles')
          .select('id')
          .eq('slug', candidate)
          .neq('id', id)
          .limit(1)
          .maybeSingle();
        if (clashError) {
          logger.warn('api', 'updateArticle.slug_check_failed', {
            articleId: id,
            candidate,
            error: clashError.message,
          });
          break;
        }
        if (!clash) break;
        candidate = `${baseSlug}-${suffix}`;
        suffix += 1;
        if (suffix > 100) break; // 安全装置
      }
      payload.slug = candidate;
      logger.info('api', 'updateArticle.slug_autogenerated', {
        articleId: id,
        slug: candidate,
      });
    }

    // 記事更新
    const updated = await updateArticle(id, payload);

    logger.info('api', 'updateArticle', {
      articleId: id,
      updatedFields: Object.keys(payload),
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

// ─── PATCH /api/articles/[id] ───────────────────────────────────────────────
// P5-100 (kishotenketsu-flow §6.1): UI 起承転結レビュー画面の「保存」「承認」
// 操作は PATCH を使う想定 (REST 慣習: 部分更新)。実装は PUT と同じ
// updateArticleSchema を共有し、内部で PUT ハンドラに委譲する薄いエイリアス。
// PUT 互換も維持 (既存呼出し元に影響しない)。

export async function PATCH(request: NextRequest, ctx: RouteParams) {
  return PUT(request, ctx);
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
