import * as fs from 'fs';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data } = await sb.from('articles').select('stage2_body_html,stage3_final_html').eq('article_number',82).maybeSingle();
  const s2 = (data?.stage2_body_html as string)?.length ?? 0;
  const s3 = (data?.stage3_final_html as string)?.length ?? 0;
  console.log(`stage2: ${s2} chars`);
  console.log(`stage3: ${s3} chars`);
  console.log('stage3 head 300:', (data?.stage3_final_html as string)?.slice(0, 300));
  console.log('---');
  console.log('stage2 head 300:', (data?.stage2_body_html as string)?.slice(0, 300));
})();
