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

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMain(html: string): string {
  const m = html.match(/<main\b[^>]*class="[^"]*mainSection[^"]*"[^>]*>([\s\S]*?)<\/main>/i);
  if (m) return m[1];
  const m2 = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (m2) return m2[1];
  return '';
}

(async () => {
  const slugs = ['law-of-attraction', 'healing'];
  const rows: Array<{ slug: string; s2: number; s3main: number; diff: number }> = [];

  for (const slug of slugs) {
    const { data, error } = await sb
      .from('articles')
      .select('id, title, slug, stage2_body_html, stage3_final_html')
      .eq('slug', slug)
      .maybeSingle();
    if (error) {
      console.log(`[${slug}] ERROR:`, error.message);
      continue;
    }
    if (!data) {
      console.log(`[${slug}] NOT FOUND`);
      continue;
    }

    const s2 = (data.stage2_body_html as string | null) ?? '';
    const s3 = (data.stage3_final_html as string | null) ?? '';
    const s3main = extractMain(s3);

    const s2text = stripTags(s2);
    const s3maintext = stripTags(s3main);

    console.log(`\n=== ${slug} (id=${data.id}) ===`);
    console.log(`stage2_body_html raw length     : ${s2.length}`);
    console.log(`stage2 plain text chars         : ${s2text.length}`);
    console.log(`stage3_final_html raw length    : ${s3.length}`);
    console.log(`stage3 <main mainSection> raw   : ${s3main.length}`);
    console.log(`stage3 main plain text chars    : ${s3maintext.length}`);
    console.log(`diff (s3main - s2)              : ${s3maintext.length - s2text.length}`);

    console.log(`\n--- stage2 plain text first 200 ---`);
    console.log(s2text.slice(0, 200));
    console.log(`\n--- stage3 main plain text first 200 ---`);
    console.log(s3maintext.slice(0, 200));
    console.log(`\n--- stage3 main plain text last 200 ---`);
    console.log(s3maintext.slice(-200));

    rows.push({
      slug,
      s2: s2text.length,
      s3main: s3maintext.length,
      diff: s3maintext.length - s2text.length,
    });
  }

  console.log('\n\n=== SUMMARY ===');
  console.log('| slug | stage2 chars | stage3-main chars | diff |');
  console.log('|---|---|---|---|');
  for (const r of rows) {
    console.log(`| ${r.slug} | ${r.s2} | ${r.s3main} | ${r.diff} |`);
  }
})();
