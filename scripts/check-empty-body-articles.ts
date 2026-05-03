import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  // 同様の症状の記事 (zero-gen で stage2 が空 or 短い)
  const { data, error } = await sb.from('articles').select('id,title,article_number,status,generation_mode,stage2_body_html,stage3_final_html,is_hub_visible,created_at').eq('generation_mode','zero').order('created_at',{ascending:false}).limit(50);
  if (error) { console.error(error); return; }
  console.log(`Total zero-gen articles: ${data?.length}`);
  console.log('\n=== empty-body zero-gen articles ===');
  for (const a of data || []) {
    const s2 = (a.stage2_body_html as string|null);
    const s3 = (a.stage3_final_html as string|null);
    const s2Len = s2?.length ?? 0;
    const s3Len = s3?.length ?? 0;
    if (s2Len < 1000 && s3Len < 1000) {
      console.log(`#${a.article_number} ${a.id} | ${a.status} | s2=${s2Len} s3=${s3Len} | hub=${a.is_hub_visible} | ${a.title}`);
    }
  }
})();
