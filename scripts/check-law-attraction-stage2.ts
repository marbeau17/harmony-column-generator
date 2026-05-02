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
  const { data } = await sb
    .from('articles')
    .select('id, title, slug, stage2_body_html, stage3_final_html')
    .eq('slug', 'law-of-attraction')
    .maybeSingle();
  if (!data) {
    console.log('NOT FOUND');
    return;
  }
  const s2 = (data.stage2_body_html as string | null) ?? '';
  const s3 = (data.stage3_final_html as string | null) ?? '';
  console.log('stage2 chars:', s2.length);
  console.log('stage2 first 500:');
  console.log(s2.slice(0, 500));
  console.log('---');
  console.log('stage3 chars:', s3.length);
  console.log('stage3 first 500:');
  console.log(s3.slice(0, 500));
  console.log('---');
  console.log('stage2 contains <head>?', /<head[\s>]/i.test(s2));
  console.log('stage2 contains <script>?', /<script[\s>]/i.test(s2));
  console.log('stage2 contains gtag?', /gtag/.test(s2));
})();
