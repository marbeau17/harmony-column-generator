/**
 * 記事HTMLの生成のみ確認スクリプト (FTPアップロードなし)
 *
 * Usage:
 *   tsx scripts/preview-article-html.ts <slug>
 *
 * 動作:
 *   1. service-role で articles テーブルから slug 一致の記事を取得
 *   2. src/app/api/articles/[id]/deploy/route.ts と同じ params で
 *      generateArticleHtml を呼び、post-process も同様に適用
 *   3. 生成 HTML を tmp/preview-{slug}.html に書き出す
 *   4. HTML サイズ + canonical / og:url / og:image を console 出力
 *   5. runDeployChecklist の結果を console 出力
 */
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// ── .env.local 読み込み ───────────────────────────────────────────
const envPath = path.resolve(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) {
    const key = m[1].trim();
    if (!process.env[key]) process.env[key] = m[2].trim();
  }
}

// ── 動的 import (env load 後) ────────────────────────────────────
async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: tsx scripts/preview-article-html.ts <slug>');
    process.exit(1);
  }

  const { generateArticleHtml } = await import('../src/lib/generators/article-html-generator');
  const { runDeployChecklist } = await import('../src/lib/content/quality-checklist');
  const { getOgImageUrl, getHubPath } = await import('../src/lib/config/public-urls');

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  console.log(`\n=== Preview article: ${slug} ===`);

  // 1. 記事 fetch (service role)
  const { data: article, error } = await sb
    .from('articles')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !article) {
    console.error(`記事が見つかりません (slug=${slug}):`, error);
    process.exit(1);
  }

  // 2. HTML 生成 (deploy/route.ts と同じ params)
  let html = generateArticleHtml(article as any, {
    heroImage: `images/hero.jpg`,
    heroImageAlt: (article as any).title ?? slug,
    ogImage: getOgImageUrl(slug, 'hero'),
    hubUrl: '../index.html',
  });

  // 3. Post-process (deploy/route.ts と同一)
  function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  html = html.replace(
    /https:\/\/khsorerqojgwbmtiqrac\.supabase\.co\/storage\/v1\/object\/public\/article-images\/articles\/[^"]+\/(hero|body|summary)\.jpg/g,
    './images/$1.jpg',
  );
  html = html.replace('href="./css/hub.css"', 'href="../../css/hub.css"');
  html = html.replace('src="./js/hub.js"', 'src="../../js/hub.js"');
  const hubPathPattern = escapeRegex(getHubPath());
  html = html.replace(
    new RegExp(`href="${hubPathPattern}/([^"]+)/"`, 'g'),
    'href="../$1/index.html"',
  );
  html = html.replace(
    new RegExp(`src="${hubPathPattern}/([^"]+)/images/`, 'g'),
    'src="../$1/images/',
  );
  html = html.replace(
    /<img[^>]*src="\.\/images\/hero\.(jpg|svg)"[^>]*style="max-width:100%[^"]*"[^>]*>/g,
    '',
  );
  html = html.replace(/<!--IMAGE:hero:[^>]*-->/g, '');

  // 4. 出力
  const tmpDir = path.resolve(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const outPath = path.join(tmpDir, `preview-${slug}.html`);
  fs.writeFileSync(outPath, html, 'utf-8');

  // 5. URL 抽出
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? '(none)';
  const ogUrl = html.match(/<meta[^>]+property=["']og:url["'][^>]*content=["']([^"']+)["']/i)?.[1] ?? '(none)';
  const ogImg = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] ?? '(none)';

  console.log(`\nFile     : ${outPath}`);
  console.log(`HTML size: ${html.length} bytes`);
  console.log(`canonical: ${canonical}`);
  console.log(`og:url   : ${ogUrl}`);
  console.log(`og:image : ${ogImg}`);

  // 6. runDeployChecklist
  const result = runDeployChecklist(html, slug);
  console.log(`\nrunDeployChecklist: ${result.passed ? 'PASS' : 'FAIL'}`);
  for (const item of result.items) {
    const mark = item.status === 'pass' ? 'PASS' : item.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`  [${mark}] ${item.id} ${item.label}${item.detail ? ` — ${item.detail}` : ''}`);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
