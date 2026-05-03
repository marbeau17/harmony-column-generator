import * as fs from 'fs';
const env = fs.readFileSync('.env.local','utf-8');
for (const line of env.split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim(); }
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

interface ImageFile { position: string; url: string; alt: string }

function replaceImagePlaceholders(body: string, imageFiles: ImageFile[]): { html: string; phase1: number; phase2: number } {
  if (!body || imageFiles.length === 0) return { html: body, phase1: 0, phase2: 0 };
  const tagFor = (img: ImageFile) =>
    `<img src="${img.url}" alt="${img.alt || ''}" style="max-width:100%;border-radius:8px;margin:1em 0" />`;
  let html = body;
  const matched = new Set<string>();
  let phase1 = 0;
  for (const img of imageFiles) {
    const tag = tagFor(img);
    const patterns = [
      new RegExp(`<p>\\s*IMAGE:${img.position}[^<]*<\\/p>`, 'g'),
      new RegExp(`IMAGE:${img.position}(?::[^\\s<]*)?`, 'g'),
      new RegExp(`<!--\\s*IMAGE:${img.position}:[^-]*-->`, 'g'),
      new RegExp(`<div[^>]*>\\s*<!--\\s*IMAGE:${img.position}:[^-]*-->\\s*</div>`, 'g'),
    ];
    for (const p of patterns) {
      const before = html;
      html = html.replace(p, tag);
      if (before !== html) {
        matched.add(img.position);
        phase1 += (before.match(p) || []).length;
      }
    }
  }
  const ordered = ['hero','body','summary'];
  const unmatched = ordered.filter(p => !matched.has(p));
  const byPos = new Map(imageFiles.map(f => [f.position, f]));
  let phase2 = 0;
  if (unmatched.length > 0) {
    const fallback: RegExp[] = [
      /(?:<!--\s*)?IMAGE[：:]\s*[^<>\n]*?-->/g,
      /<p[^>]*>\s*IMAGE[：:]\s*[^<]*<\/p>/g,
      /(?<![A-Za-z_])IMAGE[：:]\s*[^\n<]{1,200}/g,
    ];
    let idx = 0;
    for (const fp of fallback) {
      if (idx >= unmatched.length) break;
      html = html.replace(fp, (match) => {
        if (idx >= unmatched.length) return match;
        const pos = unmatched[idx];
        const img = byPos.get(pos);
        idx++; phase2++;
        return img ? tagFor(img) : match;
      });
    }
  }
  return { html, phase1, phase2 };
}

(async () => {
  const id = '6bde5014-c142-45a4-8881-ad8e668f56e8';
  const { data } = await sb.from('articles').select('id,stage2_body_html,image_files').eq('id', id).maybeSingle();
  if (!data) { console.log('NOT FOUND'); return; }
  const body = data.stage2_body_html as string;
  const files = data.image_files as ImageFile[];
  console.log('before placeholders:');
  const matches = body.match(/IMAGE[:：][^\n<]{1,80}/g);
  console.log('  IMAGE patterns found:', matches?.length ?? 0);
  matches?.forEach(m => console.log('   -', m.slice(0, 60)));

  const r = replaceImagePlaceholders(body, files);
  console.log(`\nreplaced: phase1=${r.phase1}, phase2=${r.phase2}`);
  console.log('after IMAGE patterns:', (r.html.match(/IMAGE[:：][^\n<]{1,80}/g) || []).length);

  if (r.phase1 + r.phase2 > 0) {
    const { error } = await sb.from('articles').update({ stage2_body_html: r.html }).eq('id', id);
    console.log('UPDATE:', error?.message ?? 'OK');
  }
})();
