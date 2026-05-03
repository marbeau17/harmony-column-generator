/**
 * 公開記事 (visibility_state IN ('live','live_hub_stale')) の本文文字数診断
 * read-only。stage2_body_html / stage3_final_html を plain text 化して文字数比較。
 */
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/** HTML タグ除去 → plain text 文字数算出 (空白圧縮) */
function htmlToPlainLength(html: string | null | undefined): number {
  if (!html) return 0;
  // script / style ブロックを除去
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  // タグ除去
  const noTags = stripped.replace(/<[^>]+>/g, '');
  // HTML エンティティ簡易デコード
  const decoded = noTags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // 連続空白圧縮 + trim
  const compact = decoded.replace(/\s+/g, ' ').trim();
  // Array.from で正しく Unicode コードポイント数 (emoji/CJK サロゲート対応)
  return Array.from(compact).length;
}

(async () => {
  const { data, error } = await sb
    .from('articles')
    .select('id, slug, title, target_word_count, visibility_state, stage2_body_html, stage3_final_html')
    .in('visibility_state', ['live', 'live_hub_stale'])
    .order('slug', { ascending: true });

  if (error) {
    console.error('SELECT error:', error);
    process.exit(1);
  }
  if (!data) {
    console.log('NO DATA');
    return;
  }

  console.log(`# 公開記事 文字数診断 (件数: ${data.length})\n`);

  // ヘッダ
  const head = ['slug', 'target', 'stage2', 'stage3', 'state'];
  const widths = [40, 7, 7, 7, 16];
  const fmt = (cols: string[]) =>
    cols.map((c, i) => c.padEnd(widths[i])).join(' | ');
  console.log(fmt(head));
  console.log(widths.map((w) => '-'.repeat(w)).join('-+-'));

  type Row = {
    slug: string;
    target: number | null;
    s2: number;
    s3: number;
    state: string;
  };
  const rows: Row[] = [];

  for (const a of data as Array<{
    slug: string;
    target_word_count: number | null;
    visibility_state: string;
    stage2_body_html: string | null;
    stage3_final_html: string | null;
  }>) {
    const s2 = htmlToPlainLength(a.stage2_body_html);
    const s3 = htmlToPlainLength(a.stage3_final_html);
    rows.push({
      slug: a.slug,
      target: a.target_word_count ?? null,
      s2,
      s3,
      state: a.visibility_state,
    });
    console.log(
      fmt([
        (a.slug ?? '').slice(0, 40),
        String(a.target_word_count ?? '-'),
        String(s2),
        String(s3),
        a.visibility_state,
      ]),
    );
  }

  // law-of-attraction を強調表示
  console.log('\n## law-of-attraction 詳細');
  const law = rows.find((r) => r.slug === 'law-of-attraction');
  if (law) {
    console.log(JSON.stringify(law, null, 2));
  } else {
    console.log('(law-of-attraction は live でない)');
  }

  // target の半分以下の記事 (stage3 ベース、target が null でないもの)
  console.log('\n## 低文字数記事 (stage3 が target の半分以下)');
  const low = rows.filter(
    (r) => r.target != null && r.s3 > 0 && r.s3 <= r.target / 2,
  );
  if (low.length === 0) {
    console.log('(該当なし)');
  } else {
    for (const r of low) {
      console.log(
        `- ${r.slug}: stage3=${r.s3} / target=${r.target} (${Math.round((r.s3 / r.target!) * 100)}%)`,
      );
    }
  }

  // stage3 が空(0)で stage2 はある記事
  console.log('\n## stage3 空 / stage2 あり');
  const onlyS2 = rows.filter((r) => r.s3 === 0 && r.s2 > 0);
  if (onlyS2.length === 0) {
    console.log('(該当なし)');
  } else {
    for (const r of onlyS2) {
      console.log(`- ${r.slug}: stage2=${r.s2}, stage3=0`);
    }
  }
})();
