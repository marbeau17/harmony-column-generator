/**
 * `visibility_state IN ('live', 'live_hub_stale')` だが
 * FTP に index.html が未配置 (or サイズ 0) の「stuck 記事」を一括デプロイする。
 *
 * Usage:
 *   tsx scripts/deploy-stuck-articles.ts            # dry-run (デフォルト)
 *   tsx scripts/deploy-stuck-articles.ts --apply    # 実デプロイ
 *
 * 動作概要:
 *   1. service-role で対象記事を SELECT
 *   2. FTP に接続して各 slug の index.html サイズをチェック (basic-ftp .size())
 *   3. 未配置 or サイズ 0 を「stuck」と判定
 *   4. --apply 指定時のみ、deploy-article-now.ts と同等処理を内部実行
 *   5. summary を出力
 *
 * 設計メモ:
 *   - FTP_REMOTE_PATH (.env.local) = /spiritual/column/  → /spiritual/column/{slug}/index.html
 *   - deploy-article-now.ts は関数 export していないため、コア処理を本ファイルに再実装
 *   - 1 接続を usse-and-keep-alive で使い回し、各 slug 毎に切断/再接続しない
 */
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { Client as FtpClient } from 'basic-ftp';
import { Readable } from 'stream';

// ─── .env.local ロード ───────────────────────────────────────────────────
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
const REMOTE_BASE_RAW = process.env.FTP_REMOTE_PATH || '/spiritual/column/';
const REMOTE_BASE = REMOTE_BASE_RAW.endsWith('/') ? REMOTE_BASE_RAW : REMOTE_BASE_RAW + '/';

// ─── CLI ────────────────────────────────────────────────────────────────
const APPLY = process.argv.includes('--apply');

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── FTP 上の index.html 存在確認 ───────────────────────────────────────
async function checkRemoteIndex(
  client: FtpClient,
  slug: string,
): Promise<{ exists: boolean; size: number; reason?: string }> {
  const remote = `${REMOTE_BASE}${slug}/index.html`;
  try {
    const size = await client.size(remote);
    return { exists: size > 0, size };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 550 = file not found
    if (/550/.test(msg) || /not found|No such/i.test(msg)) {
      return { exists: false, size: 0, reason: 'not-found' };
    }
    return { exists: false, size: 0, reason: msg };
  }
}

