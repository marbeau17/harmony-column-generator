/**
 * P5-43 backfill 後の残り 18 件 parity 不整合の分類調査 (read-only)
 */
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
    .select('id, title, status, reviewed_at, visibility_state, generation_mode')
    .not('reviewed_at', 'is', null);

  const mismatched = (data ?? []).filter(
    (a) => !['live', 'live_hub_stale'].includes((a.visibility_state as string) ?? ''),
  );

  // status × visibility_state でグルーピング
  const groups: Record<string, typeof mismatched> = {};
  for (const a of mismatched) {
    const key = `status=${a.status} | visibility_state=${a.visibility_state}`;
    (groups[key] ??= []).push(a);
  }

  console.log(`reviewed_at NOT NULL かつ visibility 非public: ${mismatched.length} 件\n`);
  for (const [key, items] of Object.entries(groups)) {
    console.log(`【${key}】 ${items.length} 件`);
    for (const i of items.slice(0, 5)) {
      console.log(`  - ${i.id} mode=${i.generation_mode} "${i.title}"`);
    }
    if (items.length > 5) console.log(`  ... 他 ${items.length - 5} 件`);
    console.log();
  }
})();
