/**
 * P5-52 後の全記事強制再 FTP デプロイスクリプト。
 *
 * プロフィール重複修正後、`visibility_state IN ('live','live_hub_stale')` の全記事を
 * 新形式 HTML で上書きする。`scripts/deploy-article-now.ts` と同等のロジックを
 * バッチ実行する。
 *
 * Usage:
 *   tsx scripts/redeploy-all-articles.ts                  # dry-run (デフォルト)
 *   tsx scripts/redeploy-all-articles.ts --apply          # 本番実行
 *   tsx scripts/redeploy-all-articles.ts --apply --skip-images
 *
 * オプション:
 *   --apply        実際に FTP アップロードを行う (省略時は dry-run)
 *   --skip-images  画像 3 枚 (hero/body/summary) のアップロードをスキップ (HTML のみ)
 *
 * 動作:
 *   1. .env.local 読み込み
 *   2. service-role で対象記事を SELECT
 *   3. 各記事ごとに HTML 再生成 + post-process
 *   4. dry-run でなければ FTP で /spiritual/column/{slug}/index.html を上書き
 *   5. --skip-images 指定が無ければ画像 3 枚も再アップ (毎回上書き)
 *   6. 進捗 (n/total)・成功数・失敗 ID リストを最後に出力
 */
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { Client as FtpClient } from 'basic-ftp';
import { Readable } from 'stream';

// ─── .env.local 読み込み ────────────────────────────────────────────────
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── CLI args ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const SKIP_IMAGES = args.includes('--skip-images');
const DRY_RUN = !APPLY;

