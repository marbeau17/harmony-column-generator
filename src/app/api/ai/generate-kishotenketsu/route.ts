// ============================================================================
// src/app/api/ai/generate-kishotenketsu/route.ts
// POST /api/ai/generate-kishotenketsu
//
// 起承転結 (kishotenketsu) 4 段プランの (再) 生成エンドポイント。
// spec: docs/specs/kishotenketsu-flow.md §6.1 (API 拡張 / 新設) + §3.1 (schema)
//
// 入力 : { article_id: string }
// 処理 :
//   1. 認証 (createServerSupabaseClient.auth.getUser)
//   2. 記事取得 — stage1_outline が存在することを確認
//   3. Gemini に Stage1 outline を渡して 4 段プランを JSON で生成
//   4. kishotenketsuSchema で検証 (50〜150 字 × 4 段 + perspective_shift)
//   5. articles.kishotenketsu を UPDATE、kishotenketsu_approved_at は NULL
//      にクリア (再生成扱いのため、再承認を必須にする)
//   6. 200 で生成済み plan を返却
//
// 注意:
//   - Stage2 を起動する権限はない (本ルートはプラン生成のみ)
//   - existing 既存仕様 (narrative_arc 経路 / 旧 path) は一切触らない
//   - kishotenketsu_approved_at をクリアすることで、UI が「未承認」バッジに
//     即時遷移する。承認は別 API (PATCH /api/articles/[id]) の責務。
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createServerSupabaseClient,
  createServiceRoleClient,
} from '@/lib/supabase/server';
import { generateJson } from '@/lib/ai/gemini-client';
import { kishotenketsuSchema } from '@/lib/schemas/kishotenketsu';
import { logger } from '@/lib/logger';

// Vercel Serverless 最大実行時間 (Gemini 呼出 1 回のみだが余裕を持たせる)
export const maxDuration = 60;

// ─── リクエストスキーマ ─────────────────────────────────────────────────────

const requestSchema = z.object({
  article_id: z.string().uuid('article_id は UUID 形式で指定してください'),
});

// ─── システム / ユーザープロンプト ──────────────────────────────────────────

// 仕様書 §3 / §4.1 と整合: 各 phase 50〜150 字、転は視点転換必須、結は受容と
// 行動提案、ten_perspective_shift で承→転の角度差を自己説明させる。
const KISHOTENKETSU_SYSTEM_PROMPT =
  'あなたは由起子さんのスピリチュアルコラムの構成編集者です。' +
  '与えられた Stage1 outline を読み、起承転結 (ki / sho / ten / ketsu) の 4 段プランを' +
  ' JSON で返してください。各段は 50〜150 字、転 (ten) には必ず「視点転換」' +
  '(承の前提を問い直す異なる視点) を入れてください。説明文・前置き・コードブロックは禁止、' +
  'JSON オブジェクトのみを返してください。';

interface OutlineForPrompt {
  lead_summary?: unknown;
  narrative_arc?: unknown;
  h2_chapters?: unknown;
  citation_highlights?: unknown;
  faq_items?: unknown;
}

function buildKishotenketsuUserPrompt(outline: OutlineForPrompt): string {
  // outline の主要フィールドだけを抽出して prompt に同梱する。
  // 巨大な image_prompts 等は不要なので渡さない (token 節約)。
  const summary = JSON.stringify(
    {
      lead_summary: outline.lead_summary ?? null,
      narrative_arc: outline.narrative_arc ?? null,
      h2_chapters: Array.isArray(outline.h2_chapters)
        ? (outline.h2_chapters as Array<Record<string, unknown>>).map((c) => ({
            title: c?.title ?? null,
            summary: c?.summary ?? null,
            kishotenketsu_phase: c?.kishotenketsu_phase ?? null,
          }))
        : null,
      citation_highlights: outline.citation_highlights ?? null,
      faq_items: Array.isArray(outline.faq_items)
        ? (outline.faq_items as Array<Record<string, unknown>>)
            .slice(0, 3)
            .map((f) => ({ question: f?.question ?? null }))
        : null,
    },
    null,
    2,
  );

  return [
    '# Stage1 outline (要点抜粋)',
    summary,
    '',
    '# 出力スキーマ (JSON 厳守)',
    '{',
    '  "ki":    "起 50〜150 字 — テーマ提示・読者の現在地の言語化",',
    '  "sho":   "承 50〜150 字 — 起の深掘り・読者の感情への寄り添い",',
    '  "ten":   "転 50〜150 字 — 視点転換 (承と異なる方向の気づき)",',
    '  "ketsu": "結 50〜150 字 — 受容と小さな行動提案",',
    '  "ten_perspective_shift": "20〜120 字で承→転の視点角度がどう変わったかを自己説明"',
    '}',
    '',
    '# 制約',
    '- 各 phase は 50〜150 字。50 字未満 / 150 字超は絶対禁止',
    '- 転 (ten) は承 (sho) の言い換え・深掘りではなく、異なる視点を導入する',
    '- ten_perspective_shift を「視点を転換しました」のような抽象一般論で済ませない',
    '- 出力は JSON オブジェクトのみ。前後に説明文を付けない',
  ].join('\n');
}

