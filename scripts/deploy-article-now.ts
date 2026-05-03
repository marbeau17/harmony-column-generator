/**
 * 1記事を直接 FTP デプロイする検証スクリプト (auth bypass)。
 *
 * `/api/articles/[id]/deploy` と同等のロジックを認証なしで実行する。
 * 管理画面の「再デプロイ」ボタンが反映されない問題の切り分け用。
 *
 * Usage:
 *   tsx scripts/deploy-article-now.ts <slug-or-id>
 *
 * 例:
 *   tsx scripts/deploy-article-now.ts law-of-attraction
 *
 * 動作:
 *   1. .env.local から FTP / Supabase 情報を読み込み
 *   2. service-role で記事を SELECT (slug 一致が無ければ id で再試行)
 *   3. generateArticleHtml() で deploy/route.ts と同じパラメータで HTML 生成
 *   4. deploy/route.ts と同じ post-process を適用
 *   5. 画像 (hero/body/summary) を Supabase Storage から fetch → Buffer
 *   6. basic-ftp で接続し index.html + 画像 3 枚をアップロード
 *   7. 成功した remote path のリストを print
 */
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { Client as FtpClient } from 'basic-ftp';
import { Readable } from 'stream';

// ─── .env.local を読み込み ──────────────────────────────────────────────
const envContent = fs.readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) {
    const k = m[1].trim();
    const v = m[2].trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const FTP_HOST = process.env.FTP_HOST!;
const FTP_USER = process.env.FTP_USER!;
const FTP_PASSWORD = process.env.FTP_PASSWORD!;
const FTP_PORT = parseInt(process.env.FTP_PORT || '21', 10);
const REMOTE_BASE_RAW = process.env.FTP_REMOTE_PATH || '/public_html/column/columns/';
const REMOTE_BASE = REMOTE_BASE_RAW.endsWith('/') ? REMOTE_BASE_RAW : REMOTE_BASE_RAW + '/';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: tsx scripts/deploy-article-now.ts <slug-or-id>');
    process.exit(1);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) が不足');
  }
  if (!FTP_HOST || !FTP_USER || !FTP_PASSWORD) {
    throw new Error('FTP env (FTP_HOST / FTP_USER / FTP_PASSWORD) が不足');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1. Fetch article (slug 優先 → id フォールバック)
  console.log(`[1/6] 記事を取得中: ${arg}`);
  let article: any = null;
  {
    const { data } = await supabase.from('articles').select('*').eq('slug', arg).maybeSingle();
    if (data) article = data;
  }
  if (!article) {
    const { data } = await supabase.from('articles').select('*').eq('id', arg).maybeSingle();
    if (data) article = data;
  }
  if (!article) {
    throw new Error(`記事が見つかりません (slug/id=${arg})`);
  }
  const slug: string = article.slug ?? article.id;
  console.log(`      title: ${article.title}`);
  console.log(`      slug:  ${slug}`);
  console.log(`      visibility_state: ${article.visibility_state ?? 'null'}`);
  console.log(`      reviewed_at:      ${article.reviewed_at ?? 'null'}`);
  console.log(`      stage3 length:    ${article.stage3_final_html?.length ?? 0}`);

  // 2. Generate HTML (deploy/route.ts と同パラメータ)
  console.log('[2/6] HTML 生成');
  const { generateArticleHtml } = await import('../src/lib/generators/article-html-generator');
  const { getOgImageUrl, getHubPath } = await import('../src/lib/config/public-urls');

  let html = generateArticleHtml(article, {
    heroImage: 'images/hero.jpg',
    heroImageAlt: article.title ?? slug,
    ogImage: getOgImageUrl(slug, 'hero'),
    hubUrl: '../index.html',
  });

  // 3. Post-process (deploy/route.ts と同一)
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
  html = html.replace(/<img[^>]*src="\.\/images\/hero\.(jpg|svg)"[^>]*style="max-width:100%[^"]*"[^>]*>/g, '');
  html = html.replace(/<!--IMAGE:hero:[^>]*-->/g, '');

  console.log(`      生成 HTML サイズ: ${html.length} bytes`);

  // 4. Prepare image buffers
  console.log('[3/6] 画像 fetch (Supabase Storage)');
  const imageFiles: { url: string; position: string; alt?: string }[] = Array.isArray(
    article.image_files,
  )
    ? article.image_files
    : [];

  const imageBuffers: { remotePath: string; buffer: Buffer; sourceUrl: string }[] = [];
  for (const img of imageFiles) {
    if (!img.url) continue;
    try {
      const res = await fetch(img.url);
      if (!res.ok) {
        console.log(`      [WARN] ${img.position}: HTTP ${res.status} ${img.url}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const filename = img.position ? `${img.position}.jpg` : 'image.jpg';
      imageBuffers.push({
        remotePath: `${slug}/images/${filename}`,
        buffer: buf,
        sourceUrl: img.url,
      });
      console.log(`      ${img.position}: ${buf.length} bytes`);
    } catch (e) {
      console.log(`      [ERROR] ${img.position}: ${String(e)}`);
    }
  }

  // 5. FTP upload
  console.log(`[4/6] FTP 接続 ${FTP_HOST}:${FTP_PORT}`);
  const client = new FtpClient();
  client.ftp.verbose = false;

  const uploaded: string[] = [];
  const errors: string[] = [];

  try {
    await client.access({
      host: FTP_HOST,
      user: FTP_USER,
      password: FTP_PASSWORD,
      port: FTP_PORT,
      secure: false,
    });
    console.log('      接続成功');

    // index.html
    console.log('[5/6] index.html アップロード');
    const htmlRemote = `${REMOTE_BASE}${slug}/index.html`;
    try {
      await client.ensureDir(`${REMOTE_BASE}${slug}/`);
      await client.cd('/');
      const htmlStream = Readable.from(Buffer.from(html, 'utf-8'));
      await client.uploadFrom(htmlStream, htmlRemote);
      uploaded.push(htmlRemote);
      console.log(`      OK ${htmlRemote}`);
    } catch (e) {
      errors.push(`index.html: ${String(e)}`);
      console.log(`      NG ${htmlRemote}: ${String(e)}`);
    }

    // images
    console.log('[6/6] 画像アップロード');
    for (const img of imageBuffers) {
      const remote = `${REMOTE_BASE}${img.remotePath}`;
      try {
        await client.ensureDir(`${REMOTE_BASE}${slug}/images/`);
        await client.cd('/');
        const stream = Readable.from(img.buffer);
        await client.uploadFrom(stream, remote);
        uploaded.push(remote);
        console.log(`      OK ${remote}`);
      } catch (e) {
        errors.push(`${img.remotePath}: ${String(e)}`);
        console.log(`      NG ${remote}: ${String(e)}`);
      }
    }
  } finally {
    client.close();
  }

  console.log('\n=== 結果 ===');
  console.log(`uploaded: ${uploaded.length}`);
  for (const p of uploaded) console.log(`  - ${p}`);
  if (errors.length > 0) {
    console.log(`errors: ${errors.length}`);
    for (const e of errors) console.log(`  ! ${e}`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
