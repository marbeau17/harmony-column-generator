// =============================================================================
// POST /api/articles/batch-add-toc
// 全記事に TOC（目次）を一括挿入する
// =============================================================================

import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { insertTocIntoHtml } from '@/lib/content/toc-generator';

export const maxDuration = 120;

export async function POST() {
  try {
    // 1. 認証チェック
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    const serviceClient = await createServiceRoleClient();

    // 2. 本文がある全記事を取得
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
      return NextResponse.json({ message: '対象の記事がありません', updated: 0 });
    }

    // 3. 各記事に TOC を挿入
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const article of articles) {
      try {
        const updateFields: Record<string, string> = {};

        // stage2_body_html を処理
        if (article.stage2_body_html) {
          const html = article.stage2_body_html as string;
          // 既に TOC がある記事はスキップ
          if (html.includes('article-toc')) {
            // stage3 もチェック
            if (article.stage3_final_html) {
              const finalHtml = article.stage3_final_html as string;
              if (!finalHtml.includes('article-toc')) {
                const result = insertTocIntoHtml(finalHtml);
                if (result !== finalHtml) {
                  updateFields.stage3_final_html = result;
                }
              }
            }
            if (Object.keys(updateFields).length === 0) {
              skipped++;
              continue;
            }
          } else {
            const result = insertTocIntoHtml(html);
            if (result !== html) {
              updateFields.stage2_body_html = result;
            }
          }
        }

        // stage3_final_html を処理（stage2 で既にスキップ判定済みでない場合）
        if (article.stage3_final_html && !updateFields.stage3_final_html) {
          const html = article.stage3_final_html as string;
          if (!html.includes('article-toc')) {
            const result = insertTocIntoHtml(html);
            if (result !== html) {
              updateFields.stage3_final_html = result;
            }
          }
        }

        if (Object.keys(updateFields).length === 0) {
          skipped++;
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

    return NextResponse.json({
      success: true,
      updated,
      skipped,
      total: articles.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `TOC一括挿入に失敗: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}
