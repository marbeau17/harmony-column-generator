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

const TARGETS = [
  { id: '01d12905-8c43-49c5-aeae-68c797b07dad', label: 'law-of-attraction' },
  { id: 'c640b96d-1573-406a-8a0a-87a386afd485', label: 'healing' },
];

(async () => {
  for (const t of TARGETS) {
    console.log('\n========================================');
    console.log(`Article: ${t.label} (${t.id})`);
    console.log('========================================');

    const { data, error } = await sb
      .from('publish_events')
      .select('*')
      .eq('article_id', t.id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('  ERROR:', error.message);
      continue;
    }
    if (!data || data.length === 0) {
      console.log('  (no events)');
      continue;
    }
    console.log(`  count: ${data.length}`);
    for (const row of data) {
      console.log('---');
      for (const [k, v] of Object.entries(row)) {
        let s: string;
        if (v == null) s = 'null';
        else if (typeof v === 'object') s = JSON.stringify(v);
        else s = String(v);
        if (s.length > 400) s = s.slice(0, 397) + '...';
        console.log(`  ${k}: ${s}`);
      }
    }
  }
})();
