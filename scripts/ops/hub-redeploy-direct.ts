/**
 * Direct hub redeploy: 認証バイパス版（@supabase/supabase-js 直接使用）
 *
 * Usage:
 *   FTP_DRY_RUN=true npx tsx scripts/ops/hub-redeploy-direct.ts  # dry-run
 *   npx tsx scripts/ops/hub-redeploy-direct.ts                   # 本番 FTP
 *
 * 用途: SQL ベースの batch-hide 実行後に hub を本番 FTP に同期する
 */
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// .env.local 読み込み
const envContent = fs.readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

// Cookie ベースの factory を使わず直接 client を作る
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

import { buildCategories, generateAllHubPages, type HubArticleCard } from '../../src/lib/generators/hub-generator';
import { uploadToFtp, getFtpConfig, type UploadFile } from '../../src/lib/deploy/ftp-uploader';

async function fetchArticleCards(): Promise<HubArticleCard[]> {
  const { data, error } = await supabase
    .from('articles')
    .select('id, title, slug, seo_filename, meta_description, stage2_body_html, stage3_final_html, theme, published_at, image_files')
    .eq('status', 'published')
    .not('reviewed_at', 'is', null)
    .order('published_at', { ascending: false });

  if (error) throw new Error(`fetchArticleCards failed: ${error.message}`);
  if (!data || data.length === 0) return [];

  return data.map((row) => {
    const bodyHtml = (row.stage3_final_html || row.stage2_body_html || '') as string;
    const theme = (row.theme || 'introduction') as string;
    const slug = (row.slug || row.seo_filename || row.id) as string;
    const imageFiles = (row.image_files as Record<string, string> | null) ?? {};
    let thumbnailFilename = 'default-thumbnail.webp';
    if (imageFiles && typeof imageFiles === 'object') {
      const first = Object.values(imageFiles)[0];
      if (typeof first === 'string') thumbnailFilename = first;
    }
    return {
      slug,
      title: (row.title || '') as string,
      htmlFilename: `${slug}.html`,
      summary: (row.meta_description || '') as string,
      thumbnailFilename,
      categoryId: theme,
      keywords: [],
      publishDate: (row.published_at as string) || new Date().toISOString(),
      bodyHtml,
    } as HubArticleCard;
  });
}

async function main() {
  console.log('=== Hub Redeploy (Direct) ===');
  const startedAt = Date.now();

  console.log('Fetching published+reviewed articles from DB...');
  const articles = await fetchArticleCards();
  console.log(`  → ${articles.length} articles`);

  const categories = buildCategories(articles);
  const pages = generateAllHubPages(articles, categories);
  console.log(`  → ${pages.length} hub pages generated`);

  const files: UploadFile[] = pages.map((p) => ({
    remotePath: p.path,
    content: p.html,
  }));

  console.log(`\nFTP upload (host=${process.env.FTP_HOST}, dryRun=${process.env.FTP_DRY_RUN || 'false'})...`);
  const ftpConfig = await getFtpConfig();
  const result = await uploadToFtp(ftpConfig, files);

  console.log(`\n✓ Done in ${Date.now() - startedAt}ms`);
  console.log(`  uploaded: ${result.uploaded}/${result.total}`);
  if (result.errors && result.errors.length > 0) {
    console.error('Errors:', result.errors);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Hub redeploy failed:', err);
  process.exit(1);
});
