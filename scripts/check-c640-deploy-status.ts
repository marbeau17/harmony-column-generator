import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

(async () => {
  const id = 'c640b96d-1573-406a-8a0a-87a386afd485';
  const { data, error } = await sb
    .from('articles')
    .select('id, title, slug, status, reviewed_at, image_files, stage2_body_html, stage3_final_html, published_html')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) {
    console.error('not found', error);
    process.exit(1);
  }
  console.log('id:', data.id);
  console.log('title:', data.title);
  console.log('slug:', data.slug);
  console.log('status:', data.status);
  console.log('reviewed_at:', data.reviewed_at);
  console.log('image_files:', Array.isArray(data.image_files) ? (data.image_files as unknown[]).length : 'n/a');
  console.log('stage2_body_html chars:', (data.stage2_body_html as string | null)?.length ?? 0);
  console.log('stage3_final_html chars:', (data.stage3_final_html as string | null)?.length ?? 0);
  console.log('published_html chars:', (data.published_html as string | null)?.length ?? 0);
})();
