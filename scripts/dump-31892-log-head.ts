import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data } = await sb.from('articles').select('ai_generation_log').eq('id','31892969-8215-42c2-8ad7-07135edf2766').maybeSingle();
  if (!data) return;
  const log = data.ai_generation_log;
  const parsed = typeof log === 'string' ? JSON.parse(log) : log;
  console.log('Top-level keys:', Object.keys(parsed));
  console.log('stage:', parsed.stage);
  console.log('startedAt:', parsed.startedAt);
  console.log('completedAt:', parsed.completedAt);
  console.log('totalDurationMs:', parsed.totalDurationMs);
  if (parsed.steps) {
    console.log(`\nSteps count: ${parsed.steps.length}`);
    for (const [i,s] of parsed.steps.entries()) {
      console.log(`\n--- step ${i}: ${s.step} ---`);
      console.log('  success:', s.success);
      console.log('  durationMs:', s.durationMs);
      console.log('  tokenUsage:', JSON.stringify(s.tokenUsage));
      if (s.parsedOutput) {
        const po = s.parsedOutput;
        const poKeys = Object.keys(po);
        console.log('  parsedOutput keys:', poKeys);
        if (po.body_html) console.log('  body_html chars:', (po.body_html as string).length, 'preview:', (po.body_html as string).slice(0,200));
        if (po.html) console.log('  html chars:', (po.html as string).length, 'preview:', (po.html as string).slice(0,200));
        if (po.body) console.log('  body chars:', (po.body as string).length || JSON.stringify(po.body).slice(0,200));
      }
      if (s.rawOutput && typeof s.rawOutput === 'string') {
        console.log('  rawOutput chars:', s.rawOutput.length, 'preview:', s.rawOutput.slice(0,200));
      }
      if (s.error) console.log('  error:', s.error);
    }
  } else {
    // single-stage log? print full
    console.log('No steps array. Full keys:');
    console.log(JSON.stringify(parsed,null,2).slice(0,2000));
  }
})();
