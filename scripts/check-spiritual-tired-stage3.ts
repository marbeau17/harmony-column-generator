/**
 * spiritual-tired-let-go の stage3 と Storage 上の画像状況確認。
 */
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envContent = fs.readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) {
    const k = m[1].trim();
    const v = m[2].trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

(async () => {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await sb
    .from('articles')
    .select('id, slug, stage3_final_html, image_files')
    .eq('slug', 'spiritual-tired-let-go')
    .maybeSingle();
  if (error || !data) {
    console.error(error ?? 'not found');
    process.exit(1);
  }

  const s3: string = data.stage3_final_html ?? '';
  const id = data.id;

  // <img> タグのsrcを抽出
  const imgMatches = [...s3.matchAll(/<img[^>]*src="([^"]+)"[^>]*>/g)];
  console.log('=== stage3 <img> tags ===');
  for (const m of imgMatches) {
    console.log('  -', m[1]);
  }

  console.log(`\n=== Storage list under articles/${id}/ ===`);
  const { data: files, error: lsErr } = await sb.storage
    .from('article-images')
    .list(`articles/${id}`, { limit: 100 });
  if (lsErr) {
    console.error('list err:', lsErr);
  } else {
    for (const f of files ?? []) {
      console.log('  -', f.name, 'size=', (f.metadata as Record<string, unknown> | null)?.size);
    }
  }

  // image_files に登録された url の HEAD 確認
  console.log('\n=== image_files URL HEAD check ===');
  if (Array.isArray(data.image_files)) {
    for (const f of data.image_files as Array<Record<string, string>>) {
      try {
        const r = await fetch(f.url, { method: 'HEAD' });
        console.log(`  ${f.position} -> ${r.status} ${r.statusText} (${f.url})`);
      } catch (e) {
        console.log(`  ${f.position} -> ERROR ${(e as Error).message}`);
      }
    }
  }
})();
