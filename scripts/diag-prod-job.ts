import * as fs from 'fs';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  // 1. SELECT で接続確認
  const { data: rows, error: selErr } = await sb.from('generation_jobs').select('*').limit(3);
  console.log('SELECT:', selErr?.message ?? 'OK', '| rows:', rows?.length ?? 0);

  // 2. UPSERT で書込確認
  const testId = '88888888-8888-4888-8888-888888888888';
  const { data: up, error: upErr } = await sb.from('generation_jobs').upsert({
    id: testId, stage: 'queued', progress: 0, eta_seconds: 0, updated_at: new Date().toISOString(),
  }, { onConflict: 'id' }).select().single();
  console.log('UPSERT:', upErr?.message ?? 'OK', '| id:', up?.id);
  await sb.from('generation_jobs').delete().eq('id', testId);
})();
