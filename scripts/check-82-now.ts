import * as fs from 'fs';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data } = await sb.from('articles').select('stage2_body_html,stage3_final_html,quality_overrides,keyword').eq('article_number',82).maybeSingle();
  const s2 = (data?.stage2_body_html as string) ?? '';
  console.log('stage2 chars:', s2.length);
  console.log('stage2 contains <header>?:', s2.includes('<header'));
  console.log('stage2 contains <nav>?:', s2.includes('<nav'));
  console.log('stage2 contains DOCTYPE?:', s2.includes('DOCTYPE'));
  console.log('stage2 contains "トップ"?:', s2.includes('トップ'));
  console.log('keyword:', data?.keyword);
  console.log('overrides:', JSON.stringify(data?.quality_overrides ?? []));
})();
