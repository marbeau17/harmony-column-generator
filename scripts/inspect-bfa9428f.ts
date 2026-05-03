import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const id = 'bfa9428f-b7a4-492b-add6-e9f324cdee72';
  const { data } = await sb.from('articles').select('id,article_number,title,status,image_files,image_prompts,stage2_body_html,stage3_final_html').eq('id',id).maybeSingle();
  if (!data) { console.log('NOT FOUND'); return; }
  console.log('id:', data.id, '#', data.article_number);
  console.log('title:', data.title);
  console.log('status:', data.status);
  console.log('image_files type:', typeof data.image_files, Array.isArray(data.image_files) ? `array(${(data.image_files as any[]).length})` : '');
  console.log('image_files:', JSON.stringify(data.image_files, null, 2));
  console.log('image_prompts type:', typeof data.image_prompts);
  console.log('image_prompts head:', JSON.stringify(data.image_prompts).slice(0, 400));
  console.log('stage2 chars:', (data.stage2_body_html as string)?.length ?? 0);
  console.log('stage3 chars:', (data.stage3_final_html as string)?.length ?? 0);
  // body から IMAGE プレースホルダーを抽出
  const body = (data.stage2_body_html as string) || '';
  const matches = body.match(/IMAGE[：:][^<\n]*/g) || [];
  console.log('\n=== IMAGE プレースホルダー ===');
  console.log('count:', matches.length);
  for (const m of matches) console.log(' -', m.slice(0, 150));
})();
