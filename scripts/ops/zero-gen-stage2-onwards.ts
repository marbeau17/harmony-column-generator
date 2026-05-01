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
  const scriptStartedAt = Date.now();
  console.log('=== Zero-Gen Stage2-Onwards Continuation ===');
  console.log(`articleId: ${articleId}  dryRun=${dryRun}  force=${force}`);
  console.log('[zero-gen.stage2.start]', {
    articleId,
    dryRun,
    force,
    startedAt: new Date(scriptStartedAt).toISOString(),
  });

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
  console.log('[zero-gen.stage2.article_loaded]', {
    id: article.id,
    title: article.title,
    theme: article.theme,
    persona: article.persona,
    intent: article.intent,
    keyword: article.keyword,
    target_word_count: article.target_word_count,
    has_outline: Boolean(article.stage1_outline),
    has_existing_body: Boolean(article.stage2_body_html),
  });

  // 2. theme/persona 行取得（visual_mood / image_style 含む）
  const [themeRes, personaRes] = await Promise.all([
    sb.from('themes').select('id, name, category, visual_mood').eq('name', article.theme!).maybeSingle(),
    sb.from('personas').select('id, name, age_range, tone_guide, image_style').eq('name', article.persona!).maybeSingle(),
  ]);
  if (themeRes.error || !themeRes.data) throw new Error(`theme row missing: ${themeRes.error?.message}`);
  if (personaRes.error || !personaRes.data) throw new Error(`persona row missing: ${personaRes.error?.message}`);
  const theme = themeRes.data;
  const persona = personaRes.data;
  console.log('[zero-gen.stage2.refs_resolved]', {
    theme_id: theme.id,
    persona_id: persona.id,
    theme_visual_mood: theme.visual_mood ?? null,
    persona_image_style: persona.image_style ?? null,
  });

  // 3. RAG retrieve（source_chunks 0 件想定 → status='ok' (warning なし) で空配列）
  console.log('\n[Stage RAG] retrieving source chunks...');
  const ragKeyword = article.keyword ?? '';
  const ragThreshold = 0.75;
  console.log('[zero-gen.stage2.rag.begin]', {
    keyword: ragKeyword,
    threshold: ragThreshold,
  });
  let ragChunks: ZeroWritingRetrievedChunk[] = [];
  const ragT0 = Date.now();
  try {
    const ragResult = await retrieveChunks(sb as never, {
      theme: theme.name,
      persona_pain: persona.tone_guide ?? '',
      keywords: [ragKeyword],
      similarityThreshold: ragThreshold,
    });
    ragChunks = (ragResult.chunks ?? []).map((c: { chunk_text: string; similarity: number }) => ({
      text: c.chunk_text,
      similarity: c.similarity,
    }));
    console.log(`  → ${ragChunks.length} chunks (warning=${ragResult.warning ?? 'none'})`);
    console.log('[zero-gen.stage2.rag.end]', {
      chunks_count: ragChunks.length,
      warning: ragResult.warning ?? null,
      elapsed_ms: Date.now() - ragT0,
      status: 'ok',
    });
  } catch (e) {
    console.warn(`  RAG failed (継続): ${(e as Error).message}`);
    console.log('[zero-gen.stage2.rag.end]', {
      chunks_count: 0,
      warning: (e as Error).message,
      elapsed_ms: Date.now() - ragT0,
      status: 'failed',
    });
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
  const writingMaxOutputTokens = 32000;
  console.log('[zero-gen.stage2.writing.begin]', {
    rag_chunks: ragChunks.length,
    prompt_chars: wSys.length + wUser.length,
    max_output_tokens: writingMaxOutputTokens,
  });
  const t0 = Date.now();
  const { data: writingResp, response: writingRaw } = await generateJson<unknown>(wSys, wUser, {
    temperature: ZERO_WRITING_TEMPERATURE,
    topP: 0.9,
    maxOutputTokens: writingMaxOutputTokens,
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
  // response_shape を判定（debugging を容易にするため）
  const deriveResponseShape = (
    x: unknown,
  ): 'string' | 'object_html' | 'array_html' | 'array_object_html' | 'unknown' => {
    if (typeof x === 'string') return 'string';
    if (Array.isArray(x)) {
      if (x.length === 0) return 'unknown';
      if (x.every((el) => typeof el === 'string')) return 'array_html';
      if (
        x.every(
          (el) =>
            el !== null && typeof el === 'object' && typeof (el as Record<string, unknown>).html === 'string',
        )
      ) {
        return 'array_object_html';
      }
      return 'unknown';
    }
    if (x && typeof x === 'object') {
      if (typeof (x as Record<string, unknown>).html === 'string') return 'object_html';
      return 'unknown';
    }
    return 'unknown';
  };
  const responseShape = deriveResponseShape(writingResp);
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
  // usageMetadata から token 内訳を抽出（thinking_tokens は total - prompt - completion）
  const usage =
    (writingRaw as unknown as { usageMetadata?: Record<string, number | undefined> })?.usageMetadata ?? {};
  const promptTokens =
    typeof usage.promptTokenCount === 'number' ? usage.promptTokenCount : null;
  const completionTokens =
    typeof usage.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : null;
  const totalTokens =
    typeof usage.totalTokenCount === 'number' ? usage.totalTokenCount : null;
  const thinkingTokens =
    promptTokens !== null && completionTokens !== null && totalTokens !== null
      ? totalTokens - promptTokens - completionTokens
      : null;
  const finishReason =
    (writingRaw as unknown as { candidates?: Array<{ finishReason?: string }> })?.candidates?.[0]
      ?.finishReason ?? null;
  console.log('[zero-gen.stage2.writing.end]', {
    body_chars: bodyHtml.length,
    finishReason,
    promptTokens,
    completionTokens,
    totalTokens,
    thinking_tokens: thinkingTokens,
    response_shape: responseShape,
    elapsed_ms: writingMs,
  });
  if (!bodyHtml) {
    console.error('Stage2 raw keys:', writingResp && typeof writingResp === 'object' ? Object.keys(writingResp as object) : typeof writingResp);
    console.error('Stage2 raw text head:', writingRaw.text.slice(0, 500));
    throw new Error('Stage2 writing returned empty body');
  }

  // 5. ハルシネ + tone 並列
  console.log('\n[Stage Validation] hallucination + tone in parallel...');
  console.log('[zero-gen.stage2.hallucination.begin]', { body_chars: bodyHtml.length });
  console.log('[zero-gen.stage2.tone.begin]', { body_chars: bodyHtml.length });
  const halluT0 = Date.now();
  const toneT0 = Date.now();
  const [halluSettled, toneSettled] = await Promise.all([
    runHallucinationChecks(bodyHtml)
      .then((r) => ({ ok: true as const, r, elapsed: Date.now() - halluT0 }))
      .catch((e) => ({ ok: false as const, e, elapsed: Date.now() - halluT0 })),
    runToneChecks(bodyHtml)
      .then((r) => ({ ok: true as const, r, elapsed: Date.now() - toneT0 }))
      .catch((e) => ({ ok: false as const, e, elapsed: Date.now() - toneT0 })),
  ]);
  const halluResult = halluSettled.ok ? halluSettled.r : null;
  const toneResult = toneSettled.ok ? toneSettled.r : null;
  if (halluSettled.ok) {
    console.log(`  hallucination_score=${halluResult?.hallucination_score}  claims=${halluResult?.claims?.length ?? 0}`);
    console.log('[zero-gen.stage2.hallucination.end]', {
      ok: true,
      score: halluResult?.hallucination_score ?? null,
      claims_count: halluResult?.claims?.length ?? 0,
      elapsed_ms: halluSettled.elapsed,
    });
  } else {
    console.warn(`  hallucination FAILED: ${(halluSettled.e as Error)?.message}`);
    console.log('[zero-gen.stage2.hallucination.end]', {
      ok: false,
      score: null,
      claims_count: 0,
      elapsed_ms: halluSettled.elapsed,
      error_message: (halluSettled.e as Error)?.message ?? String(halluSettled.e),
    });
  }
  if (toneSettled.ok) {
    // RunToneChecksResult の正しい shape:
    //   { tone:{total,passed,blockers,breakdown}, centroidSimilarity, passed }
    //   - 最上位 passed = tone.passed && (sim===0 || sim>=0.85) （combined verdict）
    //   - tone.passed     = total>=0.8 && no blockers （tone-only verdict）
    // 旧コードは toneResult.tone.overallPassed を見ていたため `passed=undefined` で
    // ログが落ちていた。M11 fix で top-level passed を読むよう修正。
    const toneTopPassed = toneResult?.passed ?? false;
    const toneOnlyPassed = toneResult?.tone?.passed ?? false;
    const toneTotal = toneResult?.tone?.total ?? null;
    const centroidSim = toneResult?.centroidSimilarity ?? null;
    const blockersCount = toneResult?.tone?.blockers?.length ?? 0;
    console.log(
      `  yukiko_tone total=${toneTotal}  passed=${toneTopPassed}  centroid_sim=${centroidSim}`,
    );
    // 形状が想定と異なる場合の保険ダンプ（先頭 300 字のみ）
    if (toneResult && (toneResult.passed === undefined || toneResult.tone === undefined)) {
      console.log(
        '[zero-gen.stage2.tone.shape_dump]',
        JSON.stringify(toneResult).slice(0, 300),
      );
    }
    console.log('[zero-gen.stage2.tone.end]', {
      ok: true,
      tone_total: toneTotal,
      passed: toneTopPassed,
      tone_only_passed: toneOnlyPassed,
      centroid_similarity: centroidSim,
      blockers_count: blockersCount,
      elapsed_ms: toneSettled.elapsed,
    });
  } else {
    console.warn(`  tone FAILED: ${(toneSettled.e as Error)?.message}`);
    console.log('[zero-gen.stage2.tone.end]', {
      ok: false,
      tone_total: null,
      passed: false,
      tone_only_passed: false,
      centroid_similarity: null,
      blockers_count: 0,
      elapsed_ms: toneSettled.elapsed,
      error_message: (toneSettled.e as Error)?.message ?? String(toneSettled.e),
    });
  }

  // 6. 画像プロンプト
  console.log('\n[Stage Image Prompts] building 3 prompts...');
  let imagePrompts = { hero: '', body: '', summary: '' };
  let imagePromptsOk = false;
  try {
    imagePrompts = buildZeroImagePrompts({
      outline: article.stage1_outline as never,
      persona: { image_style: persona.image_style as never },
      theme: { visual_mood: theme.visual_mood as never, name: theme.name },
    });
    imagePromptsOk = true;
    console.log(`  hero=${imagePrompts.hero.slice(0, 60)}...`);
  } catch (e) {
    console.warn(`  image prompt FAILED: ${(e as Error).message}`);
  }
  console.log('[zero-gen.stage2.image.end]', {
    ok: imagePromptsOk,
    hero_chars: imagePrompts.hero.length,
    body_chars: imagePrompts.body.length,
    summary_chars: imagePrompts.summary.length,
  });

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
  console.log('[zero-gen.stage2.db.update.begin]', {
    articleId,
    fields: ['stage2_body_html', 'hallucination_score', 'yukiko_tone_score', 'image_prompts'],
  });
  const dbT0 = Date.now();
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
  if (upd.error) {
    console.log('[zero-gen.stage2.db.update.end]', {
      ok: false,
      error_message: upd.error.message,
      elapsed_ms: Date.now() - dbT0,
    });
    throw new Error(`UPDATE failed: ${upd.error.message}`);
  }
  console.log('  ✓ articles UPDATE 成功');
  console.log('[zero-gen.stage2.db.update.end]', {
    ok: true,
    elapsed_ms: Date.now() - dbT0,
  });

  // claims persist（テーブルが空でも安全）
  let persistClaimsOk = true;
  if (halluResult && Array.isArray(halluResult.claims) && halluResult.claims.length > 0) {
    const pcT0 = Date.now();
    try {
      await persistClaims(articleId!, halluResult.claims);
      console.log(`  ✓ persistClaims (${halluResult.claims.length})`);
      console.log('[zero-gen.stage2.persist_claims.end]', {
        ok: true,
        count: halluResult.claims.length,
        elapsed_ms: Date.now() - pcT0,
      });
    } catch (e) {
      persistClaimsOk = false;
      console.warn(`  persistClaims failed: ${(e as Error).message}`);
      console.log('[zero-gen.stage2.persist_claims.end]', {
        ok: false,
        count: halluResult.claims.length,
        elapsed_ms: Date.now() - pcT0,
        error_message: (e as Error).message,
      });
    }
  }

  // tone persist
  let persistToneOk = true;
  if (toneResult) {
    const ptT0 = Date.now();
    try {
      await persistToneScore(articleId!, toneResult);
      console.log('  ✓ persistToneScore');
      console.log('[zero-gen.stage2.persist_tone.end]', {
        ok: true,
        elapsed_ms: Date.now() - ptT0,
      });
    } catch (e) {
      persistToneOk = false;
      console.warn(`  persistToneScore failed: ${(e as Error).message}`);
      console.log('[zero-gen.stage2.persist_tone.end]', {
        ok: false,
        elapsed_ms: Date.now() - ptT0,
        error_message: (e as Error).message,
      });
    }
  }

  // article_revisions snapshot
  let revisionSnapshotOk = true;
  const rsT0 = Date.now();
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
    console.log('[zero-gen.stage2.revision_snapshot.end]', {
      ok: true,
      elapsed_ms: Date.now() - rsT0,
    });
  } catch (e) {
    revisionSnapshotOk = false;
    console.warn(`  revision snapshot failed: ${(e as Error).message}`);
    console.log('[zero-gen.stage2.revision_snapshot.end]', {
      ok: false,
      elapsed_ms: Date.now() - rsT0,
      error_message: (e as Error).message,
    });
  }

  console.log('\n✓ Stage2-Onwards 完了');
  console.log('[zero-gen.stage2.done]', {
    articleId,
    total_elapsed_ms: Date.now() - scriptStartedAt,
    body_chars: bodyHtml.length,
    hallucination_score: hallucinationScore,
    tone_total: yukikoToneScore,
    all_persists_ok: persistClaimsOk && persistToneOk && revisionSnapshotOk,
  });
}

main().catch((err) => {
  console.error('\n✗ Stage2-Onwards FAILED:', err);
  process.exit(1);
});
