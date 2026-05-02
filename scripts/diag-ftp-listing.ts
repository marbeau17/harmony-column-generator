/**
 * P5-43 補助: FTP 接続診断 (read-only)
 *
 * .env.local の FTP_HOST/USER/PASSWORD/REMOTE_PATH を使い、
 * 1. 接続できるか
 * 2. REMOTE_PATH ディレクトリが存在するか
 * 3. その配下にどんなファイル/ディレクトリがあるか
 * を出力する。書き込み一切なし。
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
  remotePath: string;
}

function readEnv(): FtpEnv {
  const host = process.env.FTP_HOST;
  const user = process.env.FTP_USER;
  const password = process.env.FTP_PASSWORD;
  const remotePath = process.env.FTP_REMOTE_PATH || '/spiritual/column/';
  const port = process.env.FTP_PORT ? parseInt(process.env.FTP_PORT, 10) : 21;

  if (!host || !user || !password) {
    throw new Error(
      'FTP_HOST / FTP_USER / FTP_PASSWORD がいずれも未設定です (.env.local を確認)',
    );
  }
  return { host, user, password, port, remotePath };
}

function maskUser(user: string): string {
  if (user.length <= 2) return '*'.repeat(user.length);
  return user[0] + '*'.repeat(Math.max(1, user.length - 2)) + user.slice(-1);
}

function fmtEntry(e: { name: string; type: number; size: number; modifiedAt?: Date }): string {
  // basic-ftp FileType: 1=File, 2=Directory, 3=SymbolicLink
  const kind = e.type === 2 ? 'DIR ' : e.type === 3 ? 'LINK' : 'FILE';
  const size = e.type === 2 ? '-' : String(e.size);
  const mtime = e.modifiedAt instanceof Date ? e.modifiedAt.toISOString() : '';
  return `  ${kind}  ${size.padStart(10)}  ${mtime.padEnd(24)}  ${e.name}`;
}

async function main(): Promise<void> {
  const env = readEnv();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('FTP 接続診断 (read-only)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`HOST       : ${env.host}`);
  console.log(`USER       : ${maskUser(env.user)}`);
  console.log(`PORT       : ${env.port}`);
  console.log(`REMOTE_PATH: ${env.remotePath}`);
  console.log('');

  const client = new Client(15_000);
  client.ftp.verbose = false;

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

    // ルート一覧
    console.log('[2] ルート (/) のエントリ一覧:');
    try {
      const rootList = await client.list('/');
      if (rootList.length === 0) {
        console.log('    (空)');
      } else {
        for (const e of rootList) console.log(fmtEntry(e));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`    !! list('/') 失敗: ${msg}`);
    }
    console.log('');

    // REMOTE_PATH の存在確認 + 一覧
    console.log(`[3] REMOTE_PATH (${env.remotePath}) のエントリ一覧:`);
    let remoteListed = false;
    let remoteEntries: { name: string; type: number; size: number; modifiedAt?: Date }[] = [];
    try {
      remoteEntries = await client.list(env.remotePath);
      remoteListed = true;
      if (remoteEntries.length === 0) {
        console.log('    (空ディレクトリ)');
      } else {
        for (const e of remoteEntries) console.log(fmtEntry(e));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`    !! list('${env.remotePath}') 失敗: ${msg}`);
      console.log('    → ディレクトリが存在しないか、アクセス権がない可能性');
    }
    console.log('');

    // 重要ファイル/ディレクトリ判定
    if (remoteListed) {
      console.log('[4] 公開先サイン検出:');
      const names = remoteEntries.map((e) => e.name);
      const hasIndex = names.includes('index.html');
      const healingEntry = remoteEntries.find((e) => e.name === 'healing' && e.type === 2);
      const columnsEntry = remoteEntries.find((e) => e.name === 'columns' && e.type === 2);
      console.log(`    index.html  : ${hasIndex ? 'あり (公開先トップ?)' : 'なし'}`);
      console.log(`    healing/    : ${healingEntry ? 'あり (記事配置先?)' : 'なし'}`);
      console.log(`    columns/    : ${columnsEntry ? 'あり (記事配置先?)' : 'なし'}`);
      console.log('');

      // healing/ または columns/ があれば1階層下も覗く
      for (const sub of [healingEntry, columnsEntry].filter((x) => x !== undefined) as Array<{
        name: string;
      }>) {
        const subPath = env.remotePath.replace(/\/$/, '') + '/' + sub.name + '/';
        console.log(`[5] サブディレクトリ ${subPath} の先頭20件:`);
        try {
          const subList = await client.list(subPath);
          const top = subList.slice(0, 20);
          if (top.length === 0) {
            console.log('    (空)');
          } else {
            for (const e of top) console.log(fmtEntry(e));
            if (subList.length > 20) {
              console.log(`    ... (+${subList.length - 20} 件)`);
            }
          }
          console.log(`    合計: ${subList.length} エントリ`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`    !! list 失敗: ${msg}`);
        }
        console.log('');
      }
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
