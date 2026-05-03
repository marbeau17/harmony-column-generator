import * as fs from 'fs';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const id = 'a25deb83-a67f-4ad8-91bc-3eef26ac474a';
  const { data } = await sb.from('articles').select('stage1_outline').eq('id',id).maybeSingle();
  const o = data?.stage1_outline as Record<string, unknown>;
  console.log('keys:', Object.keys(o || {}));
  console.log('headings:', !!o?.headings, '| h2_chapters:', !!o?.h2_chapters, '| image_prompts:', !!o?.image_prompts);
  if (o?.h2_chapters) console.log('h2_chapters head:', JSON.stringify(o.h2_chapters).slice(0,400));
  if (o?.image_prompts) console.log('image_prompts in outline:', JSON.stringify(o.image_prompts).slice(0,300));
})();
