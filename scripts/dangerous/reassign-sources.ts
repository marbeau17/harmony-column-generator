/**
 * 「愛の涙」に紐づいた24記事に、テーマに合った異なるソース記事を再割り当て
 * 各記事に1つのユニークなソースを割り当て、重複なし
 * Usage: npx tsx scripts/reassign-sources.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const envContent = fs.readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const PROBLEM_SOURCE_ID = 'f05a9477-85f9-4b43-be72-3b251c37be43';

// Theme mapping for best-fit source selection
const THEME_PRIORITY: Record<string, string[]> = {
  healing: ['healing', 'self_growth', 'daily'],
  daily_awareness: ['daily', 'healing', 'self_growth'],
  soul_mission: ['soul_mission', 'self_growth', 'daily'],
  relationships: ['relationships', 'daily', 'self_growth'],
  grief_care: ['grief_care', 'healing', 'relationships'],
  self_growth: ['self_growth', 'daily', 'healing'],
  spiritual_intro: ['introduction', 'daily', 'healing'],
};

async function main() {
  // 1. Get problem articles
  const { data: problemArticles } = await sb
    .from('articles')
    .select('id, slug, title, keyword, theme')
    .eq('source_article_id', PROBLEM_SOURCE_ID)
    .eq('status', 'published')
    .order('slug');

  if (!problemArticles || problemArticles.length === 0) {
    console.log('No problem articles found.');
    return;
  }

  // 2. Get ALL already-used source IDs (to exclude)
  const { data: allArticles } = await sb
    .from('articles')
    .select('source_article_id')
    .eq('status', 'published')
    .not('source_article_id', 'is', null)
    .neq('source_article_id', PROBLEM_SOURCE_ID);

  const usedIds = new Set((allArticles || []).map(a => a.source_article_id));

  // 3. Get all available source articles (unused)
  const { data: allSources } = await sb
    .from('source_articles')
    .select('id, title, theme_category, content')
    .order('id');

  const availableSources = (allSources || []).filter(s => !usedIds.has(s.id) && s.id !== PROBLEM_SOURCE_ID);
  console.log(`Available unused sources: ${availableSources.length}\n`);

  // Group available sources by theme
  const sourcesByTheme: Record<string, typeof availableSources> = {};
  for (const s of availableSources) {
    const t = s.theme_category || 'unknown';
    if (!sourcesByTheme[t]) sourcesByTheme[t] = [];
    sourcesByTheme[t].push(s);
  }

  // 4. Assign unique sources to each article
  const assigned = new Set<string>();
  const assignments: { articleId: string; slug: string; newSourceId: string; sourceTitle: string }[] = [];

  for (const article of problemArticles) {
    const themes = THEME_PRIORITY[article.theme] || ['daily', 'healing', 'self_growth'];
    let foundSource = null;

    // Try to find a source matching the article's keyword
    for (const theme of themes) {
      const candidates = (sourcesByTheme[theme] || []).filter(s => !assigned.has(s.id));

      // Keyword matching (try to find content-relevant source)
      const keyword = (article.keyword || '').split(' ')[0];
      if (keyword) {
        foundSource = candidates.find(s =>
          (s.content || '').includes(keyword) || (s.title || '').includes(keyword)
        );
      }

      // If no keyword match, take first available from theme
      if (!foundSource && candidates.length > 0) {
        foundSource = candidates[0];
      }

      if (foundSource) break;
    }

    // Fallback: any available source
    if (!foundSource) {
      foundSource = availableSources.find(s => !assigned.has(s.id));
    }

    if (!foundSource) {
      console.log(`❌ ${article.slug}: NO SOURCE AVAILABLE`);
      continue;
    }

    assigned.add(foundSource.id);
    assignments.push({
      articleId: article.id,
      slug: article.slug,
      newSourceId: foundSource.id,
      sourceTitle: (foundSource.title || '').substring(0, 40),
    });
  }

  // 5. Apply all assignments
  console.log('=== ASSIGNMENTS ===\n');
  for (const a of assignments) {
    const { error } = await sb
      .from('articles')
      .update({ source_article_id: a.newSourceId })
      .eq('id', a.articleId);

    if (error) {
      console.log(`❌ ${a.slug}: UPDATE FAILED - ${error.message}`);
    } else {
      console.log(`✅ ${a.slug} → ${a.sourceTitle}`);
    }
  }

  // 6. Verify no duplicates
  console.log('\n=== VERIFICATION ===');
  const { data: verify } = await sb
    .from('articles')
    .select('source_article_id')
    .eq('status', 'published')
    .not('source_article_id', 'is', null);

  const countMap: Record<string, number> = {};
  for (const v of (verify || [])) {
    countMap[v.source_article_id] = (countMap[v.source_article_id] || 0) + 1;
  }
  const duplicates = Object.entries(countMap).filter(([, c]) => c > 1);
  if (duplicates.length === 0) {
    console.log('✅ NO DUPLICATE SOURCES - All articles have unique source references');
  } else {
    console.log(`❌ ${duplicates.length} DUPLICATE SOURCES REMAIN`);
    for (const [id, count] of duplicates) {
      console.log(`  Source ${id}: ${count} articles`);
    }
  }

  console.log(`\nTotal reassigned: ${assignments.length}/${problemArticles.length}`);
}

main().catch(console.error);