// ─── ハンドラー ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();

  // 1. 認証チェック
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  // 2. リクエスト解析
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'リクエストボディが不正です。JSON 形式で article_id を指定してください。' },
      { status: 400 },
    );
  }

  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }
  const { article_id: articleId } = parsed.data;

  // 3. 記事取得 + outline 存在確認 (service-role で行内検索)
  const adminClient = await createServiceRoleClient();
  const { data: article, error: articleError } = await adminClient
    .from('articles')
    .select('id, stage1_outline, generation_mode')
    .eq('id', articleId)
    .maybeSingle();

  if (articleError) {
    logger.error(
      'api',
      'generate_kishotenketsu.fetch_failed',
      { articleId },
      articleError,
    );
    return NextResponse.json(
      { error: '記事の取得に失敗しました' },
      { status: 500 },
    );
  }
  if (!article) {
    return NextResponse.json(
      { error: '記事が見つかりません' },
      { status: 404 },
    );
  }

  const outline = article.stage1_outline as Record<string, unknown> | null;
  if (!outline || typeof outline !== 'object') {
    return NextResponse.json(
      {
        error:
          '構成案 (stage1_outline) が存在しないため起承転結を生成できません。先に Stage1 を実行してください。',
        code: 'STAGE1_OUTLINE_REQUIRED',
      },
      { status: 409 },
    );
  }

  // 4. Gemini 呼出
  let rawPlan: unknown;
  try {
    const userPrompt = buildKishotenketsuUserPrompt(outline as OutlineForPrompt);
    const result = await generateJson<unknown>(
      KISHOTENKETSU_SYSTEM_PROMPT,
      userPrompt,
      { temperature: 0.4, topP: 0.9, maxOutputTokens: 1024 },
    );
    rawPlan = result.data;
  } catch (err) {
    logger.error(
      'api',
      'generate_kishotenketsu.gemini_failed',
      { articleId },
      err,
    );
    return NextResponse.json(
      {
        error: 'AI による起承転結プランの生成に失敗しました。再試行してください。',
      },
      { status: 502 },
    );
  }

  // 5. schema 検証
  const validation = kishotenketsuSchema.safeParse(rawPlan);
  if (!validation.success) {
    logger.warn('api', 'generate_kishotenketsu.schema_invalid', {
      articleId,
      issues: validation.error.flatten(),
    });
    return NextResponse.json(
      {
        error: '生成された起承転結プランがスキーマに違反しています。再試行してください。',
        details: validation.error.flatten(),
      },
      { status: 502 },
    );
  }
  const plan = validation.data;

  // 6. DB 更新 — kishotenketsu UPDATE + approved_at クリア
  // 再生成扱いなので承認状態は必ず NULL に戻す (UI は「未承認」へ遷移)。
  const { error: updateError } = await adminClient
    .from('articles')
    .update({
      kishotenketsu: plan,
      kishotenketsu_approved_at: null,
      kishotenketsu_approved_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', articleId);

  if (updateError) {
    logger.error(
      'api',
      'generate_kishotenketsu.update_failed',
      { articleId },
      updateError,
    );
    return NextResponse.json(
      { error: '起承転結プランの保存に失敗しました' },
      { status: 500 },
    );
  }

  logger.info('api', 'generate_kishotenketsu.ok', {
    articleId,
    elapsed_ms: Date.now() - startedAt,
  });

  return NextResponse.json({
    success: true,
    article_id: articleId,
    kishotenketsu: plan,
    kishotenketsu_approved_at: null,
  });
}
