import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data } = await sb.from('articles').select('id,article_number,title,image_prompts,image_files').not('image_prompts','is',null).order('created_at',{ascending:false});
  if (!data) return;
  let needGen = 0, hasImg = 0;
  for (const a of data) {
    const files = a.image_files as any[] | null;
    if (!files || files.length === 0) needGen++;
    else hasImg++;
  }
  console.log(`総記事数 (image_prompts あり): ${data.length}`);
  console.log(`画像生成済: ${hasImg} 件`);
  console.log(`画像未生成 (バッチ対象): ${needGen} 件`);
  console.log('\n=== 画像未生成記事の先頭 5 件 ===');
  let count = 0;
  for (const a of data) {
    const files = a.image_files as any[] | null;
    if (!files || files.length === 0) {
      const promptCount = Array.isArray(a.image_prompts) ? (a.image_prompts as any[]).length : Object.keys(a.image_prompts ?? {}).length;
      console.log(`#${a.article_number} ${a.id} | prompts=${promptCount} | ${a.title?.slice(0,40) ?? ''}`);
      if (++count >= 5) break;
    }
  }
})();
