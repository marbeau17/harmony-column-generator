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
  const id = '01d12905-8c43-49c5-aeae-68c797b07dad';
  const { data } = await sb
    .from('articles')
    .select('id, title, slug, status, visibility_state, is_hub_visible, reviewed_at, stage3_final_html, stage2_body_html, published_html')
    .eq('id', id)
    .maybeSingle();
  if (!data) {
    console.log('NOT FOUND');
    return;
  }
  console.log('id              :', data.id);
  console.log('title           :', data.title);
  console.log('slug            :', data.slug);
  console.log('status          :', data.status);
  console.log('visibility_state:', data.visibility_state);
  console.log('is_hub_visible  :', data.is_hub_visible);
  console.log('reviewed_at     :', data.reviewed_at);
  console.log('stage2 chars    :', (data.stage2_body_html as string | null)?.length ?? 0);
  console.log('stage3 chars    :', (data.stage3_final_html as string | null)?.length ?? 0);
  console.log('published chars :', (data.published_html as string | null)?.length ?? 0);
})();
