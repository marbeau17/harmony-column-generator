/**
 * 本番公開記事の表示文字数 baseline 測定 (read-only)
 *
 * 1) DB から visibility_state IN ('live','live_hub_stale') の slug を取得
 * 2) 各 https://harmony-mc.com/spiritual/column/{slug}/index.html を curl
 * 3) <main class="mainSection">…</main> 内テキストを抽出 → 文字数算出
 * 4) min/max/median/average + 短い順 5 件 + law-of-attraction 順位を出力
 */
import * as fs from 'fs';
import * as cp from 'child_process';
import { createClient } from '@supabase/supabase-js';

// .env.local 読込
const env = fs.readFileSync('/Users/yasudaosamu/Desktop/codes/blogauto/.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/** <main class="mainSection">…</main> の中身だけを抽出 (無ければ null) */
function extractMainSection(html: string): string | null {
  // class 属性に mainSection を含む <main ...> を貪欲に拾う
  const m = html.match(
    /<main\b[^>]*\bclass=("[^"]*mainSection[^"]*"|'[^']*mainSection[^']*')[^>]*>([\s\S]*?)<\/main>/i,
  );
  if (!m) return null;
  return m[2];
}

/** HTML タグ除去 → plain text 文字数 (Unicode コードポイント数) */
function htmlToPlainLength(html: string): number {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const noTags = stripped.replace(/<[^>]+>/g, '');
  const decoded = noTags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  const compact = decoded.replace(/\s+/g, ' ').trim();
  return Array.from(compact).length;
}

/** curl で URL 取得 (タイムアウト 20s, リトライなし) */
function curlGet(url: string): { status: number; body: string } {
  // -s: silent, -L: follow redirects, -w でステータス末尾付与
  const out = cp.spawnSync(
    'curl',
    ['-sSL', '--max-time', '20', '-w', '\n__HTTP_STATUS__%{http_code}', url],
    { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 },
  );
  if (out.status !== 0) {
    return { status: 0, body: out.stderr || '' };
  }
  const stdout = out.stdout || '';
  const m = stdout.match(/\n__HTTP_STATUS__(\d+)$/);
  if (!m) return { status: 0, body: stdout };
  const status = Number(m[1]);
  const body = stdout.slice(0, m.index!);
  return { status, body };
}

(async () => {
  const { data, error } = await sb
    .from('articles')
    .select('id, slug, visibility_state')
    .in('visibility_state', ['live', 'live_hub_stale'])
    .order('slug', { ascending: true });
  if (error) {
    console.error('SELECT error:', error);
    process.exit(1);
  }
  if (!data || data.length === 0) {
    console.log('NO DATA');
    return;
  }

  console.log(`# 本番公開記事 文字数 baseline (DB件数: ${data.length})\n`);

  type Row = {
    slug: string;
    state: string;
    status: number;
    found: boolean;
    chars: number;
    note?: string;
  };
  const rows: Row[] = [];

  // 並列度 8 で fetch
  const concurrency = 8;
  let idx = 0;
  async function worker() {
    while (idx < data.length) {
      const i = idx++;
      const a = data[i] as { slug: string; visibility_state: string };
      const url = `https://harmony-mc.com/spiritual/column/${a.slug}/index.html`;
      const { status, body } = curlGet(url);
      if (status !== 200) {
        rows.push({
          slug: a.slug,
          state: a.visibility_state,
          status,
          found: false,
          chars: 0,
          note: `HTTP ${status}`,
        });
        continue;
      }
      const main = extractMainSection(body);
      if (!main) {
        rows.push({
          slug: a.slug,
          state: a.visibility_state,
          status,
          found: false,
          chars: 0,
          note: 'mainSection not found',
        });
        continue;
      }
      const chars = htmlToPlainLength(main);
      rows.push({ slug: a.slug, state: a.visibility_state, status, found: true, chars });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  // slug 順に整列して全件出力
  rows.sort((a, b) => a.slug.localeCompare(b.slug));
  console.log('## 全件 (slug 昇順)');
  console.log('idx | slug                                     | status | chars | state            | note');
  console.log('----+------------------------------------------+--------+-------+------------------+----------------');
  rows.forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(3)} | ${r.slug.slice(0, 40).padEnd(40)} | ${String(r.status).padStart(6)} | ${String(r.chars).padStart(5)} | ${r.state.padEnd(16)} | ${r.note ?? ''}`,
    );
  });

  // 統計 (取得成功かつ chars>0 のものだけ)
  const ok = rows.filter((r) => r.found && r.chars > 0).map((r) => r.chars).sort((a, b) => a - b);
  const okRows = rows.filter((r) => r.found && r.chars > 0).slice().sort((a, b) => a.chars - b.chars);

  function median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
  }

  const min = ok.length ? ok[0] : 0;
  const max = ok.length ? ok[ok.length - 1] : 0;
  const med = median(ok);
  const avg = ok.length ? Math.round(ok.reduce((s, n) => s + n, 0) / ok.length) : 0;

  console.log('\n## 文字数分布 (mainSection 内 plain text)');
  console.log(`- 取得成功: ${ok.length} / ${rows.length}`);
  console.log(`- min:    ${min}`);
  console.log(`- max:    ${max}`);
  console.log(`- median: ${med}`);
  console.log(`- avg:    ${avg}`);

  console.log('\n## 短い順 TOP 5');
  okRows.slice(0, 5).forEach((r, i) => {
    console.log(`${i + 1}. ${r.slug} — ${r.chars} 文字`);
  });

  // law-of-attraction の順位 (短い順)
  console.log('\n## law-of-attraction 順位 (短い順)');
  const law = okRows.findIndex((r) => r.slug === 'law-of-attraction');
  if (law === -1) {
    const miss = rows.find((r) => r.slug === 'law-of-attraction');
    console.log(`(取得対象に無し or 抽出失敗: ${miss ? JSON.stringify(miss) : 'slug 自体が DB に無い'})`);
  } else {
    const r = okRows[law];
    console.log(`順位: ${law + 1} / ${okRows.length}  chars=${r.chars}`);
  }

  // エラー一覧
  const errs = rows.filter((r) => !r.found);
  if (errs.length) {
    console.log('\n## 取得失敗 / mainSection 抽出失敗');
    errs.forEach((r) => console.log(`- ${r.slug}: ${r.note}`));
  }
})();
