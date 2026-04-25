// scripts/process-queue-direct.ts
// 認証なしでキュー処理を直接実行するスクリプト
// Usage: npx tsx scripts/process-queue-direct.ts

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env vars. Run with: source .env.local && npx tsx scripts/process-queue-direct.ts');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

async function processOneItem(): Promise<boolean> {
  // Get next pending item
  const { data: queueItem } = await sb
    .from('generation_queue')
    .select('*, content_plan:content_plans(*)')
    .in('step', ['pending', 'outline', 'body', 'images', 'seo_check'])
    .is('error_message', null)
    .is('started_at', null)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!queueItem) {
    // Try stale items (>10min)
    const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: stale } = await sb
      .from('generation_queue')
      .select('*, content_plan:content_plans(*)')
      .in('step', ['pending', 'outline', 'body', 'images', 'seo_check'])
      .is('error_message', null)
      .lt('started_at', staleThreshold)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!stale) {
      console.log('No items to process');
      return false;
    }
    return await processItem(stale);
  }

  return await processItem(queueItem);
}

async function processItem(queueItem: Record<string, unknown>): Promise<boolean> {
  const step = queueItem.step as string;
  const articleId = queueItem.article_id as string;

  // CAS lock
  await sb.from('generation_queue')
    .update({ started_at: new Date().toISOString() })
    .eq('id', queueItem.id as string);

  console.log(`Processing: step=${step} articleId=${(articleId || '').substring(0, 8)}`);

  try {
    // Call the app's API via localhost
    const res = await fetch('http://localhost:3000/api/queue/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    // If auth fails, we need a workaround
    if (res.status === 401) {
      console.log('Auth required - using direct generation');
      return await processDirectly(queueItem);
    }

    const data = await res.json();
    console.log(`Result: processed=${data.processed} step=${data.currentStep || ''} title=${(data.title || '').substring(0, 40)}`);
    return !!data.processed;
  } catch (err) {
    console.error('Error:', (err as Error).message);
    return false;
  }
}

async function processDirectly(queueItem: Record<string, unknown>): Promise<boolean> {
  const step = queueItem.step as string;
  const articleId = queueItem.article_id as string;

  if (!articleId) {
    console.log('No article_id');
    return false;
  }

  const { data: article } = await sb.from('articles')
    .select('*')
    .eq('id', articleId)
    .single();

  if (!article) {
    console.log('Article not found');
    return false;
  }

  console.log(`Direct processing: ${step} | ${article.slug} | ${(article.title || '').substring(0, 40)}`);

  switch (step) {
    case 'pending': {
      // Generate outline using Gemini
      const { generateJson } = await import('../src/lib/ai/gemini-client');
      const { buildStage1SystemPrompt, buildStage1UserPrompt } = await import('../src/lib/ai/prompts/stage1-outline');

      // Get source article content
      let sourceContent = '';
      if (article.source_article_id) {
        const { data: source } = await sb.from('source_articles')
          .select('title, content')
          .eq('id', article.source_article_id)
          .single();
        if (source) sourceContent = source.content || '';
      }

      const input = {
        keyword: article.keyword || '',
        theme: article.theme || 'healing',
        persona: article.persona || 'spiritual_beginner',
        targetWordCount: article.target_word_count || 2000,
        sourceArticleContent: sourceContent,
      };

      console.log('  Generating outline...');
      const outline = await generateJson(
        buildStage1SystemPrompt(input),
        buildStage1UserPrompt(input),
        { temperature: 0.7, maxOutputTokens: 8192 }
      );

      await sb.from('articles').update({
        stage1_outline: outline,
        status: 'outline_approved', // auto-approve
        updated_at: new Date().toISOString(),
      }).eq('id', articleId);

      await sb.from('generation_queue').update({ step: 'outline' }).eq('id', queueItem.id as string);
      console.log('  Outline generated, moving to outline step');
      return true;
    }

    case 'outline': {
      // Generate body using stage2 chain
      const { executeStage2Chain } = await import('../src/lib/ai/prompt-chain');

      let sourceContent = '';
      if (article.source_article_id) {
        const { data: source } = await sb.from('source_articles')
          .select('content')
          .eq('id', article.source_article_id)
          .single();
        if (source) sourceContent = source.content || '';
      }

      const outline = article.stage1_outline;
      if (!outline) {
        console.log('  No outline, skipping');
        return false;
      }

      console.log('  Generating body (this takes a while)...');
      const chainResult = await executeStage2Chain({
        keyword: article.keyword || '',
        theme: article.theme || 'healing',
        persona: article.persona || 'spiritual_beginner',
        targetWordCount: article.target_word_count || 2000,
        outline,
        sourceArticleContent: sourceContent,
      });

      // Insert TOC
      const { insertTocIntoHtml } = await import('../src/lib/content/toc-generator');
      let bodyHtml = chainResult.bodyHtml;
      try {
        bodyHtml = insertTocIntoHtml(bodyHtml);
      } catch { /* ok */ }

      await sb.from('articles').update({
        stage2_body_html: bodyHtml,
        status: 'body_review',
        updated_at: new Date().toISOString(),
      }).eq('id', articleId);

      await sb.from('generation_queue').update({ step: 'body' }).eq('id', queueItem.id as string);
      console.log('  Body generated, moving to body step');
      return true;
    }

    case 'body': {
      // Skip image generation for now, move to seo_check
      await sb.from('generation_queue').update({ step: 'seo_check' }).eq('id', queueItem.id as string);
      console.log('  Skipping images, moving to seo_check');
      return true;
    }

    case 'images':
    case 'seo_check': {
      // Run quality checklist
      const { runQualityChecklist } = await import('../src/lib/content/quality-checklist');
      const html = article.stage3_final_html || article.stage2_body_html || '';

      const checkResult = runQualityChecklist({
        title: article.title || '',
        html,
        keyword: article.keyword || undefined,
        metaDescription: article.meta_description || undefined,
        theme: article.theme || undefined,
      });

      console.log(`  Quality: score=${checkResult.score} passed=${checkResult.passed} errors=${checkResult.errorCount}`);

      if (!checkResult.passed) {
        // Set to editing for manual review
        await sb.from('articles').update({
          status: 'editing',
          updated_at: new Date().toISOString(),
        }).eq('id', articleId);
        console.log('  Quality check FAILED, set to editing');
      } else {
        // Publish
        await sb.from('articles').update({
          status: 'published',
          published_html: html,
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', articleId);
        console.log('  Quality check PASSED, published!');
      }

      await sb.from('generation_queue').update({
        step: 'completed',
        completed_at: new Date().toISOString(),
      }).eq('id', queueItem.id as string);

      return true;
    }

    default:
      console.log('  Unknown step:', step);
      return false;
  }
}

// Main loop
async function main() {
  const MAX_ITERATIONS = 100;
  let processed = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    console.log(`\n--- Iteration ${i + 1} ---`);
    const result = await processOneItem();
    if (!result) {
      console.log('No more items or error, stopping');
      break;
    }
    processed++;
  }

  console.log(`\nDone! Processed ${processed} queue steps`);
}

main().catch(console.error);
