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

async function head(url: string): Promise<number> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.status;
  } catch (e) {
    return -1;
  }
}

async function inspect(prefix: string) {
  console.log('\n==========================================');
  console.log('SEARCH prefix:', prefix);
  // pull all and filter client-side (small dataset, ~45 articles)
  const { data: all, error } = await sb
    .from('articles')
    .select('id, title, slug, image_files');
  const rows = (all ?? []).filter((r: any) => (r.id as string).startsWith(prefix));

  if (error) {
    console.log('ERROR:', error);
    return;
  }
  if (!rows || rows.length === 0) {
    console.log('NOT FOUND');
    return;
  }

  for (const row of rows) {
    console.log('------------------------------------------');
    console.log('id    :', row.id);
    console.log('slug  :', row.slug);
    console.log('title :', row.title);
    const files = row.image_files as Record<string, unknown> | null;
    if (!files) {
      console.log('image_files: NULL');
      continue;
    }
    console.log('image_files keys:', Object.keys(files));
    console.log('image_files raw :', JSON.stringify(files, null, 2));

    for (const [key, val] of Object.entries(files)) {
      let urls: string[] = [];
      if (typeof val === 'string' && val.startsWith('http')) {
        urls = [val];
      } else if (val && typeof val === 'object') {
        const obj = val as Record<string, unknown>;
        for (const v of Object.values(obj)) {
          if (typeof v === 'string' && v.startsWith('http')) urls.push(v);
        }
      }
      for (const u of urls) {
        const status = await head(u);
        console.log(`  [${key}] status=${status} url=${u}`);
      }
    }
  }
}

(async () => {
  await inspect('01d12905');
  await inspect('c640b96d');
})();