// ─── 1 記事を FTP デプロイ (deploy-article-now.ts と同等処理) ───────────
async function deployArticle(
  client: FtpClient,
  article: any,
): Promise<{ uploaded: string[]; errors: string[] }> {
  const slug: string = article.slug ?? article.id;
  const uploaded: string[] = [];
  const errors: string[] = [];

  // HTML 生成
  const { generateArticleHtml } = await import('../src/lib/generators/article-html-generator');
  const { getOgImageUrl, getHubPath } = await import('../src/lib/config/public-urls');

  let html = generateArticleHtml(article, {
    heroImage: 'images/hero.jpg',
    heroImageAlt: article.title ?? slug,
    ogImage: getOgImageUrl(slug, 'hero'),
    hubUrl: '../index.html',
  });

  // post-process (deploy/route.ts と同一)
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

  // 画像 fetch
  const imageFiles: { url: string; position: string }[] = Array.isArray(article.image_files)
    ? article.image_files
    : [];
  const imageBuffers: { remotePath: string; buffer: Buffer }[] = [];
  for (const img of imageFiles) {
    if (!img.url) continue;
    try {
      const res = await fetch(img.url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const filename = img.position ? `${img.position}.jpg` : 'image.jpg';
      imageBuffers.push({ remotePath: `${slug}/images/${filename}`, buffer: buf });
    } catch {
      /* skip */
    }
  }

  // index.html upload
  const htmlRemote = `${REMOTE_BASE}${slug}/index.html`;
  try {
    await client.ensureDir(`${REMOTE_BASE}${slug}/`);
    await client.cd('/');
    await client.uploadFrom(Readable.from(Buffer.from(html, 'utf-8')), htmlRemote);
    uploaded.push(htmlRemote);
  } catch (e) {
    errors.push(`index.html: ${String(e)}`);
  }

  // 画像 upload
  for (const img of imageBuffers) {
    const remote = `${REMOTE_BASE}${img.remotePath}`;
    try {
      await client.ensureDir(`${REMOTE_BASE}${slug}/images/`);
      await client.cd('/');
      await client.uploadFrom(Readable.from(img.buffer), remote);
      uploaded.push(remote);
    } catch (e) {
      errors.push(`${img.remotePath}: ${String(e)}`);
    }
  }

  return { uploaded, errors };
}

// ─── main ───────────────────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase env が不足');
  }
  if (!FTP_HOST || !FTP_USER || !FTP_PASSWORD) {
    throw new Error('FTP env が不足');
  }

  console.log(`mode: ${APPLY ? 'APPLY (実デプロイ)' : 'DRY-RUN (--apply 未指定)'}`);
  console.log(`FTP base: ${REMOTE_BASE}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 1. 対象記事取得
  console.log('\n[1/3] 対象記事 SELECT (visibility_state IN live, live_hub_stale)');
  const { data: articles, error } = await supabase
    .from('articles')
    .select('*')
    .in('visibility_state', ['live', 'live_hub_stale']);
  if (error) throw error;
  if (!articles || articles.length === 0) {
    console.log('  対象記事なし');
    return;
  }
  console.log(`  対象: ${articles.length} 件`);

  // 2. FTP で各 slug の存在確認
  console.log('\n[2/3] FTP 存在確認');
  const client = new FtpClient();
  client.ftp.verbose = false;

  const stuck: any[] = [];
  const fine: any[] = [];

  try {
    await client.access({
      host: FTP_HOST,
      user: FTP_USER,
      password: FTP_PASSWORD,
      port: FTP_PORT,
      secure: false,
    });

    for (const a of articles) {
      const slug: string = (a as any).slug ?? (a as any).id;
      const r = await checkRemoteIndex(client, slug);
      if (!r.exists) {
        stuck.push(a);
        console.log(
          `  STUCK   ${slug.padEnd(40)} size=${r.size} reason=${r.reason ?? 'size<=0'}`,
        );
      } else {
        fine.push(a);
      }
    }

    console.log(`\n  stuck: ${stuck.length} / 正常: ${fine.length}`);

    // 3. デプロイ
    if (stuck.length === 0) {
      console.log('\n[3/3] デプロイ対象なし — 終了');
      return;
    }

    if (!APPLY) {
      console.log('\n[3/3] DRY-RUN: 以下を再デプロイ予定 (--apply で実行)');
      for (const a of stuck) {
        console.log(`  - ${(a as any).slug ?? (a as any).id}  (${(a as any).title ?? ''})`);
      }
      return;
    }

    console.log(`\n[3/3] APPLY: ${stuck.length} 件を順次デプロイ`);
    let okCount = 0;
    let ngCount = 0;
    const failures: { slug: string; errors: string[] }[] = [];

    for (let i = 0; i < stuck.length; i++) {
      const a = stuck[i];
      const slug: string = (a as any).slug ?? (a as any).id;
      console.log(`\n  [${i + 1}/${stuck.length}] ${slug}`);
      try {
        const { uploaded, errors } = await deployArticle(client, a);
        console.log(`    uploaded=${uploaded.length} errors=${errors.length}`);
        if (errors.length === 0) {
          okCount++;
        } else {
          ngCount++;
          failures.push({ slug, errors });
          for (const e of errors) console.log(`      ! ${e}`);
        }
      } catch (e) {
        ngCount++;
        const msg = e instanceof Error ? e.message : String(e);
        failures.push({ slug, errors: [msg] });
        console.log(`    FATAL ${msg}`);
      }
    }

    // summary
    console.log('\n=== Summary ===');
    console.log(`対象記事(live/live_hub_stale): ${articles.length}`);
    console.log(`stuck 検出:                    ${stuck.length}`);
    console.log(`デプロイ成功:                  ${okCount}`);
    console.log(`デプロイ失敗:                  ${ngCount}`);
    if (failures.length > 0) {
      console.log('\n失敗詳細:');
      for (const f of failures) {
        console.log(`  - ${f.slug}`);
        for (const e of f.errors) console.log(`      ${e}`);
      }
      process.exit(2);
    }
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
