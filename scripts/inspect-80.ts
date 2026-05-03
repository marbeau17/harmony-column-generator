import * as fs from 'fs';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data } = await sb.from('articles').select('id,article_number,title,image_prompts,image_files,stage2_body_html,stage3_final_html,meta_description').eq('article_number',80).maybeSingle();
  if (!data) { console.log('NOT FOUND'); return; }
  console.log('#80 id:', data.id);
  console.log('title:', data.title);
  console.log('image_files:', Array.isArray(data.image_files) ? `array(${(data.image_files as any[]).length})` : data.image_files);
  if (Array.isArray(data.image_files) && (data.image_files as any[]).length > 0) {
    console.log('  first url:', (data.image_files as any[])[0]?.url);
  }
  console.log('image_prompts (column):', Array.isArray(data.image_prompts) ? `array(${(data.image_prompts as any[]).length})` : data.image_prompts);
  console.log('stage2 chars:', (data.stage2_body_html as string|null)?.length ?? 0);
  console.log('stage3 chars:', (data.stage3_final_html as string|null)?.length ?? 0);
  console.log('meta:', (data.meta_description as string|null)?.length ?? 0);

  // 履歴も確認
  const { data: revs } = await sb.from('article_revisions').select('revision_number,change_type,created_at').eq('article_id', data.id).order('revision_number');
  console.log('revisions:', revs);
})();
