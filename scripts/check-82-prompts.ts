import * as fs from 'fs';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data } = await sb.from('articles').select('image_prompts,stage1_outline').eq('article_number',82).maybeSingle();
  console.log('image_prompts (column):', JSON.stringify(data?.image_prompts, null, 2));
  const o = data?.stage1_outline as Record<string, unknown>;
  console.log('\noutline.image_prompts:', JSON.stringify(o?.image_prompts, null, 2));
})();
