/**
 * Production zero-generation 1 article 試作投入スクリプト
 *
 * 目的: GEMINI_API_KEY + production DB に対して zero-generate-full ロジックを直接実行
 * 認証: service role key を使用（Vercel API endpoint と同等の DB 権限）
 *
 * Usage:
 *   npx tsx scripts/ops/zero-gen-production-test.ts --theme="人間関係とソウルメイト" --persona="和子" --keyword="チャクラ"
 *   npx tsx scripts/ops/zero-gen-production-test.ts --dry-run    # outline のみで Gemini cost 測定
 *
 * 安全装置:
 *   - generation_mode='zero' で INSERT（既存 source 記事と分離）
 *   - is_hub_visible=false 強制（本番ハブに即座に出ない）
 *   - status='draft' で開始
 *   - --dry-run でコスト試算のみ可能
 */
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// .env.local から本番 Supabase keys + GEMINI_API_KEY を読込
const envContent = fs.readFileSync('.env.local', 'utf-8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const args = process.argv.slice(2);
const getArg = (k: string, fallback?: string) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=').slice(1).join('=') : fallback;
};
const themeName = getArg('theme', '人間関係とソウルメイト')!;
const personaName = getArg('persona', '和子')!;
const keyword = getArg('keyword', 'チャクラ')!;
const intent = (getArg('intent', 'info') as 'info' | 'empathy' | 'solve' | 'introspect');
const targetLength = parseInt(getArg('target-length', '2000')!, 10);
const dryRun = args.includes('--dry-run');

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

import { buildZeroOutlinePrompt, ZERO_OUTLINE_TEMPERATURE } from '../../src/lib/ai/prompts/stage1-zero-outline';
import { generateJson } from '../../src/lib/ai/gemini-client';

async function main() {
  console.log('=== Production Zero-Gen Test (1 article) ===');
  console.log(`Theme: ${themeName} / Persona: ${personaName} / Keyword: ${keyword} / Intent: ${intent} / target=${targetLength}`);
  console.log(`Mode: ${dryRun ? 'DRY-RUN (outline only)' : 'FULL (outline + INSERT)'}`);

  // 1. Resolve theme + persona to UUIDs
  const { data: theme, error: themeErr } = await sb
    .from('themes')
    .select('id, name, category')
    .eq('name', themeName)
    .maybeSingle();
  if (themeErr || !theme) throw new Error(`Theme not found: ${themeName} (${themeErr?.message})`);

  const { data: persona, error: personaErr } = await sb
    .from('personas')
    .select('id, name, age_range, tone_guide')
    .eq('name', personaName)
    .maybeSingle();
  if (personaErr || !persona) throw new Error(`Persona not found: ${personaName} (${personaErr?.message})`);

  console.log(`\nResolved: theme.id=${theme.id} / persona.id=${persona.id}\n`);

  // 2. Build Stage1 prompt
  const { system, user } = buildZeroOutlinePrompt({
    theme: { id: theme.id, name: theme.name, category: theme.category ?? undefined },
    persona: {
      id: persona.id,
      name: persona.name,
      age_range: persona.age_range ?? undefined,
      tone_guide: persona.tone_guide ?? undefined,
    },
    keywords: [keyword],
    intent,
    target_length: targetLength,
  });

  // 3. Generate outline via Gemini
  console.log('Calling Gemini (Stage1 outline)...');
  const startedAt = Date.now();
  const { data: outline } = await generateJson<Record<string, unknown>>(
    system,
    user,
    {
      temperature: ZERO_OUTLINE_TEMPERATURE,
      maxOutputTokens: 8000,
    },
  );
  const elapsed = Date.now() - startedAt;
  console.log(`Outline generated in ${elapsed}ms`);

  if (dryRun) {
    console.log('\n--- DRY-RUN: outline preview ---');
    console.log(JSON.stringify(outline, null, 2).slice(0, 2000));
    console.log('\nNot inserting to DB (--dry-run mode).');
    return;
  }

  // 4. INSERT minimal article (outline only, body to be generated separately)
  console.log('\nInserting to production articles table...');
  const ins = await sb
    .from('articles')
    .insert({
      title: `[ゼロ生成テスト] ${themeName} × ${personaName}`,
      slug: `zero-test-${Date.now()}`,
      status: 'draft',
      generation_mode: 'zero',
      intent,
      keyword,
      theme: themeName,
      persona: personaName,
      target_word_count: targetLength,
      stage1_outline: outline,
      lead_summary: (outline as { lead_summary?: string }).lead_summary ?? null,
      narrative_arc: (outline as { narrative_arc?: unknown }).narrative_arc ?? null,
      emotion_curve: (outline as { emotion_curve?: unknown }).emotion_curve ?? null,
      citation_highlights: (outline as { citation_highlights?: unknown[] }).citation_highlights ?? [],
      is_hub_visible: false, // 強制非公開
      visibility_state: 'idle',
    })
    .select('id, title, slug, generation_mode')
    .single();

  if (ins.error) throw new Error(`INSERT failed: ${ins.error.message}`);

  console.log('\n✓ Production INSERT 成功:');
  console.log(`  id: ${ins.data.id}`);
  console.log(`  title: ${ins.data.title}`);
  console.log(`  slug: ${ins.data.slug}`);
  console.log(`  generation_mode: ${ins.data.generation_mode}`);
  console.log(`\nGemini cost: ~${(elapsed / 1000).toFixed(1)}s, 1 LLM call (Stage1 outline only)`);
  console.log(`Stage2 body / hallucination / images はこの試作スコープ外（手動 or API 経由で次段）`);
}

main().catch((err) => {
  console.error('Production zero-gen failed:', err);
  process.exit(1);
});
