// ============================================================================
// src/app/api/ai/generate-body/route.ts
// POST /api/ai/generate-body
// ステージ2: 本文生成（スピリチュアルコラム向け・Supabase使用）
//
// フロー:
//   1. リクエスト検証 (articleId 必須)
//   2. Supabase認証チェック
//   3. 記事取得 — status が outline_approved であることを確認
//   4. stage1_outline の存在確認
//   5. ステータス遷移: outline_approved → body_generating
//   6. executeStage2Chain 呼出（Writing → Proofreading → QualityCheck）
//   7. 成功時: stage2_body_html 保存, status → body_review
//   8. 失敗時: status → outline_approved にロールバック
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { executeStage2Chain } from '@/lib/ai/prompt-chain';
import { insertTocIntoHtml } from '@/lib/content/toc-generator';
import { logger } from '@/lib/logger';
import type { Stage1OutlineResult, Stage2Input } from '@/types/ai';

// Vercel Serverless 最大実行時間を180秒に設定
export const maxDuration = 180;

// ─── リクエストスキーマ ─────────────────────────────────────────────────────

const requestSchema = z.object({
  articleId: z.string().uuid('記事IDはUUID形式で指定してください'),
});

// ─── ハンドラー ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. 認証チェック
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  // 2. リクエスト解析
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'リクエストボディが不正です。JSON形式で articleId を指定してください。' },
      { status: 400 },
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }
  const { articleId } = parsed.data;

  // 3. 記事を取得
  const { data: article, error: articleError } = await supabase
    .from('articles')
    .select('*')
    .eq('id', articleId)
    .single();

  if (articleError || !article) {
    return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 });
  }

  // ステータスチェック — outline_approved のみ本文生成可能
  if (article.status !== 'outline_approved') {
    return NextResponse.json(
      {
        error: `現在のステータス「${article.status}」では本文生成を開始できません。構成案が承認済み（outline_approved）である必要があります。`,
      },
      { status: 409 },
    );
  }

  // 4. 構成案の存在確認 + 構造検証
  const rawOutline = article.stage1_outline as Record<string, unknown> | null;
  if (!rawOutline) {
    return NextResponse.json(
      { error: '構成案（stage1_outline）が存在しません。先にステージ1を完了してください。' },
      { status: 409 },
    );
  }
  if (
    !Array.isArray((rawOutline as Record<string, unknown>).headings) ||
    ((rawOutline as Record<string, unknown>).headings as unknown[]).length === 0
  ) {
    return NextResponse.json(
      { error: '構成案に見出し（headings）がありません。構成案を再生成してください。' },
      { status: 409 },
    );
  }

  // 5. ステータス遷移: outline_approved → body_generating
  const { error: transitionError } = await supabase
    .from('articles')
    .update({
      status: 'body_generating',
      updated_at: new Date().toISOString(),
    })
    .eq('id', articleId);

  if (transitionError) {
    logger.error('ai', 'stage2.transition_to_generating_failed', { articleId }, transitionError);
    return NextResponse.json(
      { error: 'ステータスの遷移に失敗しました' },
      { status: 500 },
    );
  }

  // 6. プロンプトチェーン実行
  logger.info('ai', 'stage2.chain_start', {
    articleId,
    keyword: article.keyword,
  });

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
    // チェーン失敗 → エラーログを記事に記録
    logger.error('ai', 'stage2.chain_failed', { articleId }, chainError);

    const errorLog = JSON.stringify({
      stage: 'stage2_chain',
      error: chainError instanceof Error ? chainError.message : String(chainError),
      timestamp: new Date().toISOString(),
    });

    // エラーログ追記
    await supabase
      .from('articles')
      .update({
        ai_generation_log:
          (article.ai_generation_log || '') + '\n---\n' + errorLog,
        updated_at: new Date().toISOString(),
      })
      .eq('id', articleId);

    // outline_approved に戻す（再試行可能にする）
    const { error: rollbackError } = await supabase
      .from('articles')
      .update({
        status: 'outline_approved',
        updated_at: new Date().toISOString(),
      })
      .eq('id', articleId);

    if (rollbackError) {
      logger.warn('ai', 'stage2.rollback_transition_failed', { articleId });
    } else {
      logger.info('ai', 'stage2.rollback_to_outline_approved', { articleId });
    }

    return NextResponse.json(
      {
        error: 'AI による本文生成に失敗しました。しばらく待ってから再試行してください。',
        ...(process.env.NODE_ENV === 'development'
          ? { detail: chainError instanceof Error ? chainError.message : '不明なエラー' }
          : {}),
      },
      { status: 502 },
    );
  }

  // 7. TOC（目次）を本文に挿入 + DB 保存 + ステータス遷移: body_generating → body_review
  const bodyHtmlWithToc = insertTocIntoHtml(chainResult.bodyHtml);

  try {
    const fullLog =
      (article.ai_generation_log || '') +
      '\n---\n' +
      chainResult.generationLog;

    const { error: saveError } = await supabase
      .from('articles')
      .update({
        status: 'body_review',
        stage2_body_html: bodyHtmlWithToc,
        ai_generation_log: fullLog,
        updated_at: new Date().toISOString(),
      })
      .eq('id', articleId);

    if (saveError) {
      throw saveError;
    }
  } catch (dbError) {
    logger.error('ai', 'stage2.db_save_failed', { articleId }, dbError);
    return NextResponse.json(
      { error: 'DB への保存に失敗しました' },
      { status: 500 },
    );
  }

  // 8. レスポンス返却
  return NextResponse.json({
    success: true,
    articleId,
    bodyHtml: bodyHtmlWithToc,
    proofreadCorrections: chainResult.proofreadResult.corrections,
    stats: {
      bodyLength: bodyHtmlWithToc.length,
      correctionsCount: chainResult.proofreadResult.corrections.length,
    },
  });
}
