// =============================================================================
// POST /api/articles/batch-update-cta
// 全記事の CTA ブロックを最新の CTA 設定で一括更新する
// =============================================================================

import { NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import * as cheerio from 'cheerio';
import { buildCtaHtml, type CtaConfig } from '@/lib/content/cta-generator';

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

    // 2. settings テーブルから CTA 設定を取得
    const { data: ctaSetting } = await serviceClient
      .from('settings')
      .select('value')
      .eq('key', 'cta')
      .single();

    if (!ctaSetting?.value) {
      return NextResponse.json(
        { error: 'CTA設定が見つかりません。先に設定ページでCTAを設定してください。' },
        { status: 404 },
      );
    }

    const ctaSettings = ctaSetting.value as Record<string, CtaConfig>;

    // 3. 本文がある全記事を取得
    const { data: articles, error: fetchError } = await serviceClient
      .from('articles')
      .select('id, slug, theme, stage2_body_html, stage3_final_html')
      .or('stage2_body_html.not.is.null,stage3_final_html.not.is.null');

    if (fetchError) {
      return NextResponse.json(
        { error: `記事の取得に失敗: ${fetchError.message}` },
        { status: 500 },
      );
    }

    if (!articles || articles.length === 0) {
      return NextResponse.json({ message: '更新対象の記事がありません', updated: 0 });
    }

    // 4. 各記事の CTA ブロックを更新
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const article of articles) {
      try {
        const slug = (article.slug as string) || 'unknown';
        const updateFields: Record<string, string> = {};

        // stage2_body_html を処理
        if (article.stage2_body_html) {
          const result = replaceCtas(
            article.stage2_body_html as string,
            slug,
            ctaSettings,
          );
          if (result.changed) {
            updateFields.stage2_body_html = result.html;
          }
        }

        // stage3_final_html を処理
        if (article.stage3_final_html) {
          const result = replaceCtas(
            article.stage3_final_html as string,
            slug,
            ctaSettings,
          );
          if (result.changed) {
            updateFields.stage3_final_html = result.html;
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
      { error: `CTA一括更新に失敗: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}

// ─── CTA 置換ロジック ───────────────────────────────────────────────────────

function replaceCtas(
  html: string,
  slug: string,
  ctaSettings: Record<string, CtaConfig>,
): { html: string; changed: boolean } {
  const $ = cheerio.load(html);
  const ctaBlocks = $('.harmony-cta');

  if (ctaBlocks.length === 0) {
    return { html, changed: false };
  }

  let changed = false;

  // data-cta-keyがない古い記事は位置（出現順）で推定
  const keyMap: ('cta1' | 'cta2' | 'cta3')[] = ['cta1', 'cta2', 'cta3'];
  const posMap: ('intro' | 'mid' | 'end')[] = ['intro', 'mid', 'end'];

  ctaBlocks.each((idx, el) => {
    const $el = $(el);
    const ctaKey = ($el.attr('data-cta-key') as 'cta1' | 'cta2' | 'cta3') || keyMap[idx] || 'cta1';
    const position = ($el.attr('data-cta-position') as 'intro' | 'mid' | 'end') || posMap[idx] || 'intro';

    const config = ctaSettings[ctaKey];
    if (!config) return;

    const existingCatch = $el.find('.harmony-cta-catch').text().trim();
    const existingSub = $el.find('.harmony-cta-sub').text().trim();

    const catchText = (config as CtaConfig & { catchText?: string }).catchText || existingCatch || 'スピリチュアルカウンセリングのご案内';
    const subText = (config as CtaConfig & { subText?: string }).subText || existingSub || 'あなたの心に寄り添います';

    const newHtml = buildCtaHtml(ctaKey, position, catchText, subText, slug, config);
    $el.replaceWith(newHtml);
    changed = true;
  });

  return { html: $('body').html() ?? html, changed };
}
