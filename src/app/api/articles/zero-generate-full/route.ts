// ============================================================================
// src/app/api/articles/zero-generate-full/route.ts
// POST /api/articles/zero-generate-full
//
// spec §3 (パイプライン全体) + §12 (API) — Zero-Generation 統合 API
//
// 処理フロー:
//   1. 認証 (createServerSupabaseClient.auth.getUser)
//   2. body 検証 (zeroGenerateRequestSchema)
//   3. theme + persona を DB から取得
//   4. Stage1 outline 生成 (buildZeroOutlinePrompt + Gemini)
//   5. RAG retrieve (G2 retrieveChunks。未着地なら空)
//   6. Stage2 writing (G2 buildZeroWritingPrompt。未着地なら stage2-writing 流用)
//   7. 並列検証 (Promise.all):
//        - claim 抽出 (extractClaims)
//        - hallucination 4 検証 (G3 runHallucinationChecks)
//        - tone 検証 (G4 runToneChecks)
//      いずれも try/catch で他 Fixer 未着地時もフロー継続。
//   8. 画像プロンプト生成 (G5 buildZeroImagePrompts)
//   9. CTA variants 生成 (G9 generateCtaVariants)
//   10. articles INSERT (新規のみ。既存記事 UPDATE 禁止)
//   11. article_claims / cta_variants INSERT (G3 persistClaims, G9 persistCtaVariants)
//   12. レスポンス: 全状態を含む JSON
//        - 全成功      → 201
//        - 一部失敗    → 207 (partial)
//
// 既存 publish-control コア / articles.ts / 既存 zero-generate route は変更しない。
// マイグレ追加なし。記事本文 (html_body 等) の UPDATE は一切行わない（INSERT のみ）。
//
// 動的 import: 並列 Fixer (G2/G3/G4/G5/G9) の遅延着地に対応するため、
// 該当モジュールは try { await import(...) } catch {} でフォールバック処理を行う。
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  createServerSupabaseClient,
  createServiceRoleClient,
} from '@/lib/supabase/server';
import { generateJson } from '@/lib/ai/gemini-client';
import {
  zeroGenerateRequestSchema,
  type ZeroGenerateRequest,
} from '@/lib/validators/zero-generate';
import {
  buildZeroOutlinePrompt,
  ZERO_OUTLINE_TEMPERATURE,
  type ZeroOutlineInput,
  type ZeroOutlineOutput,
} from '@/lib/ai/prompts/stage1-zero-outline';
import { logger } from '@/lib/logger';

// ─── 型定義 ────────────────────────────────────────────────────────────────

interface ThemeRow {
  id: string;
  name: string;
  category: string | null;
  visual_mood?: unknown;
}

interface PersonaRow {
  id: string;
  name: string;
  age_range: string | null;
  tone_guide: string | null;
  image_style?: unknown;
}

interface RetrievedChunkLite {
  id?: string;
  source_article_id?: string;
  chunk_text?: string;
  similarity?: number;
}

interface PipelineStageStatus {
  outline: 'ok' | 'failed';
  rag: 'ok' | 'skipped' | 'failed';
  writing: 'ok' | 'fallback' | 'failed';
  claims: 'ok' | 'skipped' | 'failed';
  hallucination: 'ok' | 'skipped' | 'failed';
  tone: 'ok' | 'skipped' | 'failed';
  images: 'ok' | 'skipped' | 'failed';
  cta_variants: 'ok' | 'skipped' | 'failed';
  insert_article: 'ok' | 'failed';
  insert_claims: 'ok' | 'skipped' | 'failed';
  insert_cta_variants: 'ok' | 'skipped' | 'failed';
}

// ─── theme + persona 取得 ──────────────────────────────────────────────────

