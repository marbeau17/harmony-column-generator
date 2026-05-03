import * as fs from 'fs';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const id = 'a25deb83-a67f-4ad8-91bc-3eef26ac474a';
  const { data } = await sb.from('articles').select('id,article_number,title,status,generation_mode,stage2_body_html,image_prompts,image_files').eq('id',id).maybeSingle();
  if (!data) { console.log('NOT FOUND'); return; }
  console.log('id:', data.id);
  console.log('article_number:', data.article_number);
  console.log('title:', data.title);
  console.log('status:', data.status);
  console.log('generation_mode:', data.generation_mode);
  console.log('stage2_body_html chars:', (data.stage2_body_html as string|null)?.length ?? 0);
  console.log('image_prompts:', data.image_prompts ? (Array.isArray(data.image_prompts) ? `array(${(data.image_prompts as any[]).length})` : 'object') : 'null');
  console.log('image_files:', Array.isArray(data.image_files) ? `array(${(data.image_files as any[]).length})` : 'null');
  if (data.image_prompts) console.log('image_prompts head:', JSON.stringify(data.image_prompts).slice(0,200));
})();
