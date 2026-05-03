/**
 * spiritual-tired-let-go の placeholder 残存を確認する一時スクリプト。
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
    .select('id, slug, title, stage2_body_html, stage3_final_html, image_files, generation_mode')
    .eq('slug', 'spiritual-tired-let-go')
    .maybeSingle();
  if (error) {
    console.error('SELECT error:', error);
    process.exit(1);
  }
  if (!data) {
    console.error('NOT FOUND: spiritual-tired-let-go');
    process.exit(1);
  }

  const s2: string = data.stage2_body_html ?? '';
  const s3: string = data.stage3_final_html ?? '';

  console.log('=== article ===');
  console.log('id:', data.id);
  console.log('slug:', data.slug);
  console.log('title:', data.title);
  console.log('mode:', data.generation_mode);
  console.log('stage2 len:', s2.length);
  console.log('stage3 len:', s3.length);

  const patterns: { name: string; re: RegExp }[] = [
    { name: 'IMAGE:hero', re: /IMAGE:hero\b/g },
    { name: 'IMAGE:body', re: /IMAGE:body\b/g },
    { name: 'IMAGE:summary', re: /IMAGE:summary\b/g },
    { name: '<!-- IMAGE -->', re: /<!--\s*IMAGE\s*-->/g },
    { name: '<!-- IMAGE:* -->', re: /<!--\s*IMAGE:[^>]*-->/g },
  ];
  console.log('\n=== stage2 placeholder hits ===');
  for (const p of patterns) {
    const m = s2.match(p.re);
    console.log(`  ${p.name}: ${m ? m.length : 0}`);
  }
  console.log('\n=== stage3 placeholder hits ===');
  for (const p of patterns) {
    const m = s3.match(p.re);
    console.log(`  ${p.name}: ${m ? m.length : 0}`);
  }

  console.log('\n=== image_files ===');
  if (Array.isArray(data.image_files)) {
    for (const f of data.image_files) {
      console.log('  -', JSON.stringify(f));
    }
  } else {
    console.log('  (not array):', data.image_files);
  }

  console.log('\n=== stage2 IMAGE context (first 5) ===');
  const re = /(IMAGE:(?:hero|body|summary)|<!--\s*IMAGE[^>]*-->)/g;
  let mm: RegExpExecArray | null;
  let count = 0;
  while ((mm = re.exec(s2)) !== null && count < 5) {
    const start = Math.max(0, mm.index - 80);
    const end = Math.min(s2.length, mm.index + mm[0].length + 80);
    console.log(`  [${count}] @${mm.index}: ...${s2.slice(start, end)}...`);
    count++;
  }
})();