async function fetchThemeAndPersona(
  themeId: string,
  personaId: string,
): Promise<{ theme: ThemeRow; persona: PersonaRow }> {
  const supabase = await createServiceRoleClient();

  const [themeResult, personaResult] = await Promise.all([
    supabase
      .from('themes')
      .select('id, name, category, visual_mood')
      .eq('id', themeId)
      .maybeSingle(),
    supabase
      .from('personas')
      .select('id, name, age_range, tone_guide, image_style')
      .eq('id', personaId)
      .maybeSingle(),
  ]);

  if (themeResult.error) {
    throw new Error(`theme 取得失敗: ${themeResult.error.message}`);
  }
  if (personaResult.error) {
    throw new Error(`persona 取得失敗: ${personaResult.error.message}`);
  }
  if (!themeResult.data) {
    throw new Error(`theme not found: ${themeId}`);
  }
  if (!personaResult.data) {
    throw new Error(`persona not found: ${personaId}`);
  }

  return {
    theme: themeResult.data as ThemeRow,
    persona: personaResult.data as PersonaRow,
  };
}

// ─── Stage1 outline 生成 ────────────────────────────────────────────────────

async function generateStage1Outline(
  zeroInput: ZeroOutlineInput,
): Promise<ZeroOutlineOutput> {
  const { system, user: userPrompt } = buildZeroOutlinePrompt(zeroInput);

  const { data: outline } = await generateJson<ZeroOutlineOutput>(
    system,
    userPrompt,
    {
      temperature: ZERO_OUTLINE_TEMPERATURE,
      topP: 0.9,
    },
  );

  return outline;
}

// ─── RAG retrieve (G2 未着地時は空配列) ─────────────────────────────────────

