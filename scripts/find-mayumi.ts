import * as fs from 'fs';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data } = await sb.from('articles')
    .select('id,article_number,title,persona,theme,image_prompts,image_files,stage3_final_html,meta_description,created_at')
    .eq('generation_mode','zero').eq('persona','真由美')
    .order('created_at', { ascending: false }).limit(5);
  for (const a of data ?? []) {
    const imgs = Array.isArray(a.image_files) ? (a.image_files as any[]).length : 0;
    const ipc = Array.isArray(a.image_prompts) ? (a.image_prompts as any[]).length : 0;
    const s3 = (a.stage3_final_html as string|null)?.length ?? 0;
    const meta = (a.meta_description as string|null)?.length ?? 0;
    console.log(`#${a.article_number} ${a.id} ${a.created_at?.slice(0,16)}`);
    console.log(`  theme=${a.theme} | imgs=${imgs} | column.image_prompts=${ipc} | s3=${s3} | meta=${meta}`);
    console.log(`  title: ${a.title?.slice(0,60)}`);
  }
})();
