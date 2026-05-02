/**
 * P5-40 one-off: status='published' なのに slug or reviewed_at が null の記事を修復。
 *
 * - slug=null → タイトルから generateSlug() で生成 (重複時は -2, -3 サフィックス)
 * - reviewed_at=null → 現在時刻をセット (= ゼロ生成記事の自動承認)
 *
 * 修復後、FTP デプロイは管理画面の「再デプロイ」ボタン or /api/articles/{id}/deploy
 * を別途実行すること (このスクリプトでは行わない、副作用最小化のため)。
 *
 * 使い方:
 *   tsx scripts/fix-published-missing-fields.ts          # dry-run
 *   tsx scripts/fix-published-missing-fields.ts --apply  # 実行
 */
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

import { generateSlug } from '../src/lib/seo/meta-generator';

const APPLY = process.argv.includes('--apply');

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await sb
    .from('articles')
    .select('id, title, slug, reviewed_at, status')
    .eq('status', 'published');
  if (error) {
    console.error('query failed:', error.message);
    process.exit(1);
  }

  const targets = (data ?? []).filter(
    (a) => !a.slug || !a.reviewed_at,
  );

  console.log(`published: ${data?.length ?? 0} 件`);
  console.log(`修復対象 (slug or reviewed_at が null): ${targets.length} 件\n`);

  // 既存 slug 一覧で衝突チェック
  const existingSlugs = new Set(
    (data ?? []).map((a) => a.slug).filter(Boolean) as string[],
  );

  type Plan = { id: string; title: string | null; newSlug: string | null; setReviewedAt: boolean };
  const plans: Plan[] = [];

  for (const a of targets) {
    let newSlug: string | null = null;
    if (!a.slug && a.title) {
      let candidate = generateSlug(a.title);
      let suffix = 2;
      while (existingSlugs.has(candidate)) {
        candidate = `${generateSlug(a.title)}-${suffix}`;
        suffix++;
      }
      existingSlugs.add(candidate);
      newSlug = candidate;
    }
    plans.push({
      id: a.id,
      title: a.title as string | null,
      newSlug,
      setReviewedAt: !a.reviewed_at,
    });
  }

  for (const p of plans) {
    console.log(
      `  - ${p.id} ${p.title ?? '(no title)'} ` +
        `${p.newSlug ? `[slug=${p.newSlug}]` : ''} ` +
        `${p.setReviewedAt ? '[+reviewed_at]' : ''}`,
    );
  }

  if (!APPLY) {
    console.log('\n[dry-run] --apply で実行されます');
    return;
  }

  let ok = 0;
  for (const p of plans) {
    const update: Record<string, unknown> = {};
    if (p.newSlug) update.slug = p.newSlug;
    if (p.setReviewedAt) update.reviewed_at = new Date().toISOString();
    if (Object.keys(update).length === 0) continue;
    const { error: e } = await sb.from('articles').update(update).eq('id', p.id);
    if (e) console.error(`  ❌ ${p.id}: ${e.message}`);
    else {
      ok++;
      console.log(`  ✅ ${p.id}`);
    }
  }
  console.log(`\n完了: ${ok}/${plans.length} 件`);
  console.log('次のステップ: 管理画面で各記事の「再デプロイ」を実行 (FTP 反映)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
