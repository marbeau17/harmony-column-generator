/**
 * hub.css + 全記事 + ハブページをFTPデプロイ
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

async function upload(client: Client, remotePath: string, content: string) {
  const dir = remotePath.substring(0, remotePath.lastIndexOf('/'));
  if (dir) { await client.ensureDir(dir); await client.cd('/'); }
  await client.uploadFrom(Readable.from(Buffer.from(content, 'utf-8')), remotePath);
}

async function main() {
  const client = new Client();
  try {
    console.log(`Connecting to ${process.env.FTP_HOST}...`);
    await client.access({
      host: process.env.FTP_HOST!, user: process.env.FTP_USER!,
      password: process.env.FTP_PASSWORD!, port: 21, secure: false,
    });

    // 1. Upload hub.css
    const cssContent = fs.readFileSync('out/column/css/hub.css', 'utf-8');
    await upload(client, `${REMOTE_BASE}css/hub.css`, cssContent);
    console.log('✅ css/hub.css');

    // 2. Upload hub page
    const hubHtml = fs.readFileSync('out/column/index.html', 'utf-8');
    await upload(client, `${REMOTE_BASE}index.html`, hubHtml);
    console.log('✅ index.html');

    // 3. Upload all articles
    const dirs = fs.readdirSync('out/column', { withFileTypes: true })
      .filter(d => d.isDirectory() && !['images','css','js'].includes(d.name))
      .map(d => d.name);

    let count = 0;
    for (const slug of dirs) {
      const f = `out/column/${slug}/index.html`;
      if (fs.existsSync(f)) {
        await upload(client, `${REMOTE_BASE}${slug}/index.html`, fs.readFileSync(f, 'utf-8'));
        count++;
        process.stdout.write(`\r✅ ${count}/${dirs.length} (${slug})`);
      }
      // Handle nested pagination pages (e.g. page/2/index.html)
      const subDir = `out/column/${slug}`;
      if (fs.statSync(subDir).isDirectory()) {
        const subs = fs.readdirSync(subDir, { withFileTypes: true })
          .filter(d => d.isDirectory());
        for (const sub of subs) {
          const subFile = `${subDir}/${sub.name}/index.html`;
          if (fs.existsSync(subFile)) {
            await upload(client, `${REMOTE_BASE}${slug}/${sub.name}/index.html`, fs.readFileSync(subFile, 'utf-8'));
            console.log(`\n  ✅ ${slug}/${sub.name}/index.html`);
          }
        }
      }
    }
    console.log(`\n\n=== Done: ${count} articles + hub.css + index.html ===`);
  } finally { client.close(); }
}

main().catch(console.error);
