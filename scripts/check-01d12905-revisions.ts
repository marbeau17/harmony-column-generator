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

function htmlToText(html: string | null | undefined): number {
  if (!html) return 0;
  // strip tags + decode minimal entities + collapse whitespace
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return [...text].length;
}

(async () => {
  const id = '01d12905-8c43-49c5-aeae-68c797b07dad';

  // Try both common column names
  const { data, error } = await sb
    .from('article_revisions')
    .select('*')
    .eq('article_id', id)
    .order('revision_number', { ascending: true });

  if (error) {
    console.log('ERROR:', error.message);
    return;
  }
  if (!data || data.length === 0) {
    console.log('NO REVISIONS for', id);
    return;
  }

  console.log('Total revisions:', data.length);
  console.log('Columns:', Object.keys(data[0]).join(', '));
  console.log('');
  console.log('| rev_number | created_at | text 文字数 | change_type |');
  console.log('|---:|---|---:|---|');

  for (const r of data) {
    const html =
      r.html_snapshot ?? r.body_html ?? r.snapshot_html ?? r.content_html ?? r.html ?? '';
    const len = htmlToText(html);
    const rev = r.revision_number ?? r.rev_number ?? r.version ?? '?';
    const created = r.created_at ?? r.recorded_at ?? '?';
    const ct = r.change_type ?? r.reason ?? r.kind ?? r.action ?? '';
    console.log(`| ${rev} | ${created} | ${len} | ${ct} |`);
  }

  // shrink detection
  const lens = data.map((r: any) => ({
    rev: r.revision_number ?? r.rev_number ?? r.version,
    len: htmlToText(r.html_snapshot ?? r.body_html ?? r.snapshot_html ?? r.content_html ?? r.html ?? ''),
  }));
  console.log('');
  for (let i = 1; i < lens.length; i++) {
    if (lens[i].len < lens[i - 1].len) {
      console.log(
        `SHRUNK: rev ${lens[i - 1].rev} (${lens[i - 1].len}) -> rev ${lens[i].rev} (${lens[i].len}) delta=${lens[i].len - lens[i - 1].len}`,
      );
    }
  }
})();
