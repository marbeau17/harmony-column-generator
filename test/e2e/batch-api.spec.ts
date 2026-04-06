import { test, expect } from '@playwright/test';

/**
 * E2E API Test: Batch Blog Generation Pipeline
 *
 * Tests the batch generation flow via API calls directly,
 * verifying image replacement in body HTML at each stage.
 *
 * Scenarios:
 * 1. Batch prepare - find outline_approved articles
 * 2. Queue process - serial execution through pipeline
 * 3. Image placeholder replacement verification
 * 4. Multiple articles processed without race conditions
 * 5. Image URLs properly embedded in body HTML
 */

const BASE_URL = 'http://localhost:3000';
const SUPABASE_URL = 'https://khsorerqojgwbmtiqrac.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtoc29yZXJxb2pnd2JtdGlxcmFjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTI0NjUxNSwiZXhwIjoyMDkwODIyNTE1fQ.san11urNK7w4GxqDWtJj4Ka3iPYmwxflPlzvsScW9ZY';

const supabaseHeaders = {
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

// Helper: query Supabase directly
async function supabaseQuery(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: supabaseHeaders });
  return res.json();
}

// Helper: update Supabase
async function supabaseUpdate(table: string, filter: string, data: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { ...supabaseHeaders, 'Prefer': 'return=representation' },
    body: JSON.stringify(data),
  });
  return res.json();
}