// ─── 1 記事処理 ─────────────────────────────────────────────────────────
async function processArticle(
  article: any,
  ftpClient: FtpClient | null,
): Promise<{ ok: boolean; uploaded: string[]; errors: string[] }> {
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

  console.log(`      HTML size: ${html.length} bytes`);

  if (DRY_RUN || !ftpClient) {
    console.log(`      [DRY-RUN] skip FTP upload for ${slug}`);
    return { ok: true, uploaded, errors };
  }

  // index.html upload
  const htmlRemote = `${REMOTE_BASE}${slug}/index.html`;
  try {
    await ftpClient.ensureDir(`${REMOTE_BASE}${slug}/`);
    await ftpClient.cd('/');
    const htmlStream = Readable.from(Buffer.from(html, 'utf-8'));
    await ftpClient.uploadFrom(htmlStream, htmlRemote);
    uploaded.push(htmlRemote);
    console.log(`      OK ${htmlRemote}`);
  } catch (e) {
    const msg = `index.html: ${String(e)}`;
    errors.push(msg);
    console.log(`      NG ${htmlRemote}: ${String(e)}`);
  }

  // images upload (skip if --skip-images)
  if (!SKIP_IMAGES) {
    const imageFiles: { url: string; position: string; alt?: string }[] = Array.isArray(
      article.image_files,
    )
      ? article.image_files
      : [];

    for (const img of imageFiles) {
      if (!img.url) continue;
      try {
        const res = await fetch(img.url);
        if (!res.ok) {
          const msg = `${img.position}: HTTP ${res.status}`;
          errors.push(msg);
          console.log(`      [WARN] ${msg}`);
          continue;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const filename = img.position ? `${img.position}.jpg` : 'image.jpg';
        const remote = `${REMOTE_BASE}${slug}/images/${filename}`;
        await ftpClient.ensureDir(`${REMOTE_BASE}${slug}/images/`);
        await ftpClient.cd('/');
        const stream = Readable.from(buf);
        await ftpClient.uploadFrom(stream, remote);
        uploaded.push(remote);
        console.log(`      OK ${remote} (${buf.length} bytes)`);
      } catch (e) {
        const msg = `${img.position}: ${String(e)}`;
        errors.push(msg);
        console.log(`      NG ${img.position}: ${String(e)}`);
      }
    }
  }

  return { ok: errors.length === 0, uploaded, errors };
}

// ─── main ───────────────────────────────────────────────────────────────
async function main() {
  console.log('=== 全記事再デプロイ (P5-52 後) ===');
  console.log(`mode:        ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}`);
  console.log(`skip-images: ${SKIP_IMAGES ? 'YES' : 'NO'}`);
  console.log(`remote base: ${REMOTE_BASE}`);
  console.log('');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) が不足');
  }
  if (!DRY_RUN && (!FTP_HOST || !FTP_USER || !FTP_PASSWORD)) {
    throw new Error('FTP env (FTP_HOST / FTP_USER / FTP_PASSWORD) が不足');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 対象記事 SELECT
  console.log('[1/3] 対象記事を取得');
  const { data: articles, error: selectErr } = await supabase
    .from('articles')
    .select('*')
    .in('visibility_state', ['live', 'live_hub_stale'])
    .order('created_at', { ascending: true });

  if (selectErr) {
    throw new Error(`SELECT 失敗: ${selectErr.message}`);
  }
  if (!articles || articles.length === 0) {
    console.log('対象記事 0 件。終了します。');
    return;
  }
  const total = articles.length;
  console.log(`      対象 ${total} 件`);
  console.log('');

  // FTP 接続 (apply 時のみ)
  let ftpClient: FtpClient | null = null;
  if (!DRY_RUN) {
    console.log(`[2/3] FTP 接続 ${FTP_HOST}:${FTP_PORT}`);
    ftpClient = new FtpClient();
    ftpClient.ftp.verbose = false;
    await ftpClient.access({
      host: FTP_HOST,
      user: FTP_USER,
      password: FTP_PASSWORD,
      port: FTP_PORT,
      secure: false,
    });
    console.log('      接続成功');
    console.log('');
  } else {
    console.log('[2/3] FTP 接続 (DRY-RUN: skip)');
    console.log('');
  }

  // ループ処理
  console.log('[3/3] 記事ごとに再生成・アップロード');
  const successIds: string[] = [];
  const failedIds: { id: string; slug: string; errors: string[] }[] = [];
  let totalUploaded = 0;

  try {
    for (let i = 0; i < total; i++) {
      const article = articles[i];
      const slug = article.slug ?? article.id;
      const idx = i + 1;
      console.log(`\n[${idx}/${total}] ${slug} (id=${article.id})`);
      console.log(`      title:            ${article.title ?? '(no title)'}`);
      console.log(`      visibility_state: ${article.visibility_state}`);
      console.log(`      stage3 length:    ${article.stage3_final_html?.length ?? 0}`);

      try {
        const { ok, uploaded, errors } = await processArticle(article, ftpClient);
        totalUploaded += uploaded.length;
        if (ok) {
          successIds.push(article.id);
        } else {
          failedIds.push({ id: article.id, slug, errors });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`      FATAL: ${msg}`);
        failedIds.push({ id: article.id, slug, errors: [msg] });
        // continue with next article
      }
    }
  } finally {
    if (ftpClient) {
      ftpClient.close();
    }
  }

  // サマリ
  console.log('\n========================================');
  console.log('=== 結果サマリ ===');
  console.log('========================================');
  console.log(`mode:           ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}`);
  console.log(`skip-images:    ${SKIP_IMAGES ? 'YES' : 'NO'}`);
  console.log(`対象記事:       ${total}`);
  console.log(`成功:           ${successIds.length}`);
  console.log(`失敗:           ${failedIds.length}`);
  console.log(`uploaded files: ${totalUploaded}`);
  if (failedIds.length > 0) {
    console.log('\n--- 失敗した記事 ---');
    for (const f of failedIds) {
      console.log(`  ! id=${f.id} slug=${f.slug}`);
      for (const err of f.errors) {
        console.log(`      - ${err}`);
      }
    }
    process.exit(2);
  }
  if (DRY_RUN) {
    console.log('\n[DRY-RUN] 実際の FTP 書き込みは行っていません。--apply で実行してください。');
  }
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
