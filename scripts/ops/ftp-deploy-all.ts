/**
 * 全修正済みout/ファイルをFTPアップロード
 * Usage: npx tsx scripts/ftp-deploy-all.ts
 */
import { Client } from 'basic-ftp';
import * as fs from 'fs';
import { Readable } from 'stream';

const envContent = fs.readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const REMOTE_BASE = process.env.FTP_REMOTE_PATH || '/public_html/column/columns/';

async function main() {
  const client = new Client();

  try {
    console.log(`Connecting to ${process.env.FTP_HOST}...`);
    await client.access({
      host: process.env.FTP_HOST!,
      user: process.env.FTP_USER!,
      password: process.env.FTP_PASSWORD!,
      port: parseInt(process.env.FTP_PORT || '21', 10),
      secure: false,
    });
    console.log('Connected!\n');

    // Deploy hub page
    const hubFile = 'out/column/index.html';
    if (fs.existsSync(hubFile)) {
      const html = fs.readFileSync(hubFile, 'utf-8');
      await client.ensureDir(`${REMOTE_BASE}`);
      await client.cd('/');
      const stream = Readable.from(Buffer.from(html, 'utf-8'));
      await client.uploadFrom(stream, `${REMOTE_BASE}index.html`);
      console.log('✅ hub page (index.html)');
    }

    // Deploy all articles
    const dirs = fs.readdirSync('out/column', { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== 'images' && d.name !== 'css' && d.name !== 'js')
      .map(d => d.name);

    let count = 0;
    for (const slug of dirs) {
      const localFile = `out/column/${slug}/index.html`;
      if (!fs.existsSync(localFile)) continue;

      const html = fs.readFileSync(localFile, 'utf-8');
      const remotePath = `${REMOTE_BASE}${slug}/index.html`;

      try {
        await client.ensureDir(`${REMOTE_BASE}${slug}/`);
        await client.cd('/');
        const stream = Readable.from(Buffer.from(html, 'utf-8'));
        await client.uploadFrom(stream, remotePath);
        count++;
        process.stdout.write(`\r✅ ${count}/${dirs.length} articles deployed (${slug})`);
      } catch (err) {
        console.log(`\n❌ ${slug}: ${err}`);
      }
    }

    console.log(`\n\n=== 完了: ${count}/${dirs.length} 記事デプロイ ===`);
  } finally {
    client.close();
  }
}

main().catch(console.error);
