/**
 * Stuck Articles FTP 状態診断 (read-only)
 *
 * `/spiritual/column/law-of-attraction/` および `/spiritual/column/healing/` の
 * 配下に index.html / images/hero.jpg / images/body.jpg / images/summary.jpg が
 * 存在するか、それぞれのサイズと更新時刻を出力する。書き込み一切なし。
 */

import { Client } from 'basic-ftp';
import fs from 'fs';
import path from 'path';

// .env.local を手動ロード (dotenv 依存なし — 既存 scripts と同じ方式)
try {
  const envFile = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of envFile.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const k = m[1].trim();
      if (!process.env[k]) process.env[k] = m[2].trim();
    }
  }
} catch {
  // .env.local がない場合は環境変数のみで進める
}

interface FtpEnv {
  host: string;
  user: string;
  password: string;
  port: number;
}

function readEnv(): FtpEnv {
  const host = process.env.FTP_HOST;
  const user = process.env.FTP_USER;
  const password = process.env.FTP_PASSWORD;
  const port = process.env.FTP_PORT ? parseInt(process.env.FTP_PORT, 10) : 21;
  if (!host || !user || !password) {
    throw new Error('FTP_HOST / FTP_USER / FTP_PASSWORD が未設定です (.env.local を確認)');
  }
  return { host, user, password, port };
}

function maskUser(user: string): string {
  if (user.length <= 2) return '*'.repeat(user.length);
  return user[0] + '*'.repeat(Math.max(1, user.length - 2)) + user.slice(-1);
}

interface FileProbe {
  path: string;
  exists: boolean;
  size: number | null;
  modifiedAt: Date | null;
  type: 'FILE' | 'DIR' | 'LINK' | 'MISSING';
  error?: string;
}

/**
 * 親ディレクトリ listing から対象ファイルのメタデータを抽出
 * (size() は SIZE コマンド使用、modifiedAt は MDTM 使用 — 環境依存があるため list 経由で取得)
 */
async function probeViaList(
  client: Client,
  parentDir: string,
  fileName: string,
  fullPath: string,
): Promise<FileProbe> {
  try {
    const list = await client.list(parentDir);
    const entry = list.find((e) => e.name === fileName);
    if (!entry) {
      return { path: fullPath, exists: false, size: null, modifiedAt: null, type: 'MISSING' };
    }
    const type =
      entry.type === 2 ? 'DIR' : entry.type === 3 ? 'LINK' : 'FILE';
    return {
      path: fullPath,
      exists: true,
      size: entry.size ?? null,
      modifiedAt: entry.modifiedAt instanceof Date ? entry.modifiedAt : null,
      type,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      path: fullPath,
      exists: false,
      size: null,
      modifiedAt: null,
      type: 'MISSING',
      error: msg,
    };
  }
}

interface SlugProbe {
  slug: string;
  baseDir: string;
  index: FileProbe;
  hero: FileProbe;
  body: FileProbe;
  summary: FileProbe;
  parentListed: boolean;
  imagesListed: boolean;
}

async function probeSlug(client: Client, slug: string): Promise<SlugProbe> {
  const baseDir = `/spiritual/column/${slug}/`;
  const imagesDir = `${baseDir}images/`;

  // 親ディレクトリ確認
  let parentListed = false;
  try {
    await client.list(baseDir);
    parentListed = true;
  } catch {
    parentListed = false;
  }

  // images/ ディレクトリ確認
  let imagesListed = false;
  try {
    await client.list(imagesDir);
    imagesListed = true;
  } catch {
    imagesListed = false;
  }

  const index = await probeViaList(client, baseDir, 'index.html', `${baseDir}index.html`);
  const hero = imagesListed
    ? await probeViaList(client, imagesDir, 'hero.jpg', `${imagesDir}hero.jpg`)
    : {
        path: `${imagesDir}hero.jpg`,
        exists: false,
        size: null,
        modifiedAt: null,
        type: 'MISSING' as const,
        error: 'images/ ディレクトリが存在しない',
      };
  const body = imagesListed
    ? await probeViaList(client, imagesDir, 'body.jpg', `${imagesDir}body.jpg`)
    : {
        path: `${imagesDir}body.jpg`,
        exists: false,
        size: null,
        modifiedAt: null,
        type: 'MISSING' as const,
        error: 'images/ ディレクトリが存在しない',
      };
  const summary = imagesListed
    ? await probeViaList(client, imagesDir, 'summary.jpg', `${imagesDir}summary.jpg`)
    : {
        path: `${imagesDir}summary.jpg`,
        exists: false,
        size: null,
        modifiedAt: null,
        type: 'MISSING' as const,
        error: 'images/ ディレクトリが存在しない',
      };

  return { slug, baseDir, index, hero, body, summary, parentListed, imagesListed };
}

