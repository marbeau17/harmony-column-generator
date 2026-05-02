// ============================================================================
// src/app/api/articles/[id]/auto-fix/route.ts
// POST /api/articles/[id]/auto-fix (P5-19)
//
// 品質チェック失敗項目に対する 4 戦略修復:
//   - auto-fix: 6 プロンプトのいずれかで Gemini 書換
//   - regen-chapter: 既存 regenerate-segment ロジックへ delegate (本実装では直接ヘルパ呼出)
//   - regen-full: 同上
//   - ignore-warn: quality_overrides に永続化
// 仕様書: docs/auto-fix-spec.md §2.4
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  createServerSupabaseClient,
  createServiceRoleClient,
} from '@/lib/supabase/server';
import { autoFixRequestSchema } from '@/lib/validators/auto-fix';
import { isStrategyAllowed } from '@/lib/auto-fix/strategy-map';
import {
  runAutoFix,
  appendQualityOverride,
  buildDiffSummary,
} from '@/lib/auto-fix/orchestrator';
import type { QualityOverride } from '@/lib/auto-fix/types';
import { assertArticleWriteAllowed } from '@/lib/publish-control/session-guard';
import { saveRevision } from '@/lib/db/article-revisions';
import { logger } from '@/lib/logger';

interface ArticleRow {
  id: string;
  title: string | null;
  status: string;
  keyword: string | null;
  stage2_body_html: string | null;
  stage3_final_html: string | null;
  quality_overrides: QualityOverride[] | null;
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const { id: articleId } = await ctx.params;

  // 1. 認証
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  // 2. body 検証
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 解析に失敗しました' }, { status: 400 });
  }
  const parsed = autoFixRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'バリデーションエラー', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const req = parsed.data;

  // 3. 戦略マップ許可チェック
  const allowed = isStrategyAllowed(req.check_item_id, req.fix_strategy);
  if (!allowed.allowed) {
    return NextResponse.json(
      { error: allowed.reason },
      { status: 400 },
    );
  }

  console.log('[auto-fix.api.begin]', {
    articleId,
    check_item_id: req.check_item_id,
    fix_strategy: req.fix_strategy,
  });

  // 4. articles 取得
  const serviceClient = await createServiceRoleClient();
  const { data: article, error: aErr } = await serviceClient
    .from('articles')
    .select('id, title, status, keyword, stage2_body_html, stage3_final_html, quality_overrides')
    .eq('id', articleId)
    .maybeSingle();
  if (aErr || !article) {
    return NextResponse.json(
      { error: `記事が見つかりません: ${articleId}` },
      { status: 404 },
    );
  }
  const row = article as ArticleRow;

  // 5. session-guard (synchronous; throws on block)
  try {
    assertArticleWriteAllowed(articleId, ['stage2_body_html', 'quality_overrides']);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 423 },
    );
  }

  // ─── 戦略別ディスパッチ ─────────────────────────────────────
  try {
    if (req.fix_strategy === 'ignore-warn') {
      const result = await appendQualityOverride({
        supabase: serviceClient,
        articleId,
        checkItemId: req.check_item_id,
        ignoreParams: req.ignore_params!,
        userId: user.id,
        existingOverrides: row.quality_overrides ?? [],
      });
      logger.info('api', 'auto-fix.ignore', {
        articleId,
        check_item_id: req.check_item_id,
        overrides_count: result.overrides.length,
      });
      return NextResponse.json({
        ok: true,
        fix_strategy: 'ignore-warn',
        check_item_id: req.check_item_id,
        cost_estimate: 0,
        overrides: result.overrides,
      });
    }

    if (req.fix_strategy === 'auto-fix') {
      const beforeHtml = row.stage2_body_html ?? '';
      if (!beforeHtml) {
        return NextResponse.json(
          { error: 'stage2_body_html が空のため auto-fix 実行不可。Stage2 を先に実行してください' },
          { status: 422 },
        );
      }

      // 修復前 revision (HTML 履歴ルール、先行 INSERT)
      try {
        await saveRevision(
          articleId,
          {
            title: row.title ?? undefined,
            body_html: beforeHtml,
          },
          'auto_fix_before',
          user.id,
        );
      } catch (e) {
        // 履歴失敗は警告のみで継続（本体修正は走らせる）
        console.warn('[auto-fix.revision.before.failed]', {
          articleId,
          error_message: (e as Error).message,
        });
      }

      // P5-28: keyword 自動補正時は articles.keyword から自動抽出 (FE が知らなくて済む)
      const enrichedParams = { ...req.auto_fix_params! };
      if (
        enrichedParams.fix_type === 'keyword' &&
        (!enrichedParams.keywords || enrichedParams.keywords.length === 0) &&
        row.keyword
      ) {
        enrichedParams.keywords = row.keyword
          .split(/[,、]/)
          .map((s) => s.trim())
          .filter((s) => s.length >= 2);
      }
      const { after_html, cost_estimate } = await runAutoFix({
        bodyHtml: beforeHtml,
        params: enrichedParams,
      });

      // articles UPDATE
      const { error: updErr } = await serviceClient
        .from('articles')
        .update({ stage2_body_html: after_html })
        .eq('id', articleId);
      if (updErr) {
        return NextResponse.json(
          { error: `articles UPDATE 失敗: ${updErr.message}` },
          { status: 500 },
        );
      }

      // 修復後 revision
      try {
        await saveRevision(
          articleId,
          {
            title: row.title ?? undefined,
            body_html: after_html,
          },
          'auto_fix_after',
          user.id,
        );
      } catch (e) {
        console.warn('[auto-fix.revision.after.failed]', {
          articleId,
          error_message: (e as Error).message,
        });
      }

      const diff_summary = buildDiffSummary(beforeHtml, after_html);
      logger.info('api', 'auto-fix.success', {
        articleId,
        check_item_id: req.check_item_id,
        fix_type: req.auto_fix_params?.fix_type,
        diff_summary,
        elapsed_ms: Date.now() - startedAt,
      });

      return NextResponse.json({
        ok: true,
        fix_strategy: 'auto-fix',
        check_item_id: req.check_item_id,
        before_html: beforeHtml,
        after_html,
        diff_summary,
        cost_estimate,
      });
    }

    if (req.fix_strategy === 'regen-chapter' || req.fix_strategy === 'regen-full') {
      // 既存 regenerate-segment route に POST を proxy する形で実装する。
      // 内部 fetch だと auth が落ちるので、共通ライブラリ呼出が望ましいが、
      // 本サイクル MVP では UI 側で /regenerate-segment を直接呼ぶことを推奨。
      // ここでは戦略許可確認のみ行い、UI に hint を返す。
      return NextResponse.json(
        {
          ok: false,
          fix_strategy: req.fix_strategy,
          check_item_id: req.check_item_id,
          error_message:
            '本 API は再生成戦略を直接扱いません。UI から POST /api/articles/[id]/regenerate-segment を呼んでください。',
          cost_estimate:
            req.fix_strategy === 'regen-chapter' ? 0.05 : 0.18,
        },
        { status: 501 },
      );
    }

    return NextResponse.json(
      { error: 'unknown fix_strategy' },
      { status: 400 },
    );
  } catch (e) {
    logger.error('api', 'auto-fix.failed', undefined, e);
    return NextResponse.json(
      {
        ok: false,
        error: '修復に失敗しました',
        error_message: (e as Error).message,
      },
      { status: 500 },
    );
  }
}