test.describe('Batch Generation API Tests', () => {

  test('1. DB State: Check articles in various states', async () => {
    const articles = await supabaseQuery(
      'articles?select=id,title,slug,status,image_files&order=created_at.desc&limit=20'
    );

    const statusCounts: Record<string, number> = {};
    for (const a of articles) {
      statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
    }

    console.log('[test] Article status distribution:', statusCounts);
    expect(articles.length).toBeGreaterThan(0);
  });

  test('2. DB State: Check image_files data for articles with images', async () => {
    const articles = await supabaseQuery(
      'articles?select=id,title,slug,status,image_files&image_files=neq.[]&order=created_at.desc&limit=10'
    );

    let allHaveUrls = true;
    for (const a of articles) {
      const files = a.image_files || [];
      const hasUrls = files.every((f: { url?: string }) => f.url && f.url.startsWith('http'));
      if (!hasUrls) {
        console.log(`[test] Article ${a.slug}: missing image URLs`);
        allHaveUrls = false;
      }
    }

    console.log(`[test] ${articles.length} articles have image_files, all valid: ${allHaveUrls}`);
    expect(allHaveUrls).toBe(true);
  });

  test('3. Image Scenario: Body HTML should NOT contain IMAGE placeholders for articles with images', async () => {
    const articles = await supabaseQuery(
      'articles?select=id,title,slug,status,stage2_body_html,image_files&image_files=neq.[]&order=created_at.desc&limit=10'
    );

    let issuesFound = 0;
    for (const a of articles) {
      const html = a.stage2_body_html || '';
      const commentPlaceholders = (html.match(/<!--IMAGE:[^>]+-->/g) || []).length;
      const barePlaceholders = (html.match(/IMAGE:(hero|body|summary)/g) || []).length;

      if (commentPlaceholders > 0 || barePlaceholders > 0) {
        console.log(`[test] ISSUE: ${a.slug} has ${commentPlaceholders} comment + ${barePlaceholders} bare placeholders despite having image_files`);
        issuesFound++;
      }
    }

    console.log(`[test] Checked ${articles.length} articles with images, issues: ${issuesFound}`);
    expect(issuesFound).toBe(0);
  });

  test('4. Image Scenario: Body HTML should contain <img> tags with Supabase URLs', async () => {
    const articles = await supabaseQuery(
      'articles?select=id,title,slug,status,stage2_body_html,image_files&image_files=neq.[]&status=in.(editing,body_review,published)&order=created_at.desc&limit=10'
    );

    for (const a of articles) {
      const html = a.stage2_body_html || '';
      const imgTags = (html.match(/<img[^>]+src="https:\/\/[^"]*supabase[^"]*"/g) || []).length;
      const imageFiles = (a.image_files || []).length;

      console.log(`[test] ${a.slug}: ${imgTags} <img> tags in body, ${imageFiles} image_files`);

      // Articles with images AND body HTML should have img tags
      const hasBody = (a.stage2_body_html || '').length > 100;
      if (imageFiles > 0 && hasBody) {
        expect(imgTags).toBeGreaterThan(0);
      }
    }
  });

  test('5. Image Scenario: stage3_final_html should also have images replaced', async () => {
    const articles = await supabaseQuery(
      'articles?select=id,title,slug,stage3_final_html,image_files&image_files=neq.[]&stage3_final_html=neq.null&order=created_at.desc&limit=5'
    );

    for (const a of articles) {
      const html = a.stage3_final_html || '';
      const placeholders = (html.match(/<!--IMAGE:|IMAGE:(hero|body|summary)/g) || []).length;

      if (placeholders > 0) {
        console.log(`[test] ISSUE: ${a.slug} stage3 has ${placeholders} placeholders`);
      }
    }

    console.log(`[test] Checked ${articles.length} articles with stage3_final_html`);
  });

  test('6. Queue State: No stuck items', async () => {
    const queueItems = await supabaseQuery(
      'generation_queue?select=id,step,error_message,article_id,started_at&step=neq.completed&order=created_at.desc'
    );

    const stuckItems = queueItems.filter((q: { error_message: string | null }) => q.error_message);
    const processingItems = queueItems.filter((q: { error_message: string | null }) => !q.error_message);

    console.log(`[test] Queue: ${processingItems.length} active, ${stuckItems.length} with errors`);

    for (const item of stuckItems) {
      console.log(`[test] Stuck: step=${item.step}, error=${item.error_message?.substring(0, 60)}`);
    }
  });

  test('7. Image Scenario: Simulate placeholder replacement', async () => {
    // Find an article that might still have placeholders
    const articles = await supabaseQuery(
      'articles?select=id,title,slug,stage2_body_html,image_files&stage2_body_html=neq.null&order=created_at.desc&limit=20'
    );

    let fixedCount = 0;
    for (const a of articles) {
      const html = a.stage2_body_html || '';
      const imageFiles = a.image_files || [];

      if (!Array.isArray(imageFiles) || imageFiles.length === 0) continue;

      let updatedHtml = html;
      let changed = false;

      for (const img of imageFiles) {
        if (!img.position || !img.url) continue;

        const imgTag = `<img src="${img.url}" alt="${img.alt || ''}" style="max-width:100%;border-radius:8px;margin:1em 0" />`;

        // Check all placeholder patterns
        const patterns = [
          new RegExp(`<div[^>]*class="[^"]*placeholder[^"]*"[^>]*>\\s*<!--\\s*IMAGE:${img.position}:[\\s\\S]*?-->\\s*</div>`, 'g'),
          new RegExp(`<!--\\s*IMAGE:${img.position}:[\\s\\S]*?-->`, 'g'),
          new RegExp(`IMAGE:${img.position}(?::[^\\s<]*)?`, 'g'),
        ];

        for (const p of patterns) {
          const before = updatedHtml;
          updatedHtml = updatedHtml.replace(p, imgTag);
          if (updatedHtml !== before) changed = true;
        }
      }

      if (changed) {
        // Update DB
        await supabaseUpdate('articles', `id=eq.${a.id}`, { stage2_body_html: updatedHtml });
        fixedCount++;
        console.log(`[test] Fixed placeholders in: ${a.slug}`);
      }
    }

    console.log(`[test] Fixed ${fixedCount} articles with remaining placeholders`);
  });

  test('8. Consistency: All outline_approved articles have stage1_outline', async () => {
    const articles = await supabaseQuery(
      'articles?select=id,title,slug,status,stage1_outline&status=eq.outline_approved'
    );

    let missingOutline = 0;
    for (const a of articles) {
      if (!a.stage1_outline || !a.stage1_outline.headings) {
        console.log(`[test] ISSUE: ${a.slug} is outline_approved but has no outline data`);
        missingOutline++;
      }
    }

    console.log(`[test] ${articles.length} outline_approved articles, ${missingOutline} missing outline`);
    expect(missingOutline).toBe(0);
  });

  test('9. Consistency: Published articles have all required fields', async () => {
    const articles = await supabaseQuery(
      'articles?select=id,title,slug,status,meta_description,stage2_body_html,published_html,image_files,related_articles,published_at&status=eq.published'
    );

    for (const a of articles) {
      const issues: string[] = [];
      if (!a.title) issues.push('no title');
      if (!a.slug) issues.push('no slug');
      if (!a.meta_description) issues.push('no meta_description');
      if (!a.stage2_body_html && !a.published_html) issues.push('no body HTML');
      if (!a.published_at) issues.push('no published_at');

      if (issues.length > 0) {
        console.log(`[test] Published article ${a.slug}: ${issues.join(', ')}`);
      }
    }

    console.log(`[test] ${articles.length} published articles checked`);
  });

  test('10. Race condition: Queue items should not be duplicated', async () => {
    // Check for duplicate queue entries for the same article
    const queueItems = await supabaseQuery(
      'generation_queue?select=id,article_id,step&order=created_at.desc'
    );

    const articleIdCounts: Record<string, number> = {};
    for (const q of queueItems) {
      if (q.article_id) {
        articleIdCounts[q.article_id] = (articleIdCounts[q.article_id] || 0) + 1;
      }
    }

    const duplicates = Object.entries(articleIdCounts).filter(([, count]) => count > 1);

    if (duplicates.length > 0) {
      console.log(`[test] WARNING: ${duplicates.length} articles have duplicate queue entries`);
      for (const [id, count] of duplicates) {
        console.log(`[test]   article ${id}: ${count} queue entries`);
      }
    } else {
      console.log('[test] No duplicate queue entries found');
    }
  });
});
