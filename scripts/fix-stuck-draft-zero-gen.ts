/**
 * P5-36 one-off: ゼロ生成完了済みなのに status='draft' で詰まっている記事を
 * editing に進める。run-completion で status を触っていなかった時代の記事用。
 *
 * 条件:
 *   - generation_mode = 'zero'
 *   - status = 'draft'
 *   - stage2_body_html が一定以上の長さで存在
 *
 * 使い方:
 *   tsx scripts/fix-stuck-draft-zero-gen.ts          # dry-run
 *   tsx scripts/fix-stuck-draft-zero-gen.ts --apply  # 実行
 */
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const APPLY = process.argv.includes('--apply');
const MIN_BODY_CHARS = 1000;

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await sb
    .from('articles')
    .select('id, title, status, generation_mode, stage2_body_html')
    .eq('generation_mode', 'zero')
    .eq('status', 'draft');

  if (error) {
    console.error('query failed:', error.message);
    process.exit(1);
  }

  const targets = (data ?? []).filter(
    (a) => (a.stage2_body_html as string | null)?.length ?? 0 >= MIN_BODY_CHARS,
  );

  console.log(`zero-gen draft: ${data?.length ?? 0} 件`);
  console.log(`本文 ${MIN_BODY_CHARS} 字以上: ${targets.length} 件`);
  for (const a of targets) {
    console.log(`  - ${a.id}: ${a.title} (${(a.stage2_body_html as string)?.length} chars)`);
  }

  if (!APPLY) {
    console.log('\n[dry-run] --apply で実行されます');
    return;
  }

  let ok = 0;
  for (const a of targets) {
    const { error: e } = await sb
      .from('articles')
      .update({ status: 'editing' })
      .eq('id', a.id);
    if (e) {
      console.error(`  ❌ ${a.id}: ${e.message}`);
    } else {
      ok++;
      console.log(`  ✅ ${a.id} → editing`);
    }
  }
  console.log(`\n完了: ${ok}/${targets.length} 件を editing に進めました`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
