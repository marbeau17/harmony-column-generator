import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data } = await sb.from('articles').select('id,title,ai_generation_log,stage1_outline,image_files,image_prompts').eq('id','31892969-8215-42c2-8ad7-07135edf2766').maybeSingle();
  if (!data) { console.log('NOT FOUND'); return; }
  console.log('=== ai_generation_log ===');
  console.log(data.ai_generation_log);
  console.log('\n=== stage1_outline keys ===');
  console.log(Object.keys(data.stage1_outline as object));
  console.log('\n=== headings preview ===');
  console.log(JSON.stringify((data.stage1_outline as any).headings, null, 2).slice(0, 600));
  console.log('\n=== image_files ===');
  console.log(JSON.stringify(data.image_files, null, 2));
  console.log('\n=== image_prompts (preview) ===');
  console.log(JSON.stringify(data.image_prompts, null, 2).slice(0, 600));
})();
