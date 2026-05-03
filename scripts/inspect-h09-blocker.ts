/**
 * H-09 parity blocker 1 件の詳細調査用スクリプト
 *  id=01d12905-8c43-49c5-aeae-68c797b07dad
 *
 * 使い方:
 *   tsx scripts/inspect-h09-blocker.ts
 */
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const ID = '01d12905-8c43-49c5-aeae-68c797b07dad';

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await sb
    .from('articles')
    .select('*')
    .eq('id', ID)
    .single();
  if (error) {
    console.error('query failed:', error.message);
    process.exit(1);
  }

  const a = data as any;
  console.log('=== H-09 Blocker 詳細 ===');
  console.log('id:                 ', a.id);
  console.log('title:              ', a.title);
  console.log('slug:               ', a.slug);
  console.log('status:             ', a.status);
  console.log('visibility_state:   ', a.visibility_state);
  console.log('reviewed_at:        ', a.reviewed_at);
  console.log('published_at:       ', a.published_at);
  console.log('created_at:         ', a.created_at);
  console.log('updated_at:         ', a.updated_at);
  console.log('source_kind:        ', a.source_kind);
  console.log('generation_kind:    ', a.generation_kind);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
