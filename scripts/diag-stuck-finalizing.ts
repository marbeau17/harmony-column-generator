import * as fs from 'fs';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const ARTICLE_ID = '1a87b046-d316-4ea9-badf-9f46ec806de3';
const JOB_ID = '9e0421c7-f766-4ba6-916d-0857bc076b1c';

(async () => {
  const { data: art } = await sb
    .from('articles')
    .select('id,title,status,image_files,image_prompts,stage1_image_prompts,stage2_body_html,stage3_final_html,published_html,ai_generation_log,created_at,updated_at')
    .eq('id', ARTICLE_ID)
    .single();

  if (art) {
    console.log('=== Article summary ===');
    console.log(JSON.stringify({
      id: art.id,
      title: art.title,
      status: art.status,
      created_at: art.created_at,
      updated_at: art.updated_at,
      image_files: art.image_files,
      image_prompts_keys: art.image_prompts ? Object.keys(art.image_prompts) : null,
      stage1_image_prompts: art.stage1_image_prompts,
      stage2_body_html_len: art.stage2_body_html ? String(art.stage2_body_html).length : 0,
      stage3_final_html_len: art.stage3_final_html ? String(art.stage3_final_html).length : 0,
      published_html_len: art.published_html ? String(art.published_html).length : 0,
    }, null, 2));

    if (art.ai_generation_log) {
      console.log('\n=== ai_generation_log (last 30 entries) ===');
      const log = art.ai_generation_log;
      if (Array.isArray(log)) {
        console.log(JSON.stringify(log.slice(-30), null, 2));
      } else if (typeof log === 'object') {
        console.log(JSON.stringify(log, null, 2).slice(0, 6000));
      } else {
        console.log(String(log).slice(-3000));
      }
    }
  }

  // article_revisions の中身も見る
  const { data: revs } = await sb
    .from('article_revisions')
    .select('*')
    .eq('article_id', ARTICLE_ID)
    .order('created_at', { ascending: false })
    .limit(5);
  console.log('\n=== article_revisions (latest 5) ===');
  if (revs) {
    for (const r of revs) {
      console.log({
        id: r.id,
        created_at: r.created_at,
        keys: Object.keys(r),
        stage: (r as any).stage,
        reason: (r as any).reason,
        body_html_len: (r as any).body_html ? String((r as any).body_html).length : 0,
      });
    }
  }
})();
