/**
 * /column/ パスの状態を read-only で診断 + 既存 /spiritual/column/ の slug 一覧
 */
import { Client } from 'basic-ftp';
import fs from 'fs';
import path from 'path';

try {
  const envFile = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of envFile.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
} catch {}

(async () => {
  const c = new Client();
  c.ftp.verbose = false;
  await c.access({
    host: process.env.FTP_HOST!,
    user: process.env.FTP_USER!,
    password: process.env.FTP_PASSWORD!,
    port: process.env.FTP_PORT ? parseInt(process.env.FTP_PORT, 10) : 21,
  });

  console.log('=== FTP root listing (/) ===');
  try {
    const root = await c.list('/');
    for (const e of root) {
      console.log(`  ${e.type === 2 ? 'DIR ' : 'FILE'} ${e.name} (${e.size}B)`);
    }
  } catch (e) {
    console.error('root list failed:', e);
  }

  console.log('\n=== /column/ exists check ===');
  try {
    const col = await c.list('/column');
    console.log(`  /column/ exists, ${col.length} entries:`);
    for (const e of col.slice(0, 10)) {
      console.log(`    ${e.type === 2 ? 'DIR ' : 'FILE'} ${e.name}`);
    }
    if (col.length > 10) console.log(`    ... 他 ${col.length - 10} 件`);
  } catch (e) {
    console.log('  /column/ does not exist or inaccessible');
  }

  console.log('\n=== /spiritual/column/ slug count ===');
  try {
    const sc = await c.list('/spiritual/column');
    const dirs = sc.filter((e) => e.type === 2);
    console.log(`  /spiritual/column/ has ${dirs.length} directories (article slugs)`);
    for (const d of dirs.slice(0, 5)) {
      const sub = await c.list(`/spiritual/column/${d.name}`);
      const hasIndex = sub.some((s) => s.name === 'index.html');
      console.log(`    ${d.name}/ ${hasIndex ? '✓ has index.html' : '✗ no index.html'}`);
    }
  } catch (e) {
    console.error('spiritual/column list failed:', e);
  }

  c.close();
})();
