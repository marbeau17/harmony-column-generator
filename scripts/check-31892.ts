import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data, error } = await sb.from('articles').select('*').eq('id','31892969-8215-42c2-8ad7-07135edf2766').maybeSingle();
  if (error) { console.error(error); process.exit(1); }
  if (!data) { console.log('NOT FOUND'); process.exit(0); }
  const out: any = {};
  for (const k of Object.keys(data)) {
    const v = (data as any)[k];
    if (typeof v === 'string' && v.length > 200) {
      out[k] = `[string ${v.length} chars] ${v.slice(0,150)}...`;
    } else if (Array.isArray(v)) {
      out[k] = `[array len=${v.length}]`;
    } else if (v && typeof v === 'object') {
      out[k] = `[object keys=${Object.keys(v).join(',')}]`;
    } else {
      out[k] = v;
    }
  }
  console.log(JSON.stringify(out, null, 2));
})();
