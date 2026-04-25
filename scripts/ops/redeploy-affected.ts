/**
 * 壊れたHTML（エスケープ・br混入）を持つ記事を再生成するスクリプト
 * Usage: npx tsx scripts/redeploy-affected.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load .env.local manually
const envContent = fs.readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const AFFECTED_SLUGS = [
  'spiritual-beginner-books-recommend',
  'easy-way-to-find-soul-mission-2',
  'gratitude-journal-effects',
  'self-reiki-guide-beginners',
  'soul-mission-anxiety',
];

/** AI生成HTMLの修復処理（article-html-generator.ts と同じロジック） */
function sanitizeAiHtml(html: string): string {
  // 1. \&quot; エスケープ修復
  html = html.replace(/="\\&quot;/g, '="').replace(/\\&quot;"/g, '"');
  html = html.replace(/="\\"/g, '="').replace(/\\""/g, '"');
  // 2. TOC/CTA内の不要<br>除去
  html = html.replace(/<br\s*\/?>\s*(<\/?(?:nav|details|summary|ol|li|div|a|p)\b)/gi, '$1');
  html = html.replace(/(<\/?(?:nav|details|summary|ol|li|div|a|p)[^>]*>)\s*<br\s*\/?>/gi, '$1');
  // 3. AI直接生成の壊れCTA除去
  html = html.replace(/<div class="harmony-cta">\s*<p class="harmony-cta-catch">[\s\S]*?<\/a>\s*<\/div>/gi, '');
  // 4. <p>内ブロック要素修復
  html = html.replace(/<p>\s*(<div\s)/gi, '$1');
  html = html.replace(/(<\/div>)\s*<\/p>/gi, '$1');
  return html;
}

async function main() {
  console.log('Fetching affected articles from DB...');

  for (const slug of AFFECTED_SLUGS) {
    const { data, error } = await supabase
      .from('articles')
      .select('id, slug, stage2_body_html, stage3_final_html')
      .eq('slug', slug)
      .single();

    if (error || !data) {
      console.log(`⏭️  ${slug}: not found in DB, skipping`);
      continue;
    }

    const bodyField = data.stage3_final_html ? 'stage3_final_html' : 'stage2_body_html';
    const originalHtml = (data as Record<string, string>)[bodyField] || '';

    // Check issues before
    const hasBroken = originalHtml.includes('\\&quot;') || originalHtml.includes('\\"') ||
      /article-toc.*<br/s.test(originalHtml) ||
      /class="harmony-cta">\s*<p class="harmony-cta-catch"/.test(originalHtml);

    if (!hasBroken) {
      console.log(`✓  ${slug}: DB HTML is clean, no fix needed`);
      continue;
    }

    const fixedHtml = sanitizeAiHtml(originalHtml);

    // Update DB
    const { error: updateError } = await supabase
      .from('articles')
      .update({ [bodyField]: fixedHtml })
      .eq('id', data.id);

    if (updateError) {
      console.log(`❌ ${slug}: DB update failed - ${updateError.message}`);
      continue;
    }

    // Also fix the local out/ file if it exists
    const outFile = path.join('out/column', slug, 'index.html');
    if (fs.existsSync(outFile)) {
      const outHtml = fs.readFileSync(outFile, 'utf-8');
      const fixedOutHtml = sanitizeAiHtml(outHtml);
      fs.writeFileSync(outFile, fixedOutHtml);
      console.log(`✅ ${slug}: Fixed DB (${bodyField}) + out/ HTML`);
    } else {
      console.log(`✅ ${slug}: Fixed DB (${bodyField}), no out/ file`);
    }
  }

  console.log('\nDone! Re-deploy these articles via the dashboard to update the live site.');
}

main().catch(console.error);
