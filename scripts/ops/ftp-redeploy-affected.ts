/**
 * 修正済みHTMLをFTPで再アップロードするスクリプト
 * Usage: npx tsx scripts/ftp-redeploy-affected.ts
 */
import { Client } from 'basic-ftp';
import * as fs from 'fs';
import { Readable } from 'stream';

// Load .env.local
const envContent = fs.readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const FTP_HOST = process.env.FTP_HOST!;
const FTP_USER = process.env.FTP_USER!;
const FTP_PASSWORD = process.env.FTP_PASSWORD!;
const FTP_PORT = parseInt(process.env.FTP_PORT || '21', 10);
const REMOTE_BASE = process.env.FTP_REMOTE_PATH || '/public_html/column/columns/';

const AFFECTED_SLUGS = [
  'spiritual-beginner-books-recommend',
  'easy-way-to-find-soul-mission-2',
  'gratitude-journal-effects',
  'self-reiki-guide-beginners',
  'soul-mission-anxiety',
];

async function main() {
  if (!FTP_HOST || !FTP_USER || !FTP_PASSWORD) {
    console.error('Missing FTP credentials in .env.local');
    process.exit(1);
  }

  const client = new Client();
  client.ftp.verbose = false;

  try {
    console.log(`Connecting to ${FTP_HOST}...`);
    await client.access({
      host: FTP_HOST,
      user: FTP_USER,
      password: FTP_PASSWORD,
      port: FTP_PORT,
      secure: false,
    });
    console.log('Connected!\n');

    for (const slug of AFFECTED_SLUGS) {
      const localFile = `out/column/${slug}/index.html`;
      if (!fs.existsSync(localFile)) {
        console.log(`⏭️  ${slug}: no local file, skipping`);
        continue;
      }

      const html = fs.readFileSync(localFile, 'utf-8');
      const remotePath = `${REMOTE_BASE}${slug}/index.html`;

      try {
        // Ensure directory exists
        await client.ensureDir(`${REMOTE_BASE}${slug}/`);
        await client.cd('/');

        // Upload
        const stream = Readable.from(Buffer.from(html, 'utf-8'));
        await client.uploadFrom(stream, remotePath);
        console.log(`✅ ${slug}: uploaded to ${remotePath}`);
      } catch (err) {
        console.log(`❌ ${slug}: upload failed - ${err}`);
      }
    }
  } finally {
    client.close();
    console.log('\nDone!');
  }
}

main().catch(console.error);
