import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data, error } = await sb.from('personas').select('*').order('name');
  if (error) { console.error(error); return; }
  for (const p of data || []) {
    console.log('\n=== ' + (p as any).name + ' ===');
    for (const [k,v] of Object.entries(p)) {
      if (k === 'name') continue;
      if (typeof v === 'string' && v.length > 200) {
        console.log(`  ${k}: [${v.length} chars] ${v.slice(0,150)}...`);
      } else {
        console.log(`  ${k}:`, v);
      }
    }
  }
})();
