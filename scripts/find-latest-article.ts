import * as fs from 'fs';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data } = await sb.from('articles')
    .select('id,article_number,title,generation_mode,created_at,image_files,stage2_body_html,stage3_final_html,meta_description')
    .eq('generation_mode','zero')
    .order('created_at', { ascending: false })
    .limit(5);
  for (const a of data ?? []) {
    const s2 = (a.stage2_body_html as string|null)?.length ?? 0;
    const s3 = (a.stage3_final_html as string|null)?.length ?? 0;
    const imgs = Array.isArray(a.image_files) ? (a.image_files as any[]).length : 0;
    const meta = (a.meta_description as string|null)?.length ?? 0;
    console.log(`#${a.article_number} ${a.id} | ${a.created_at?.slice(0,16)}`);
    console.log(`  s2=${s2} s3=${s3} imgs=${imgs} meta=${meta} | ${a.title?.slice(0,50)}`);
  }
})();
