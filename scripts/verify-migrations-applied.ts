import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  // 1. quality_overrides 列が存在するか SELECT でテスト
  const { data, error } = await sb.from('articles').select('id, quality_overrides').limit(1);
  if (error) console.log('❌ quality_overrides:', error.message);
  else console.log('✅ quality_overrides column exists. sample:', JSON.stringify(data?.[0]));

  // 2. publish_events に新値で INSERT を試して CHECK 制約が拡張済か確認
  const { data: art } = await sb.from('articles').select('id').limit(1).single();
  if (!art) { console.log('skip publish_events test (no article)'); return; }
  const { error: insErr } = await sb.from('publish_events').insert({
    article_id: art.id,
    action: 'manual-edit',
    reason: 'migration verification — please ignore',
  });
  if (insErr) console.log('❌ publish_events INSERT:', insErr.message);
  else {
    console.log('✅ publish_events.action accepts "manual-edit" (CHECK 制約拡張済)');
    await sb.from('publish_events').delete().eq('reason', 'migration verification — please ignore');
  }
})();