function fmtSize(n: number | null): string {
  if (n === null) return '-';
  return String(n);
}
function fmtDate(d: Date | null): string {
  if (!d) return '-';
  return d.toISOString();
}
function fmtProbe(p: FileProbe): string {
  if (!p.exists) return `MISSING${p.error ? ` (${p.error})` : ''}`;
  return `${p.type} size=${fmtSize(p.size)} mtime=${fmtDate(p.modifiedAt)}`;
}

async function main(): Promise<void> {
  const env = readEnv();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Stuck Articles FTP 状態診断 (read-only)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`HOST: ${env.host}`);
  console.log(`USER: ${maskUser(env.user)}`);
  console.log(`PORT: ${env.port}`);
  console.log('');

  const client = new Client(15_000);
  client.ftp.verbose = false;

  const slugs = ['law-of-attraction', 'healing'];
  const results: SlugProbe[] = [];

  try {
    console.log('[1] 接続試行 ...');
    await client.access({
      host: env.host,
      user: env.user,
      password: env.password,
      port: env.port,
      secure: false,
    });
    console.log('    OK: 接続成功');
    console.log('');

    for (const slug of slugs) {
      console.log(`[2] /spiritual/column/${slug}/ を診断中 ...`);
      const r = await probeSlug(client, slug);
      results.push(r);
      console.log(`    parent dir         : ${r.parentListed ? 'OK' : 'NOT FOUND'}`);
      console.log(`    images/ dir        : ${r.imagesListed ? 'OK' : 'NOT FOUND'}`);
      console.log(`    index.html         : ${fmtProbe(r.index)}`);
      console.log(`    images/hero.jpg    : ${fmtProbe(r.hero)}`);
      console.log(`    images/body.jpg    : ${fmtProbe(r.body)}`);
      console.log(`    images/summary.jpg : ${fmtProbe(r.summary)}`);
      console.log('');
    }

    // サマリ表
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('サマリ (size byte / mtime ISO):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    for (const r of results) {
      console.log(`▼ ${r.slug}`);
      console.log(`  index.html        : ${r.index.exists ? `${fmtSize(r.index.size)}B  ${fmtDate(r.index.modifiedAt)}` : 'MISSING'}`);
      console.log(`  images/hero.jpg   : ${r.hero.exists ? `${fmtSize(r.hero.size)}B  ${fmtDate(r.hero.modifiedAt)}` : 'MISSING'}`);
      console.log(`  images/body.jpg   : ${r.body.exists ? `${fmtSize(r.body.size)}B  ${fmtDate(r.body.modifiedAt)}` : 'MISSING'}`);
      console.log(`  images/summary.jpg: ${r.summary.exists ? `${fmtSize(r.summary.size)}B  ${fmtDate(r.summary.modifiedAt)}` : 'MISSING'}`);
      console.log('');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('診断完了 (read-only / 書き込みなし)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } catch (err) {
    console.error('!! FTP 接続/診断エラー:');
    if (err instanceof Error) {
      console.error(`   ${err.message}`);
      if (err.stack) console.error(err.stack.split('\n').slice(0, 5).join('\n'));
    } else {
      console.error(`   ${String(err)}`);
    }
    process.exitCode = 1;
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error('!! 予期しない例外:', err);
  process.exit(1);
});
