/**
 * FAIL判定の17記事を新プロンプトで再生成するスクリプト
 * 既存のoutlineを使い、stage2(writing)のみ再実行
 * Usage: npx tsx scripts/regenerate-failed-articles.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const envContent = fs.readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const FAILED_SLUGS = [
  'chakra-purify-by-yourself',
  'easy-way-to-find-soul-mission',
  'empath-boundaries-healing',
  'grief-spiritual-healing',
  'life-stage-change-signs',
  'life-stage-signs-love-tears',
  'lightworker-awakening-signs',
  'lightworker-awakening-signs-2',
  'messages-signs-from-deceased',
  'release-romantic-attachment',
  'room-cleansing-without-salt',
  'soul-mission-anxiety-love',
  'soul-mission-anxiety-love-2',
  'spiritual-healing-pet-loss',
  'spiritual-self-acceptance-love',
  'spiritual-tired-leave-nature',
  'stage-change-signs-love',
];

async function main() {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const { buildWritingSystemPrompt, buildWritingUserPrompt } = await import('../src/lib/ai/prompts/stage2-writing');
  const { runQualityChecklist } = await import('../src/lib/content/quality-checklist');
  const { insertCtasIntoHtml, selectCtaTexts } = await import('../src/lib/content/cta-generator');
  const { insertTocIntoHtml } = await import('../src/lib/content/toc-generator');

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-20' });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Get source articles content for reference
  const getSourceContent = async (sourceId: string): Promise<string> => {
    if (!sourceId) return '';
    const { data } = await sb.from('source_articles').select('content').eq('id', sourceId).single();
    return data?.content?.substring(0, 2000) || '';
  };

  let successCount = 0;
  let failCount = 0;

  for (const slug of FAILED_SLUGS) {
    console.log(`\n=== ${slug} ===`);

    // 1. Get article data
    const { data: article } = await sb
      .from('articles')
      .select('*')
      .eq('slug', slug)
      .single();

    if (!article) {
      console.log('  ❌ Article not found');
      failCount++;
      continue;
    }

    // 2. Get source content
    const sourceContent = await getSourceContent(article.source_article_id);

    // 3. Build outline from existing data
    const outline = typeof article.stage1_outline === 'string'
      ? JSON.parse(article.stage1_outline)
      : article.stage1_outline;

    if (!outline) {
      console.log('  ❌ No outline found');
      failCount++;
      continue;
    }

    // 4. Build prompts using NEW prompt system
    const input = {
      articleId: article.id,
      keyword: article.keyword || '',
      theme: article.theme || 'daily',
      targetPersona: article.persona || '30代〜50代女性',
      perspectiveType: article.perspective_type || 'empathy_reframe',
      targetWordCount: article.target_word_count || 2000,
      outline,
      sourceArticleContent: sourceContent,
    };

    const systemPrompt = buildWritingSystemPrompt(input as any);
    const userPrompt = buildWritingUserPrompt(input as any);

    // 5. Generate with Gemini
    console.log('  Generating...');
    try {
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
      });

      let bodyHtml = result.response.text();
      console.log(`  Generated ${bodyHtml.length} chars`);

      // 6. Post-process: insert TOC
      bodyHtml = insertTocIntoHtml(bodyHtml);

      // 7. Post-process: insert CTAs
      const themeMap: Record<string, string> = { daily_awareness: 'daily', spiritual_intro: 'introduction' };
      const ctaTheme = themeMap[article.theme] ?? article.theme;
      const ctaTexts = selectCtaTexts(ctaTheme, article.id);
      bodyHtml = insertCtasIntoHtml(bodyHtml, ctaTexts, slug);

      // 8. Quality check
      const qc = runQualityChecklist({
        title: article.title || '',
        html: bodyHtml,
        keyword: article.keyword || '',
        metaDescription: article.meta_description || '',
        theme: article.theme || '',
      });

      console.log(`  Score: ${qc.score}, Errors: ${qc.errorCount}, Warnings: ${qc.warningCount}`);

      if (!qc.passed) {
        const errors = qc.items.filter(i => i.status === 'fail' && i.severity === 'error');
        console.log(`  ⚠️ QC FAIL: ${errors.map(e => e.id).join(', ')}`);
      }

      // 9. Update DB regardless (new content is better than old)
      const { error: updateError } = await sb
        .from('articles')
        .update({ stage2_body_html: bodyHtml, stage3_final_html: null })
        .eq('id', article.id);

      if (updateError) {
        console.log(`  ❌ DB update failed: ${updateError.message}`);
        failCount++;
        continue;
      }

      console.log(`  ✅ ${slug}: regenerated (score=${qc.score}, passed=${qc.passed})`);
      successCount++;

      // Rate limit: wait 2s between API calls
      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      console.log(`  ❌ Generation failed: ${err}`);
      failCount++;
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Success: ${successCount}/${FAILED_SLUGS.length}`);
  console.log(`Failed: ${failCount}/${FAILED_SLUGS.length}`);
}

main().catch(console.error);
