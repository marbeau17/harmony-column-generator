// =============================================================================
// POST /api/articles/batch-add-highlights
// 全記事にハイライトマーカー（蛍光ペン風）を一括適用する
// Gemini API を使って重要箇所を特定し、marker-yellow / marker-pink を付与
// =============================================================================

import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { generateText } from '@/lib/ai/gemini-client';

export const maxDuration = 300;

// ─── ハイライト指示プロンプト ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `あなたはHTML記事のハイライト編集者です。
与えられたHTML記事本文を分析し、特に重要な箇所にハイライトマーカーを付与してください。

## ルール
1. 以下の2種類のマーカーを使用する:
   - <span class="marker-yellow">テキスト</span>: 核心的な教え、読者の心に響く重要メッセージ
   - <span class="marker-pink">テキスト</span>: 読者への問いかけ、行動提案
2. 1記事あたり3〜5箇所のみ（厳守）
3. H2/H3見出しタグの中にはハイライトを適用しない
4. ハイライトは文単位または短いフレーズ単位で適用する（段落全体に適用しない）
5. 既にハイライトが適用されている箇所（marker-yellow, marker-pink）はそのまま維持する
6. HTML構造を壊さないこと。タグの開閉を正しく保つこと
7. ハイライト以外のHTML内容は一切変更しないこと

## 出力
修正後のHTML全文をそのまま出力してください。説明や前置きは不要です。`;

function buildUserPrompt(html: string): string {
  return `以下のHTML記事本文に、ルールに従ってハイライトマーカーを追加してください。

---
${html}
---

上記HTMLにハイライトを追加した結果を出力してください。`;
}

// ─── メインハンドラ ─────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    // 1. 認証チェック
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    // バッチサイズ（デフォルト5件ずつ処理してタイムアウトを回避）
    const { searchParams } = new URL(request.url);
    const batchSize = Math.min(
      Math.max(parseInt(searchParams.get('limit') || '5', 10) || 5, 1),
      20, // 最大20件まで
    );

    const serviceClient = await createServiceRoleClient();

    // 2. ハイライト未適用の記事だけを取得（バッチサイズ分のみ）
    //    stage2_body_html にハイライトが未適用のものを優先取得
    const { data: articles, error: fetchError } = await serviceClient
      .from('articles')
      .select('id, stage2_body_html, stage3_final_html')
      .or('stage2_body_html.not.is.null,stage3_final_html.not.is.null');

    if (fetchError) {
      return NextResponse.json(
        { error: `記事の取得に失敗: ${fetchError.message}` },
        { status: 500 },
      );
    }

    if (!articles || articles.length === 0) {
      return NextResponse.json({ message: '対象の記事がありません', updated: 0, remaining: 0 });
    }

    // ハイライト未適用の記事だけをフィルタ
    const needsHighlight = articles.filter((a) => {
      const s2 = a.stage2_body_html as string | null;
      const s3 = a.stage3_final_html as string | null;
      const s2Done = !s2 || s2.includes('marker-yellow') || s2.includes('marker-pink');
      const s3Done = !s3 || s3.includes('marker-yellow') || s3.includes('marker-pink');
      return !(s2Done && s3Done);
    });

    if (needsHighlight.length === 0) {
      return NextResponse.json({
        success: true,
        message: '全記事のハイライト適用が完了しています',
        updated: 0,
        remaining: 0,
        total: articles.length,
      });
    }

    // バッチサイズ分だけ処理
    const batch = needsHighlight.slice(0, batchSize);

    // 3. 各記事にハイライトを適用
    let updated = 0;
    const errors: string[] = [];

    for (const article of batch) {
      try {
        const updateFields: Record<string, string> = {};

        // stage2_body_html を処理
        if (article.stage2_body_html) {
          const html = article.stage2_body_html as string;
          if (!html.includes('marker-yellow') && !html.includes('marker-pink')) {
            const result = await generateText(SYSTEM_PROMPT, buildUserPrompt(html), {
              temperature: 0.3,
              maxOutputTokens: 16000,
            });

            if (result.text && result.text.trim().length > 0) {
              let cleanedHtml = result.text.trim();
              cleanedHtml = cleanedHtml.replace(/^```html?\s*/i, '').replace(/\s*```$/i, '');
              updateFields.stage2_body_html = cleanedHtml;
            }
          }
        }

        // stage3_final_html も同様に処理
        if (article.stage3_final_html) {
          const html = article.stage3_final_html as string;
          if (!html.includes('marker-yellow') && !html.includes('marker-pink')) {
            const result = await generateText(SYSTEM_PROMPT, buildUserPrompt(html), {
              temperature: 0.3,
              maxOutputTokens: 16000,
            });

            if (result.text && result.text.trim().length > 0) {
              let cleanedHtml = result.text.trim();
              cleanedHtml = cleanedHtml.replace(/^```html?\s*/i, '').replace(/\s*```$/i, '');
              updateFields.stage3_final_html = cleanedHtml;
            }
          }
        }

        if (Object.keys(updateFields).length === 0) {
          continue;
        }

        const { error: updateError } = await serviceClient
          .from('articles')
          .update({
            ...updateFields,
            updated_at: new Date().toISOString(),
          })
          .eq('id', article.id);

        if (updateError) {
          errors.push(`${article.id}: ${updateError.message}`);
        } else {
          updated++;
        }
      } catch (err) {
        errors.push(`${article.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const remaining = needsHighlight.length - batch.length;

    return NextResponse.json({
      success: true,
      updated,
      processed: batch.length,
      remaining,
      total: articles.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `ハイライト一括適用に失敗: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}
