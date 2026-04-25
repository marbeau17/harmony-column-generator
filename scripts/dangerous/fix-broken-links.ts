/**
 * 存在しない記事への関連リンクを除去するスクリプト
 * Usage: npx tsx scripts/fix-broken-links.ts
 */
import * as fs from 'fs';

const ARTICLE_DIR = 'out/column';

// Get all existing slugs
const existingSlugs = new Set(
  fs.readdirSync(ARTICLE_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'images' && d.name !== 'css' && d.name !== 'js')
    .map(d => d.name)
);

console.log(`${existingSlugs.size} existing article directories found.\n`);

let totalFixed = 0;

for (const slug of existingSlugs) {
  const filePath = `${ARTICLE_DIR}/${slug}/index.html`;
  if (!fs.existsSync(filePath)) continue;

  let html = fs.readFileSync(filePath, 'utf-8');
  const original = html;

  // Find all relative links to ../slug/index.html and remove ones pointing to non-existent dirs
  const linkPattern = /<a\s[^>]*href="\.\.\/([\w-]+)\/index\.html"[^>]*>[\s\S]*?<\/a>/gi;
  html = html.replace(linkPattern, (match, linkedSlug) => {
    if (existingSlugs.has(linkedSlug)) return match; // valid link
    console.log(`  ❌ ${slug}: removed broken link to "${linkedSlug}"`);
    return ''; // remove broken link
  });

  if (html !== original) {
    fs.writeFileSync(filePath, html);
    totalFixed++;
  }
}

console.log(`\n=== ${totalFixed} files fixed ===`);
