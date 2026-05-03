import * as fs from 'fs';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const id = 'c640b96d-1573-406a-8a0a-87a386afd485';
  const { data } = await sb.from('articles').select('id,article_number,status,quality_overrides').eq('id', id).maybeSingle();
  console.log('id:', data?.id);
  console.log('status:', data?.status);
  console.log('quality_overrides:', JSON.stringify(data?.quality_overrides, null, 2));
})();
