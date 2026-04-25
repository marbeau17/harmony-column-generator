/**
 * 全公開記事のHTMLをarticle-html-generatorで再生成するスクリプト
 * canonical link、修正済みCTA、修正済みカラーが全て反映される
 *
 * Usage: npx tsx scripts/regenerate-all-html.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load .env.local
const envContent = fs.readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

// Dynamic import to use @/ path aliases via tsx
async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Import generator (tsx resolves @/ paths)
  const { generateArticleHtml } = await import('../src/lib/generators/article-html-generator');
  const { getStickyCtaBarCss, getStickyCtaBarHtml } = await import('../src/lib/generators/sticky-cta-bar');

  console.log('Fetching published articles...');
  const { data: articles, error } = await supabase
    .from('articles')
    .select('*')
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (error || !articles) {
    console.error('Error:', error?.message);
    process.exit(1);
  }

  console.log(`${articles.length} articles found. Regenerating...\n`);

  let count = 0;
  for (const article of articles) {
    const slug = article.slug || article.id;

    try {
      let html = generateArticleHtml(article as any, {
        heroImage: 'images/hero.jpg',
        heroImageAlt: article.title ?? slug,
        ogImage: `https://harmony-mc.com/column/${slug}/images/hero.jpg`,
        hubUrl: '../index.html',
      });

      // Post-process for static hosting
      html = html.replace(
        /https:\/\/khsorerqojgwbmtiqrac\.supabase\.co\/storage\/v1\/object\/public\/article-images\/articles\/[^"]+\/(hero|body|summary)\.jpg/g,
        './images/$1.jpg'
      );
      html = html.replace('href="./css/hub.css"', 'href="../../css/hub.css"');
      html = html.replace('src="./js/hub.js"', 'src="../../js/hub.js"');
      html = html.replace(/href="\/column\/([^"]+)\/"/g, 'href="../$1/index.html"');
      html = html.replace(/src="\/column\/([^"]+)\/images\//g, 'src="../$1/images/');
      html = html.replace(/<img[^>]*src="\.\/images\/hero\.(jpg|svg)"[^>]*style="max-width:100%[^"]*"[^>]*>/g, '');

      // Write to out/
      const dir = path.join('out/column', slug);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'index.html'), html);

      count++;
      process.stdout.write(`\r✅ ${count}/${articles.length} regenerated (${slug})`);
    } catch (err) {
      console.log(`\n❌ ${slug}: ${err}`);
    }
  }

  // Regenerate hub page
  try {
    const { buildArticleCards, buildCategories, generateHubPage } = await import('../src/lib/generators/hub-generator');
    const cards = await buildArticleCards();
    const categories = buildCategories(cards);
    const recentArticles = cards.slice(0, 5);
    const hubData = {
      articles: cards.slice(0, 10),
      currentPage: 1,
      totalPages: Math.ceil(cards.length / 10),
      categories,
      recentArticles,
    };
    const hubHtml = generateHubPage(hubData);
    fs.writeFileSync('out/column/index.html', hubHtml);
    console.log(`\n✅ Hub page regenerated`);
  } catch (err) {
    console.log(`\n⚠️  Hub page generation skipped: ${err}`);
  }

  console.log(`\n\n=== Done: ${count}/${articles.length} articles regenerated ===`);
}

main().catch(console.error);
