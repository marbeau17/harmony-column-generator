// ============================================================================
// src/app/api/ai/quality-check/route.ts
// POST /api/ai/quality-check
// 品質チェックAPI（スピリチュアルコラム向け・Supabase使用）
//
// 記事の本文に対して以下の品質チェックを実行:
//   - 倫理チェック（医療アドバイス・宗教的断定・不安煽り表現の検出）
//   - 医療境界確認（「治る」「効果がある」等の断定表現検出）
//   - スピリチュアル用語の正確性チェック
//   - CTA / 画像プレースホルダーの整合性確認
//
// 結果をJSON返却（DB保存はオプション）
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateJson } from '@/lib/ai/gemini-client';
import { logger } from '@/lib/logger';

// ─── 品質チェック結果の型 ───────────────────────────────────────────────────

interface QualityIssue {
  type: 'medical_claim' | 'religious_assertion' | 'anxiety_inducing' | 'term_error' | 'structure_issue' | 'ethical_concern';
  severity: 'error' | 'warning' | 'info';
  location: string;
  description: string;
  suggestion: string;
}

interface QualityCheckResult {
  overall_score: number;
  passed: boolean;
  issues: QualityIssue[];
  summary: string;
}

// ─── プロンプト構築 ─────────────────────────────────────────────────────────

function buildQualityCheckSystemPrompt(): string {
  return `あなたはスピリチュアルコンテンツの品質管理エキスパートです。

## あなたの役割
以下の観点でスピリチュアルコラム記事の品質チェックを行い、問題点をJSON形式で報告してください。

## チェック項目

### 1. 医療境界チェック（最重要）
- 「○○が治る」「○○に効果がある」「○○で改善する」等の医療効果の断定は **error**
- 「医学的根拠」「科学的に証明」等の虚偽の権威づけは **error**
- 「○○と言われています」「○○と感じる方もいます」等の柔らかい表現は **OK**
- 薬機法・景表法に抵触しうる表現は **error**

### 2. 倫理チェック
- 宗教的断定（「○○が唯一の真理」「○○でないと救われない」）は **error**
- 過度な不安煽り（「このままでは不幸になる」「放置すると大変なことに」）は **error**
- 差別的表現・特定の宗教や信条の否定は **error**
- 金銭的誘導（「今すぐ買わないと」「限定○○名」）は **warning**

### 3. スピリチュアル用語チェック
- チャクラ名称の正確性（第1〜第7）
- エネルギーワーク用語の正しい使用
- 表記揺れ（カタカナ・英語の混在）
- 根拠なく特定の効能を謳っている場合は **warning**

### 4. 構造チェック
- CTA（<div class="harmony-cta">）が3箇所存在するか
- 画像プレースホルダー（<!--IMAGE:hero:-->, <!--IMAGE:body:-->, <!--IMAGE:summary:-->）が3箇所存在するか
- FAQ（<div class="harmony-faq">）が存在するか
- 見出し階層（H2 → H3）が正しいか

## 出力JSON スキーマ
{
  "overall_score": 85,  // 0-100 の品質スコア
  "passed": true,       // 80点以上かつ error が0件なら true
  "issues": [
    {
      "type": "medical_claim | religious_assertion | anxiety_inducing | term_error | structure_issue | ethical_concern",
      "severity": "error | warning | info",
      "location": "該当箇所のテキスト（前後20文字程度）",
      "description": "問題の説明",
      "suggestion": "修正案"
    }
  ],
  "summary": "全体的な品質評価のサマリー（100文字程度）"
}

## 注意
- issue が1件もない場合は issues を空配列で返す
- error レベルの問題がある場合は passed を false にする
- overall_score は error:-15点, warning:-5点, info:-1点 として 100点から減点する（最低0点）
- レスポンスは JSON のみ（前後の説明文は不要）`;
}

function buildQualityCheckUserPrompt(bodyHtml: string, keyword: string): string {
  return `以下のスピリチュアルコラム記事の品質チェックを行ってください。

## メインキーワード
${keyword}

## チェック対象の記事本文
${bodyHtml}

上記の記事について、品質チェック結果をJSON形式で出力してください。`;
}

// ─── ハンドラー ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. 認証チェック
  const supabase = createServerSupabaseClient();
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

  const { articleId, saveResult } = body as { articleId?: string; saveResult?: boolean };
  if (!articleId) {
    return NextResponse.json({ error: 'articleId は必須です' }, { status: 400 });
  }

  // 3. 記事を取得
  const { data: article, error: articleError } = await supabase
    .from('articles')
    .select('*')
    .eq('id', articleId)
    .single();

  if (articleError || !article) {
    return NextResponse.json({ error: '記事が見つかりません' }, { status: 404 });
  }

  // チェック対象テキストの取得
  const bodyHtml = (article.stage2_body_html || article.stage3_final_html) as string | null;
  if (!bodyHtml) {
    return NextResponse.json(
      { error: '品質チェック対象の本文がありません。先に本文生成を完了してください。' },
      { status: 400 },
    );
  }

  // 4. Gemini で品質チェック実行
  try {
    const systemPrompt = buildQualityCheckSystemPrompt();
    const userPrompt = buildQualityCheckUserPrompt(bodyHtml, article.keyword || '');

    const { data: result, response } = await generateJson<QualityCheckResult>(
      systemPrompt,
      userPrompt,
      {
        temperature: 0.2,
        maxOutputTokens: 4096,
        timeoutMs: 60_000,
      },
    );

    // 結果のサニタイズ
    const qualityResult: QualityCheckResult = {
      overall_score: result.overall_score ?? 0,
      passed: result.passed ?? false,
      issues: Array.isArray(result.issues) ? result.issues : [],
      summary: result.summary ?? '品質チェックが完了しました。',
    };

    // error 件数による passed 判定の補正
    const errorCount = qualityResult.issues.filter((i) => i.severity === 'error').length;
    if (errorCount > 0) {
      qualityResult.passed = false;
    }

    logger.info('ai', 'quality_check_complete', {
      articleId,
      overallScore: qualityResult.overall_score,
      passed: qualityResult.passed,
      issuesCount: qualityResult.issues.length,
      errorCount,
      warningCount: qualityResult.issues.filter((i) => i.severity === 'warning').length,
      tokenUsage: response.tokenUsage,
    });

    // 5. オプション: 結果を DB に保存
    if (saveResult) {
      let currentLog: Record<string, unknown> = {};
      if (article.ai_generation_log) {
        try {
          currentLog =
            typeof article.ai_generation_log === 'object'
              ? (article.ai_generation_log as Record<string, unknown>)
              : JSON.parse(article.ai_generation_log as string);
        } catch {
          currentLog = { _raw: article.ai_generation_log };
        }
      }

      const newLog = {
        ...currentLog,
        quality_check_at: new Date().toISOString(),
        quality_check_score: qualityResult.overall_score,
        quality_check_passed: qualityResult.passed,
        quality_check_issues_count: qualityResult.issues.length,
        quality_check_token_usage: response.tokenUsage,
      };

      await supabase
        .from('articles')
        .update({
          seo_score: qualityResult,
          ai_generation_log: JSON.stringify(newLog),
          updated_at: new Date().toISOString(),
        })
        .eq('id', articleId);
    }

    // 6. レスポンス返却
    return NextResponse.json({
      success: true,
      qualityCheck: qualityResult,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error('ai', 'quality_check_failed', { articleId, error: errMsg });
    return NextResponse.json(
      { error: `品質チェックに失敗しました: ${errMsg}` },
      { status: 500 },
    );
  }
}
