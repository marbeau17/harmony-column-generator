import * as fs from 'fs';
import * as path from 'path';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

(async () => {
  const { data, error } = await sb.from('articles')
    .select('id,article_number,slug,title,generation_mode,created_at,image_files,stage2_body_html')
    .eq('generation_mode','zero')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) { console.error('ERR', error); process.exit(1); }
  const a = (data ?? [])[0];
  if (!a) { console.log('no zero article found'); return; }

  const s2: string = (a.stage2_body_html as string) ?? '';
  const imgs: any[] = Array.isArray(a.image_files) ? (a.image_files as any[]) : [];

  console.log('=== article ===');
  console.log('id:', a.id);
  console.log('article_number:', a.article_number);
  console.log('slug:', a.slug);
  console.log('title:', a.title);
  console.log('created_at:', a.created_at);
  console.log('stage2_body_html length:', s2.length);
  console.log('image_files count:', imgs.length);

  // dump stage2 to tmp
  const outPath = path.resolve('tmp', `stage2-${a.id}.html`);
  fs.writeFileSync(outPath, s2 ?? '');
  console.log('stage2 written to', outPath);

  // image_files JSON
  console.log('\n=== image_files ===');
  console.log(JSON.stringify(imgs, null, 2));

  console.log('\n=== image_files position summary ===');
  for (const f of imgs) {
    console.log(' position=', f.position, ' url=', f.public_url ?? f.url ?? f.path ?? f.storage_path ?? '(none)', ' filename=', f.filename ?? f.name ?? '(none)');
  }

  // placeholder / <img> detection
  console.log('\n=== stage2 placeholder / <img> matches ===');
  const positions = ['hero','body','summary'];
  for (const pos of positions) {
    const placeholderPatterns = [
      new RegExp(`\\{\\{\\s*IMAGE[_:\\s-]*${pos}\\s*\\}\\}`, 'gi'),
      new RegExp(`\\{IMAGE[_:\\s-]*${pos}\\}`, 'gi'),
      new RegExp(`<!--\\s*IMAGE[_:\\s-]*${pos}\\s*-->`, 'gi'),
      new RegExp(`\\[IMAGE[_:\\s-]*${pos}\\]`, 'gi'),
      new RegExp(`IMAGE_${pos.toUpperCase()}`, 'g'),
    ];
    let placeholderHits: string[] = [];
    for (const re of placeholderPatterns) {
      const m = s2.match(re);
      if (m) placeholderHits.push(...m);
    }
    // <img> tags whose context references this position (loose: data-position or filename hint)
    const imgRe = /<img\b[^>]*>/gi;
    const allImgs = s2.match(imgRe) ?? [];
    const posImgs = allImgs.filter(t => new RegExp(pos, 'i').test(t));

    // also: look for image_files entry with position match
    const fileMatch = imgs.find(f => (f.position ?? '').toLowerCase() === pos);

    console.log(`-- ${pos} --`);
    console.log('  image_files entry:', fileMatch ? `yes (url=${fileMatch.public_url ?? fileMatch.url ?? fileMatch.path ?? '?'})` : 'NO');
    console.log('  placeholder hits in stage2:', placeholderHits.length, placeholderHits.slice(0,3));
    console.log('  <img> tags referencing position keyword:', posImgs.length);
    if (posImgs.length) console.log('   sample:', posImgs[0].slice(0,200));
  }

  // also count total <img> tags in stage2
  const totalImg = (s2.match(/<img\b[^>]*>/gi) ?? []).length;
  console.log('\ntotal <img> tags in stage2:', totalImg);

  // any IMAGE-ish leftover token
  const leftover = s2.match(/\{?\{?\s*IMAGE[_:\s-]?\w*\s*\}?\}?/gi) ?? [];
  console.log('any IMAGE-ish tokens (loose):', leftover.length, leftover.slice(0,5));
})();
