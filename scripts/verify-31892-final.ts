import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data } = await sb.from('articles').select('id,article_number,title,slug,seo_filename,status,is_hub_visible,stage2_body_html,stage3_final_html,meta_description,reviewed_at,hallucination_score,yukiko_tone_score,image_files,image_prompts').eq('id','31892969-8215-42c2-8ad7-07135edf2766').maybeSingle();
  if (!data) return;
  const s2 = (data.stage2_body_html as string|null)?.length ?? 0;
  const s3 = (data.stage3_final_html as string|null)?.length ?? 0;
  console.log('id:', data.id);
  console.log('article_number:', data.article_number);
  console.log('title:', data.title);
  console.log('slug (preserved):', data.slug);
  console.log('seo_filename:', data.seo_filename);
  console.log('status:', data.status);
  console.log('is_hub_visible:', data.is_hub_visible);
  console.log('stage2_body_html:', s2, 'chars');
  console.log('stage3_final_html:', s3, 'chars');
  console.log('meta_description:', (data.meta_description as string|null)?.length, 'chars');
  console.log('reviewed_at:', data.reviewed_at);
  console.log('hallucination_score:', data.hallucination_score);
  console.log('yukiko_tone_score:', data.yukiko_tone_score);
  console.log('image_files count:', Array.isArray(data.image_files) ? (data.image_files as any[]).length : 0);
  console.log('image_prompts shape:', Array.isArray(data.image_prompts) ? `array(${(data.image_prompts as any[]).length})` : `object(${Object.keys(data.image_prompts as object).join(',')})`);
  console.log('\nstage2 head:', (data.stage2_body_html as string).slice(0,200));
  console.log('\nstage3 head:', (data.stage3_final_html as string).slice(0,300));
  // revisions
  const { data: revs } = await sb.from('article_revisions').select('revision_number,change_type,created_at').eq('article_id','31892969-8215-42c2-8ad7-07135edf2766').order('revision_number');
  console.log('\nrevisions:', JSON.stringify(revs, null, 2));
})();
