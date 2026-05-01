/**
 * 既存 zero-gen 記事に Stage2 以降を実行する CLI
 * --------------------------------------------------------------
 * 用途: scripts/ops/zero-gen-production-test.ts で Stage1 outline のみ INSERT 済の
 * 記事に対し、Stage2 body 生成 → ハルシネ/tone 検証 → 画像プロンプト → 履歴 snapshot
 * を続けて実行する。zero-generate-full route は INSERT-only で resumable ではないため、
 * 同 route の library 関数を直接呼ぶ独立 CLI として実装。
 *
 * Usage:
 *   npx tsx scripts/ops/zero-gen-stage2-onwards.ts --id=cc1d079a-743d-4ee8-8305-dba89f4e02dc
 *   npx tsx scripts/ops/zero-gen-stage2-onwards.ts --id=<uuid> --dry-run   # body 生成のみ DB 更新せず
 *
 * 安全装置:
 *   - 既に stage2_body_html が埋まっている記事は --force 無しで停止
 *   - status は draft のまま据え置き（公開フラグは触らない）
 *   - is_hub_visible は触らない
 *   - 画像実生成は本タスク外（プロンプトのみ image_prompts 列に格納）
 */
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// .env.local 読込
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
const articleId = getArg('id');
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

if (!articleId) {
  console.error('Usage: --id=<article uuid> [--dry-run] [--force]');
  process.exit(1);
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

import { generateJson } from '../../src/lib/ai/gemini-client';
import {
  buildZeroWritingPrompt,
  ZERO_WRITING_TEMPERATURE,
  type ZeroWritingInput,
  type RetrievedChunk as ZeroWritingRetrievedChunk,
} from '../../src/lib/ai/prompts/stage2-zero-writing';
import { retrieveChunks } from '../../src/lib/rag/retrieve-chunks';
import { runHallucinationChecks } from '../../src/lib/hallucination/run-checks';
import { persistClaims } from '../../src/lib/hallucination/persist-claims';
import { runToneChecks } from '../../src/lib/tone/run-tone-checks';
import { persistToneScore } from '../../src/lib/tone/persist-tone';
import { buildZeroImagePrompts } from '../../src/lib/ai/prompts/zero-image-prompt';

async function main() {
  console.log('=== Zero-Gen Stage2-Onwards Continuation ===');
  console.log(`articleId: ${articleId}  dryRun=${dryRun}  force=${force}`);

  // 1. 記事ロード
  const { data: article, error: aErr } = await sb
    .from('articles')
    .select(
      'id, title, status, generation_mode, intent, keyword, theme, persona, target_word_count, stage1_outline, stage2_body_html, lead_summary, narrative_arc, citation_highlights',
    )
    .eq('id', articleId)
    .maybeSingle();
  if (aErr || !article) throw new Error(`article not found: ${articleId} (${aErr?.message})`);
  if (article.generation_mode !== 'zero') {
    throw new Error(`article is not zero-mode: ${article.generation_mode}`);
  }
  if (!article.stage1_outline) {
    throw new Error('stage1_outline is empty — Stage1 を先に実行してください');
  }
  if (article.stage2_body_html && !force) {
    console.warn('stage2_body_html already populated. --force で上書き可能。停止。');
    process.exit(2);
  }
  console.log(`Loaded: title="${article.title}"  theme="${article.theme}"  persona="${article.persona}"  intent=${article.intent}`);

  // 2. theme/persona 行取得（visual_mood / image_style 含む）
  const [themeRes, personaRes] = await Promise.all([
    sb.from('themes').select('id, name, category, visual_mood').eq('name', article.theme!).maybeSingle(),
    sb.from('personas').select('id, name, age_range, tone_guide, image_style').eq('name', article.persona!).maybeSingle(),
  ]);
  if (themeRes.error || !themeRes.data) throw new Error(`theme row missing: ${themeRes.error?.message}`);
  if (personaRes.error || !personaRes.data) throw new Error(`persona row missing: ${personaRes.error?.message}`);
  const theme = themeRes.data;
  const persona = personaRes.data;

  // 3. RAG retrieve（source_chunks 0 件想定 → status='ok' (warning なし) で空配列）
  console.log('\n[Stage RAG] retrieving source chunks...');
  let ragChunks: ZeroWritingRetrievedChunk[] = [];
  try {
    const ragResult = await retrieveChunks(sb as never, {
      theme: theme.name,
      persona_pain: persona.tone_guide ?? '',
      keywords: [article.keyword ?? ''],
      similarityThreshold: 0.75,
    });
    ragChunks = (ragResult.chunks ?? []).map((c: { chunk_text: string; similarity: number }) => ({
      text: c.chunk_text,
      similarity: c.similarity,
    }));
    console.log(`  → ${ragChunks.length} chunks (warning=${ragResult.warning ?? 'none'})`);
  } catch (e) {
    console.warn(`  RAG failed (継続): ${(e as Error).message}`);
  }

  // 4. Stage2 writing — image_prompts が object 形式（{hero,body,summary}）の場合は
  //    Stage2 が期待する array 形式（[{slot,prompt}]）に正規化する
  const rawOutline = article.stage1_outline as Record<string, unknown>;
  const ip = rawOutline.image_prompts;
  if (ip && !Array.isArray(ip) && typeof ip === 'object') {
    const obj = ip as Record<string, string>;
    rawOutline.image_prompts = (['hero', 'body', 'summary'] as const)
      .filter((slot) => typeof obj[slot] === 'string')
      .map((slot) => ({ slot, prompt: obj[slot] }));
  }

  console.log('\n[Stage 2] writing body via Gemini...');
  const writingInput: ZeroWritingInput = {
    outline: rawOutline as unknown as ZeroWritingInput['outline'],
    persona: {
      id: persona.id,
      name: persona.name,
      age_range: persona.age_range ?? undefined,
      tone_guide: persona.tone_guide ?? undefined,
    },
    theme: {
      id: theme.id,
      name: theme.name,
      category: theme.category ?? undefined,
    },
    retrievedChunks: ragChunks,
  };
  const { system: wSys, user: wUser } = buildZeroWritingPrompt(writingInput);
  const t0 = Date.now();
  const { data: writingResp, response: writingRaw } = await generateJson<unknown>(wSys, wUser, {
    temperature: ZERO_WRITING_TEMPERATURE,
    topP: 0.9,
    maxOutputTokens: 32000,
  });
  const writingMs = Date.now() - t0;
  // Gemini は { html } / string / [string,...] / [{html},...] の 4 形を返しうるため正規化
  const toHtml = (x: unknown): string => {
    if (typeof x === 'string') return x;
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if (typeof o.html === 'string') return o.html;
    }
    return '';
  };
  let bodyHtml = '';
  if (Array.isArray(writingResp)) {
    bodyHtml = writingResp.map(toHtml).filter(Boolean).join('\n');
  } else {
    bodyHtml = toHtml(writingResp);
    if (!bodyHtml && writingResp && typeof writingResp === 'object') {
      bodyHtml = Object.values(writingResp as object).map(toHtml).filter(Boolean).join('\n');
    }
  }
  console.log(`  → body length=${bodyHtml.length} chars  (${writingMs}ms)`);
  if (!bodyHtml) {
    console.error('Stage2 raw keys:', writingResp && typeof writingResp === 'object' ? Object.keys(writingResp as object) : typeof writingResp);
    console.error('Stage2 raw text head:', writingRaw.text.slice(0, 500));
    throw new Error('Stage2 writing returned empty body');
  }

  // 5. ハルシネ + tone 並列
  console.log('\n[Stage Validation] hallucination + tone in parallel...');
  const [halluSettled, toneSettled] = await Promise.all([
    runHallucinationChecks(bodyHtml).then((r) => ({ ok: true as const, r })).catch((e) => ({ ok: false as const, e })),
    runToneChecks(bodyHtml).then((r) => ({ ok: true as const, r })).catch((e) => ({ ok: false as const, e })),
  ]);
  const halluResult = halluSettled.ok ? halluSettled.r : null;
  const toneResult = toneSettled.ok ? toneSettled.r : null;
  if (halluSettled.ok) {
    console.log(`  hallucination_score=${halluResult?.hallucination_score}  claims=${halluResult?.claims?.length ?? 0}`);
  } else {
    console.warn(`  hallucination FAILED: ${(halluSettled.e as Error)?.message}`);
  }
  if (toneSettled.ok) {
    console.log(`  yukiko_tone total=${toneResult?.tone?.total}  passed=${toneResult?.tone?.overallPassed}`);
  } else {
    console.warn(`  tone FAILED: ${(toneSettled.e as Error)?.message}`);
  }

  // 6. 画像プロンプト
  console.log('\n[Stage Image Prompts] building 3 prompts...');
  let imagePrompts = { hero: '', body: '', summary: '' };
  try {
    imagePrompts = buildZeroImagePrompts({
      outline: article.stage1_outline as never,
      persona: { image_style: persona.image_style as never },
      theme: { visual_mood: theme.visual_mood as never, name: theme.name },
    });
    console.log(`  hero=${imagePrompts.hero.slice(0, 60)}...`);
  } catch (e) {
    console.warn(`  image prompt FAILED: ${(e as Error).message}`);
  }

  // 7. 結果サマリ
  const hallucinationScore =
    halluResult && typeof halluResult.hallucination_score === 'number' ? halluResult.hallucination_score : null;
  const yukikoToneScore =
    toneResult && typeof toneResult.tone?.total === 'number' ? toneResult.tone.total : null;

  console.log('\n=== Result Summary ===');
  console.log(`stage2_body_html: ${bodyHtml.length} chars`);
  console.log(`hallucination_score: ${hallucinationScore}`);
  console.log(`yukiko_tone_score: ${yukikoToneScore}`);
  console.log(`image_prompts: hero/body/summary populated=${Boolean(imagePrompts.hero)}`);

  if (dryRun) {
    console.log('\n--- DRY-RUN: no DB writes ---');
    console.log(bodyHtml.slice(0, 1500));
    return;
  }

  // 8. DB UPDATE（既存記事の Stage2 列を埋める）
  console.log('\n[DB] UPDATE article + persistClaims + persistToneScore + insert revision...');
  const upd = await sb
    .from('articles')
    .update({
      stage2_body_html: bodyHtml,
      hallucination_score: hallucinationScore,
      yukiko_tone_score: yukikoToneScore,
      image_prompts: imagePrompts,
    })
    .eq('id', articleId)
    .select('id')
    .single();
  if (upd.error) throw new Error(`UPDATE failed: ${upd.error.message}`);
  console.log('  ✓ articles UPDATE 成功');

  // claims persist（テーブルが空でも安全）
  if (halluResult && Array.isArray(halluResult.claims) && halluResult.claims.length > 0) {
    try {
      await persistClaims(articleId!, halluResult.claims);
      console.log(`  ✓ persistClaims (${halluResult.claims.length})`);
    } catch (e) {
      console.warn(`  persistClaims failed: ${(e as Error).message}`);
    }
  }

  // tone persist
  if (toneResult) {
    try {
      await persistToneScore(articleId!, toneResult);
      console.log('  ✓ persistToneScore');
    } catch (e) {
      console.warn(`  persistToneScore failed: ${(e as Error).message}`);
    }
  }

  // article_revisions snapshot
  try {
    const { error: rErr } = await sb.from('article_revisions').insert({
      article_id: articleId,
      revision_number: 1,
      html_snapshot: bodyHtml,
      change_type: 'auto_snapshot',
      changed_by: null,
      comment: JSON.stringify({ title: article.title, source: 'zero-gen-stage2-onwards' }),
    });
    if (rErr) throw rErr;
    console.log('  ✓ article_revisions snapshot');
  } catch (e) {
    console.warn(`  revision snapshot failed: ${(e as Error).message}`);
  }

  console.log('\n✓ Stage2-Onwards 完了');
}

main().catch((err) => {
  console.error('\n✗ Stage2-Onwards FAILED:', err);
  process.exit(1);
});
