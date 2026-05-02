/**
 * P5-48: ハブページを再生成して FTP にアップロード (auth bypass)
 *
 * /api/hub/deploy は認証必須だが、このスクリプトは service-role + FTP_* env で
 * 直接実行する。一覧の「公開」が長らく動いていなかったため、ハブ HTML が古い。
 * 31 件の visibility_state='live' 記事を反映した新ハブを即座に生成・アップする。
 */
import * as fs from 'fs';
import { Client as FtpClient } from 'basic-ftp';
import { Readable } from 'stream';

const env = fs.readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

(async () => {
  // hub-generator は @/ alias を使うので tsx で直接読み込む
  const { buildArticleCards, buildCategories, generateAllHubPages } = await import(
    '../src/lib/generators/hub-generator'
  );

  console.log('=== ハブページ再生成 ===\n');
  const articles = await buildArticleCards();
  console.log(`記事カード生成: ${articles.length} 件`);
  if (articles.length === 0) {
    console.error(
      '記事 0 件です。visibility_state=live の記事が無い可能性。中止します。',
    );
    process.exit(1);
  }
  for (const a of articles.slice(0, 5)) {
    console.log(`  - ${a.slug} | ${a.title}`);
  }
  if (articles.length > 5) console.log(`  ... 他 ${articles.length - 5} 件\n`);

  const categories = buildCategories(articles);
  const pages = generateAllHubPages(articles, categories);
  console.log(`\nハブ HTML 生成完了: ${pages.length} ページ`);

  // FTP アップロード
  const host = process.env.FTP_HOST!;
  const user = process.env.FTP_USER!;
  const password = process.env.FTP_PASSWORD!;
  const port = process.env.FTP_PORT ? parseInt(process.env.FTP_PORT, 10) : 21;
  const basePath = process.env.FTP_REMOTE_PATH || '/spiritual/column/';

  const c = new FtpClient();
  c.ftp.verbose = false;
  await c.access({ host, user, password, port });

  console.log(`\nFTP アップロード: ${host}${basePath}`);
  for (const p of pages) {
    const remotePath = `${basePath.replace(/\/$/, '')}/${p.path.replace(/^\//, '')}`;
    const dir = remotePath.substring(0, remotePath.lastIndexOf('/'));
    await c.ensureDir(dir);
    await c.cd('/');
    const stream = Readable.from(Buffer.from(p.html, 'utf-8'));
    await c.uploadFrom(stream, remotePath);
    console.log(`  ✅ ${remotePath}`);
  }

  c.close();
  console.log('\n完了。https://harmony-mc.com/spiritual/column/index.html をリロードしてください。');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
