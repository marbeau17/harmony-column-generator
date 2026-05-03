import * as fs from 'fs';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data } = await sb.from('articles').select('id,article_number,title,image_files,image_prompts,stage2_body_html').ilike('title', '%ヒーリングと探し求め%').limit(3);
  for (const a of data ?? []) {
    console.log(`#${a.article_number} ${a.id} | ${a.title}`);
    console.log('  image_files:', JSON.stringify(a.image_files, null, 2).slice(0, 600));
    const body = (a.stage2_body_html as string) ?? '';
    // <img タグを抽出
    const imgs = body.match(/<img[^>]+>/g) ?? [];
    console.log(`  <img> tags in body: ${imgs.length}`);
    imgs.forEach((m, i) => console.log(`    [${i}] ${m.slice(0, 150)}`));
  }
})();
