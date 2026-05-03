import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data } = await sb.from('articles').select('ai_generation_log').eq('id','31892969-8215-42c2-8ad7-07135edf2766').maybeSingle();
  if (!data) return;
  const log = data.ai_generation_log as string;
  console.log('total chars:', log.length);
  console.log('typeof:', typeof log);
  console.log('chars 280-340:');
  console.log(log.slice(280, 340));
  console.log('\n--- first 800 chars ---');
  console.log(log.slice(0, 800));
  // Save raw to a file for further analysis
  fs.writeFileSync('/tmp/31892-log.json', log, 'utf-8');
  console.log('\nSaved to /tmp/31892-log.json');
})();