async function retrieveRagChunks(input: {
  theme: string;
  persona_pain: string;
  keywords: string[];
}): Promise<{ chunks: RetrievedChunkLite[]; status: 'ok' | 'skipped' | 'failed' }> {
  try {
    const ragModule = await import('@/lib/rag/retrieve-chunks').catch(() => null);
    if (!ragModule || typeof ragModule.retrieveChunks !== 'function') {
      return { chunks: [], status: 'skipped' };
    }
    const supabase = await createServiceRoleClient();
    const result = await ragModule.retrieveChunks(supabase, input);
    return {
      chunks: (result?.chunks ?? []) as RetrievedChunkLite[],
      status: 'ok',
    };
  } catch (err) {
    logger.warn('api', 'zero-generate-full.rag_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { chunks: [], status: 'failed' };
  }
}

// ─── Stage2 writing (G2 未着地時は stage2-writing 流用) ─────────────────────

async function generateStage2Body(args: {
  outline: ZeroOutlineOutput;
  theme: ThemeRow;
  persona: PersonaRow;
  keywords: string[];
  intent: ZeroGenerateRequest['intent'];
  target_length: number;
  ragChunks: RetrievedChunkLite[];
}): Promise<{ html: string; status: 'ok' | 'fallback' | 'failed' }> {
  // G2 buildZeroWritingPrompt が着地していれば優先
  let zeroBuilder:
    | ((input: unknown) => { system: string; user: string })
    | null = null;
  try {
    const zeroWritingModule = (await import(
      /* webpackIgnore: true */ '@/lib/ai/prompts/stage2-zero-writing'
    )) as { buildZeroWritingPrompt?: unknown };
    const candidate = zeroWritingModule?.buildZeroWritingPrompt;
    if (typeof candidate === 'function') {
      zeroBuilder = candidate as (input: unknown) => {
        system: string;
        user: string;
      };
    }
  } catch {
    zeroBuilder = null;
  }
  if (zeroBuilder) {
    try {
      const prompt = zeroBuilder({
        outline: args.outline,
        theme: args.theme,
        persona: args.persona,
        keywords: args.keywords,
        intent: args.intent,
        target_length: args.target_length,
        rag_chunks: args.ragChunks,
      });
      const { data } = await generateJson<{ html: string } | string>(
        prompt.system,
        prompt.user,
        { temperature: 0.7, topP: 0.9 },
      );
      const html =
        typeof data === 'string'
          ? data
          : (data as { html?: string })?.html ?? '';
      return { html, status: 'ok' };
    } catch (err) {
      logger.warn('api', 'zero-generate-full.zero_writing_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // フォールバック: 既存 stage2-writing を流用（input shape を組み立てる）
  try {
    const fallback = await import('@/lib/ai/prompts/stage2-writing');
    const stage2Input = {
      keyword: args.keywords[0] ?? '',
      theme: args.theme.name,
      targetPersona: args.persona.name,
      perspectiveType: args.intent,
      targetWordCount: args.target_length,
      outline: {
        title_proposal:
          args.outline.h2_chapters?.[0]?.title ?? args.keywords[0] ?? '',
        headings: (args.outline.h2_chapters ?? []).map((c) => ({
          level: 'h2',
          text: c.title,
          estimated_words: c.target_chars,
        })),
        faq: (args.outline.faq_items ?? []).map((f) => ({
          question: f.q,
          answer: f.a,
        })),
        cta_texts: [],
        cta_positions: [],
        image_prompts: (args.outline.image_prompts ?? []).map((p) => ({
          section_id: p.slot,
          suggested_filename: `${p.slot}.png`,
          prompt: p.prompt,
        })),
      },
    } as unknown as Parameters<typeof fallback.buildWritingPrompt>[0];

    const prompt = fallback.buildWritingPrompt(stage2Input);
    const { data } = await generateJson<{ html: string } | string>(
      prompt.system,
      prompt.user,
      { temperature: 0.7, topP: 0.9 },
    );
    const html =
      typeof data === 'string'
        ? data
        : (data as { html?: string })?.html ?? '';
    return { html, status: 'fallback' };
  } catch (err) {
    logger.error(
      'api',
      'zero-generate-full.stage2_fallback_failed',
      undefined,
      err,
    );
    return { html: '', status: 'failed' };
  }
}

// ─── claim 抽出 ────────────────────────────────────────────────────────────

async function runClaimExtraction(htmlBody: string) {
  try {
    const mod = await import('@/lib/hallucination/claim-extractor').catch(
      () => null,
    );
    if (!mod || typeof mod.extractClaims !== 'function') {
      return { claims: [] as unknown[], status: 'skipped' as const };
    }
    const claims = await mod.extractClaims(htmlBody);
    return { claims: claims as unknown[], status: 'ok' as const };
  } catch (err) {
    logger.warn('api', 'zero-generate-full.claims_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { claims: [] as unknown[], status: 'failed' as const };
  }
}

// ─── hallucination 4 検証 (G3) ─────────────────────────────────────────────

interface HallucinationResultLite {
  hallucination_score?: number;
  criticals?: number;
  results?: unknown[];
  summary?: unknown;
}

async function runHallucination(htmlBody: string): Promise<{
  result: HallucinationResultLite;
  status: 'ok' | 'skipped' | 'failed';
}> {
  try {
    const mod = await import('@/lib/hallucination/run-checks').catch(
      () => null,
    );
    if (!mod || typeof mod.runHallucinationChecks !== 'function') {
      return { result: {}, status: 'skipped' };
    }
    const result = (await mod.runHallucinationChecks(
      htmlBody,
    )) as HallucinationResultLite;
    return { result, status: 'ok' };
  } catch (err) {
    logger.warn('api', 'zero-generate-full.hallucination_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { result: {}, status: 'failed' };
  }
}

// ─── tone 検証 (G4) ────────────────────────────────────────────────────────

interface ToneResultLite {
  tone?: { total?: number; passed?: boolean };
  centroidSimilarity?: number;
  passed?: boolean;
}

async function runTone(htmlBody: string): Promise<{
  result: ToneResultLite;
  status: 'ok' | 'skipped' | 'failed';
}> {
  try {
    const mod = await import('@/lib/tone/run-tone-checks').catch(() => null);
    if (!mod || typeof mod.runToneChecks !== 'function') {
      return { result: {}, status: 'skipped' };
    }
    const result = (await mod.runToneChecks(htmlBody)) as ToneResultLite;
    return { result, status: 'ok' };
  } catch (err) {
    logger.warn('api', 'zero-generate-full.tone_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { result: {}, status: 'failed' };
  }
}

// ─── 画像プロンプト生成 (G5) ───────────────────────────────────────────────

interface ImagePromptsResult {
  hero?: string;
  body?: string;
  summary?: string;
}

async function runImagePrompts(args: {
  outline: ZeroOutlineOutput;
  theme: ThemeRow;
  persona: PersonaRow;
}): Promise<{ result: ImagePromptsResult; status: 'ok' | 'skipped' | 'failed' }> {
  try {
    const mod = await import('@/lib/ai/prompts/zero-image-prompt').catch(
      () => null,
    );
    if (!mod || typeof mod.buildZeroImagePrompts !== 'function') {
      return { result: {}, status: 'skipped' };
    }
    const result = mod.buildZeroImagePrompts({
      outline: args.outline,
      persona: { image_style: args.persona.image_style as never },
      theme: { visual_mood: args.theme.visual_mood as never, name: args.theme.name },
    }) as ImagePromptsResult;
    return { result, status: 'ok' };
  } catch (err) {
    logger.warn('api', 'zero-generate-full.image_prompts_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { result: {}, status: 'failed' };
  }
}

// ─── CTA variants 生成 (G9) ────────────────────────────────────────────────

interface CtaVariantsResult {
  variants?: unknown[];
}

async function runCtaVariants(args: {
  outline: ZeroOutlineOutput;
  theme: ThemeRow;
  persona: PersonaRow;
  intent: ZeroGenerateRequest['intent'];
}): Promise<{ result: CtaVariantsResult; status: 'ok' | 'skipped' | 'failed' }> {
  // 既知候補パスをいくつか試す（G9 が確定パスを最終決めしたら更新）
  const candidatePaths = [
    '@/lib/cta/generate-variants',
    '@/lib/cta-variants/generate',
    '@/lib/content/cta-variants',
  ];
  for (const p of candidatePaths) {
    let fn: ((input: unknown) => Promise<CtaVariantsResult>) | null = null;
    try {
      const mod = (await import(/* webpackIgnore: true */ p)) as {
        generateCtaVariants?: unknown;
      };
      // 一部のテスト/auto-mock 系では未定義エクスポートへのアクセス時に
      // 例外を投げる実装があるため、プロパティ取得自体も try で覆う
      const candidate = mod?.generateCtaVariants;
      if (typeof candidate === 'function') {
        fn = candidate as (input: unknown) => Promise<CtaVariantsResult>;
      }
    } catch {
      continue; // モジュール未着地 / プロパティ未定義 → 次候補
    }
    if (!fn) continue;
    try {
      const result = await fn({
        outline: args.outline,
        theme: args.theme,
        persona: args.persona,
        intent: args.intent,
      });
      return { result: result ?? { variants: [] }, status: 'ok' };
    } catch (err) {
      logger.warn('api', 'zero-generate-full.cta_path_failed', {
        path: p,
        error: err instanceof Error ? err.message : String(err),
      });
      return { result: { variants: [] }, status: 'failed' };
    }
  }
  return { result: { variants: [] }, status: 'skipped' };
}

// ─── articles INSERT ──────────────────────────────────────────────────────

async function insertZeroArticle(args: {
  keywords: string[];
  intent: ZeroGenerateRequest['intent'];
  target_length: number;
  outline: ZeroOutlineOutput;
  themeName: string;
  personaName: string;
  bodyHtml: string;
  hallucinationScore: number | null;
  yukikoToneScore: number | null;
}): Promise<{ id: string }> {
  const supabase = await createServiceRoleClient();

  const insertPayload: Record<string, unknown> = {
    status: 'draft',
    generation_mode: 'zero',
    intent: args.intent,
    keyword: args.keywords.join(', '),
    theme: args.themeName,
    persona: args.personaName,
    target_word_count: args.target_length,
    title:
      args.outline.h2_chapters?.[0]?.title ??
      args.keywords[0] ??
      'untitled',
    stage1_outline: args.outline,
    stage2_body_html: args.bodyHtml,
    html_body: args.bodyHtml,
    lead_summary: args.outline.lead_summary ?? null,
    narrative_arc: args.outline.narrative_arc ?? null,
    emotion_curve: args.outline.emotion_curve ?? null,
    citation_highlights: args.outline.citation_highlights ?? null,
    hallucination_score: args.hallucinationScore,
    yukiko_tone_score: args.yukikoToneScore,
  };

  const { data, error } = await supabase
    .from('articles')
    .insert(insertPayload)
    .select('id')
    .single();

  if (error) {
    throw new Error(`articles INSERT 失敗: ${error.message}`);
  }
  return { id: (data as { id: string }).id };
}

// ─── article_claims persist (G3) ───────────────────────────────────────────

type PersistClaimsFn = (
  articleId: string,
  claims: unknown[],
  results?: unknown[],
) => Promise<unknown>;

async function persistClaimsIfPossible(
  articleId: string,
  claims: unknown[],
  hallucinationResults: unknown[],
): Promise<'ok' | 'skipped' | 'failed'> {
  if (!Array.isArray(claims) || claims.length === 0) return 'skipped';
  // モジュール自体が未着地 → skipped、着地済みで実行が失敗 → failed
  let fn: PersistClaimsFn | null = null;
  try {
    const mod = (await import(
      /* webpackIgnore: true */ '@/lib/hallucination/persist-claims'
    )) as { persistClaims?: unknown };
    const candidate = mod?.persistClaims;
    if (typeof candidate === 'function') {
      fn = candidate as PersistClaimsFn;
    }
  } catch {
    return 'skipped';
  }
  if (!fn) return 'skipped';
  try {
    await fn(articleId, claims, hallucinationResults);
    return 'ok';
  } catch (err) {
    logger.warn('api', 'zero-generate-full.persist_claims_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return 'failed';
  }
}

// ─── cta_variants persist (G9) ─────────────────────────────────────────────

type PersistCtaFn = (
  articleId: string,
  variants: unknown[],
) => Promise<unknown>;

async function persistCtaVariantsIfPossible(
  articleId: string,
  variants: unknown[],
): Promise<'ok' | 'skipped' | 'failed'> {
  if (!Array.isArray(variants) || variants.length === 0) return 'skipped';
  const candidatePaths = [
    '@/lib/cta/persist-variants',
    '@/lib/cta-variants/persist',
    '@/lib/content/cta-variants-persist',
  ];
  for (const p of candidatePaths) {
    let fn: PersistCtaFn | null = null;
    try {
      const mod = (await import(/* webpackIgnore: true */ p)) as {
        persistCtaVariants?: unknown;
      };
      const candidate = mod?.persistCtaVariants;
      if (typeof candidate === 'function') {
        fn = candidate as PersistCtaFn;
      }
    } catch {
      continue; // モジュール未着地 / プロパティ未定義 → 次候補
    }
    if (!fn) continue;
    try {
      await fn(articleId, variants);
      return 'ok';
    } catch (err) {
      logger.warn('api', 'zero-generate-full.persist_cta_failed', {
        path: p,
        error: err instanceof Error ? err.message : String(err),
      });
      return 'failed';
    }
  }
  return 'skipped';
}

// ─── POST ハンドラ ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const stages: PipelineStageStatus = {
    outline: 'failed',
    rag: 'skipped',
    writing: 'failed',
    claims: 'skipped',
    hallucination: 'skipped',
    tone: 'skipped',
    images: 'skipped',
    cta_variants: 'skipped',
    insert_article: 'failed',
    insert_claims: 'skipped',
    insert_cta_variants: 'skipped',
  };

  try {
    // 1. 認証
    const authClient = await createServerSupabaseClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: '認証が必要です' },
        { status: 401 },
      );
    }

    // 2. body 検証
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: 'バリデーションエラー',
          details: { _errors: ['JSON が不正です'] },
        },
        { status: 400 },
      );
    }
    const parsed = zeroGenerateRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'バリデーションエラー', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const body: ZeroGenerateRequest = parsed.data;

    // 3. theme + persona
    const { theme, persona } = await fetchThemeAndPersona(
      body.theme_id,
      body.persona_id,
    );

    // 4. Stage1 outline
    const zeroInput: ZeroOutlineInput = {
      theme: {
        id: theme.id,
        name: theme.name,
        category: theme.category ?? undefined,
      },
      persona: {
        id: persona.id,
        name: persona.name,
        age_range: persona.age_range ?? undefined,
        tone_guide: persona.tone_guide ?? undefined,
      },
      keywords: body.keywords,
      intent: body.intent,
      target_length: body.target_length,
    };
    const outline = await generateStage1Outline(zeroInput);
    stages.outline = 'ok';

    // 5. RAG retrieve
    const rag = await retrieveRagChunks({
      theme: theme.name,
      persona_pain: persona.tone_guide ?? '',
      keywords: body.keywords,
    });
    stages.rag = rag.status;

    // 6. Stage2 writing
    const stage2 = await generateStage2Body({
      outline,
      theme,
      persona,
      keywords: body.keywords,
      intent: body.intent,
      target_length: body.target_length,
      ragChunks: rag.chunks,
    });
    stages.writing = stage2.status;
    const bodyHtml = stage2.html;

    // 7. 並列検証 (claim / hallucination / tone)
    const [claimsResult, halluResult, toneResult] = await Promise.all([
      runClaimExtraction(bodyHtml),
      runHallucination(bodyHtml),
      runTone(bodyHtml),
    ]);
    stages.claims = claimsResult.status;
    stages.hallucination = halluResult.status;
    stages.tone = toneResult.status;

    // 8. 画像プロンプト
    const images = await runImagePrompts({ outline, theme, persona });
    stages.images = images.status;

    // 9. CTA variants
    const ctaVariants = await runCtaVariants({
      outline,
      theme,
      persona,
      intent: body.intent,
    });
    stages.cta_variants = ctaVariants.status;

    // 10. articles INSERT
    const hallucinationScore =
      typeof halluResult.result.hallucination_score === 'number'
        ? halluResult.result.hallucination_score
        : null;
    const yukikoToneScore =
      typeof toneResult.result.tone?.total === 'number'
        ? toneResult.result.tone.total
        : null;

    const { id: articleId } = await insertZeroArticle({
      keywords: body.keywords,
      intent: body.intent,
      target_length: body.target_length,
      outline,
      themeName: theme.name,
      personaName: persona.name,
      bodyHtml,
      hallucinationScore,
      yukikoToneScore,
    });
    stages.insert_article = 'ok';

    // 11. article_claims / cta_variants INSERT
    stages.insert_claims = await persistClaimsIfPossible(
      articleId,
      claimsResult.claims,
      halluResult.result.results ?? [],
    );
    stages.insert_cta_variants = await persistCtaVariantsIfPossible(
      articleId,
      ctaVariants.result.variants ?? [],
    );

    // 12. レスポンス
    const partial =
      stages.rag === 'failed' ||
      stages.writing === 'failed' ||
      stages.claims === 'failed' ||
      stages.hallucination === 'failed' ||
      stages.tone === 'failed' ||
      stages.images === 'failed' ||
      stages.cta_variants === 'failed' ||
      stages.insert_claims === 'failed' ||
      stages.insert_cta_variants === 'failed';

    const responseBody = {
      article_id: articleId,
      status: 'draft' as const,
      generation_mode: 'zero' as const,
      partial_success: partial,
      stages,
      lead_summary: outline.lead_summary ?? null,
      narrative_arc: outline.narrative_arc ?? null,
      scores: {
        hallucination: hallucinationScore,
        yukiko_tone: yukikoToneScore,
        centroid_similarity: toneResult.result.centroidSimilarity ?? null,
      },
      claims_count: Array.isArray(claimsResult.claims)
        ? claimsResult.claims.length
        : 0,
      criticals: halluResult.result.criticals ?? 0,
      tone_passed: toneResult.result.passed ?? null,
      rag: {
        chunks_count: rag.chunks.length,
        status: rag.status,
      },
      image_prompts: images.result,
      cta_variants_count: Array.isArray(ctaVariants.result.variants)
        ? ctaVariants.result.variants.length
        : 0,
      duration_ms: Date.now() - startedAt,
    };

    logger.info('api', 'zero-generate-full.completed', {
      articleId,
      partial,
      stages,
      durationMs: responseBody.duration_ms,
    });

    return NextResponse.json(responseBody, { status: partial ? 207 : 201 });
  } catch (error) {
    logger.error(
      'api',
      'zero-generate-full.failed',
      { stages },
      error,
    );
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'zero-generate-full に失敗しました',
        stages,
      },
      { status: 500 },
    );
  }
}
