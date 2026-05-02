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
import { computeAndSaveRelatedArticles, updateAllRelatedArticles } from '@/lib/publish/auto-related';
import { exportArticleToOut, exportHubPageToOut } from '@/lib/export/static-exporter';

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
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
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

    // P5-35: ?force=true で品質チェック完全 bypass (緊急公開専用)
    // これは frontend の override 適用 (P5-31) と二重ゲートになる安全装置
    const forceParam = request.nextUrl.searchParams.get('force');
    const forceBypass = forceParam === 'true' || forceParam === '1';
    if (forceBypass) {
      logger.warn('api', 'transition.force_bypass', {
        articleId: id,
        toStatus: status,
        userId: user.id,
      });
    }

    // published への遷移時は品質チェックリストを実行 (force=true なら skip)
    if (status === 'published' && !forceBypass) {
      const { runQualityChecklist } = await import('@/lib/content/quality-checklist');
      const html = existing.published_html || existing.stage2_body_html || '';
      if (html) {
        // P5-34: quality_overrides を取得 (escape hatch / ignore-warn 連携)
        // フロント (P5-31) で bulk override 後、backend transition でも pass 扱いに
        // しないと公開できない。
        type Override = { check_item_id: string };
        const { createServiceRoleClient } = await import('@/lib/supabase/server');
        const sb = await createServiceRoleClient();
        const { data: row } = await sb
          .from('articles')
          .select('quality_overrides')
          .eq('id', id)
          .maybeSingle();
        const overrides = (row?.quality_overrides as Override[] | null) ?? [];

        const checkResult = runQualityChecklist({
          title: existing.title || '',
          html,
          keyword: existing.keyword || undefined,
          metaDescription: existing.meta_description || undefined,
          theme: existing.theme || undefined,
        });

        // override 適用
        if (overrides.length > 0 && Array.isArray(checkResult.items)) {
          const overrideIds = new Set(overrides.map((o) => o.check_item_id));
          let suppressedErrors = 0;
          for (const item of checkResult.items) {
            if (overrideIds.has(item.id) && item.status !== 'pass') {
              if (item.severity === 'error') suppressedErrors++;
              item.status = 'pass';
              item.detail = `(無視済) ${item.detail ?? ''}`.trim();
            }
          }
          checkResult.errorCount = Math.max(0, checkResult.errorCount - suppressedErrors);
          checkResult.passed = checkResult.errorCount === 0;
          logger.info('api', 'transition.quality_overrides_applied', {
            articleId: id,
            overrides_count: overrides.length,
            suppressed_errors: suppressedErrors,
            now_passed: checkResult.passed,
          });
        }

        if (!checkResult.passed) {
          const failedItems = checkResult.items
            .filter(i => i.status === 'fail' && i.severity === 'error')
            .map(i => `${i.label}${i.detail ? ` (${i.detail})` : ''}`)
            .join('; ');

          return NextResponse.json({
            error: `品質チェック不合格: ${failedItems}`,
            qualityCheck: checkResult,
          }, { status: 422 });
        }
      }
    }

    // ステータス遷移実行（transitionArticleStatus 内で VALID_TRANSITIONS を検証）
    const updated = await transitionArticleStatus(id, status as ArticleStatus);

    logger.info('api', 'transitionArticleStatus', {
      articleId: id,
      from: existing.status,
      to: status,
    });

    // published に遷移した場合、バックグラウンドでハブページ再生成を実行
    if (status === 'published') {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      fetch(`${appUrl}/api/hub/rebuild`, { method: 'POST' })
        .then((res) => {
          if (res.ok) {
            logger.info('api', 'hub-rebuild-triggered', { articleId: id });
          } else {
            logger.warn('api', 'hub-rebuild-failed', {
              articleId: id,
              status: res.status,
            });
          }
        })
        .catch((err) => {
          logger.error('api', 'hub-rebuild-error', { articleId: id }, err);
        });

      // 関連記事を自動計算・保存（新記事 + 既存記事すべて更新）
      computeAndSaveRelatedArticles(id)
        .then(() => updateAllRelatedArticles())
        .then((result) => {
          logger.info('api', 'related-articles-updated', { articleId: id, updated: result.updated });
        })
        .catch((err) => {
          logger.error('api', 'related-articles-error', { articleId: id }, err);
        });

      // out/ ディレクトリへ静的エクスポート（ローカル環境のみ）
      if (!process.env.VERCEL) {
        exportArticleToOut(id)
          .then(() => exportHubPageToOut())
          .then((hubResult) => {
            logger.info('api', 'static-export-complete', { articleId: id, files: hubResult.files.length });
          })
          .catch((err) => {
            logger.error('api', 'static-export-error', { articleId: id }, err);
          });
      }
    }

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
