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
//   5. RAG retrieve (G2 retrieveChunks。warning なら空配列)
//   6. Stage2 writing 生成 (G2 buildZeroWritingPrompt + Gemini) → htmlBody
//   7. 並列検証 (Promise.all):
//        - claim 抽出 + 4 検証 (G3 runHallucinationChecks 内で完結)
//        - tone 検証 (G4 runToneChecks)
//   8. 画像プロンプト生成 (G5 buildZeroImagePrompts) — 実画像生成は本タスク外
//   9. CTA variants 生成 (G9 generateCtaVariants)
//   10. articles INSERT (status='draft', generation_mode='zero', stage1_outline,
//       stage2_body_html, lead_summary, narrative_arc, citation_highlights,
//       intent, hallucination_score, yukiko_tone_score)
//   11. persistClaims / persistCtaVariants / persistToneScore
//   12. article_revisions に履歴 INSERT (HTML 履歴ルール / 'auto_snapshot')
//   13. レスポンス: 全状態を含む JSON
//        - 全成功      → 201
//        - 一部失敗    → 207 (partial_success=true)
//
// 既存 publish-control コア / articles.ts / 既存 zero-generate route は変更しない。
// マイグレ追加なし。記事本文 (html_body 等) の UPDATE は一切行わない（INSERT のみ）。
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
import {
  buildZeroWritingPrompt,
  ZERO_WRITING_TEMPERATURE,
  type ZeroWritingInput,
  type RetrievedChunk as ZeroWritingRetrievedChunk,
} from '@/lib/ai/prompts/stage2-zero-writing';
import { retrieveChunks } from '@/lib/rag/retrieve-chunks';
import { runHallucinationChecks } from '@/lib/hallucination/run-checks';
import { persistClaims } from '@/lib/hallucination/persist-claims';
import { runToneChecks } from '@/lib/tone/run-tone-checks';
import { persistToneScore } from '@/lib/tone/persist-tone';
import { buildZeroImagePrompts } from '@/lib/ai/prompts/zero-image-prompt';
import { generateCtaVariants } from '@/lib/content/cta-variants-generator';
import { persistCtaVariants } from '@/lib/content/persist-cta-variants';
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

interface PipelineStageStatus {
  outline: 'ok' | 'failed';
  rag: 'ok' | 'skipped' | 'failed';
  writing: 'ok' | 'failed';
  hallucination: 'ok' | 'skipped' | 'failed';
  tone: 'ok' | 'skipped' | 'failed';
  images: 'ok' | 'skipped' | 'failed';
  cta_variants: 'ok' | 'skipped' | 'failed';
  insert_article: 'ok' | 'failed';
  insert_claims: 'ok' | 'skipped' | 'failed';
  insert_cta_variants: 'ok' | 'skipped' | 'failed';
  insert_tone: 'ok' | 'skipped' | 'failed';
  insert_revision: 'ok' | 'skipped' | 'failed';
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

// ─── RAG retrieve ───────────────────────────────────────────────────────────

async function retrieveRagChunks(input: {
  theme: string;
  persona_pain: string;
  keywords: string[];
}): Promise<{
  chunks: ZeroWritingRetrievedChunk[];
  status: 'ok' | 'skipped' | 'failed';
}> {
  try {
    const supabase = await createServiceRoleClient();
    const result = await retrieveChunks(supabase, {
      theme: input.theme,
      persona_pain: input.persona_pain,
      keywords: input.keywords,
      similarityThreshold: 0.75,
    });
    // warning='insufficient_grounding' なら status='skipped' で空チャンクのまま継続
    if (!result.chunks || result.chunks.length === 0) {
      return { chunks: [], status: result.warning ? 'skipped' : 'ok' };
    }
    // ZeroWritingRetrievedChunk 形式 (text/similarity) に整形
    const chunks: ZeroWritingRetrievedChunk[] = result.chunks.map((c) => ({
      text: c.chunk_text,
      similarity: c.similarity,
    }));
    return { chunks, status: 'ok' };
  } catch (err) {
    logger.warn('api', 'zero-generate-full.rag_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { chunks: [], status: 'failed' };
  }
}

// ─── Stage2 writing 生成 ────────────────────────────────────────────────────

async function generateStage2Body(args: {
  outline: ZeroOutlineOutput;
  theme: ThemeRow;
  persona: PersonaRow;
  retrievedChunks: ZeroWritingRetrievedChunk[];
}): Promise<string> {
  const writingInput: ZeroWritingInput = {
    outline: args.outline,
    persona: {
      id: args.persona.id,
      name: args.persona.name,
      age_range: args.persona.age_range ?? undefined,
      tone_guide: args.persona.tone_guide ?? undefined,
    },
    theme: {
      id: args.theme.id,
      name: args.theme.name,
      category: args.theme.category ?? undefined,
    },
    retrievedChunks: args.retrievedChunks,
  };

  const { system, user: userPrompt } = buildZeroWritingPrompt(writingInput);

  const { data } = await generateJson<{ html: string } | string>(
    system,
    userPrompt,
    { temperature: ZERO_WRITING_TEMPERATURE, topP: 0.9 },
  );

  if (typeof data === 'string') return data;
  return (data as { html?: string })?.html ?? '';
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

// ─── article_revisions INSERT (HTML 履歴ルール) ───────────────────────────
//
// 新規生成直後の auto_snapshot として、生成された HTML を履歴に積む。
// 既存 saveRevision ヘルパは複数テーブル（articles 等）を参照するため、
// ここでは article_revisions のみへ最小 INSERT を行う独自実装。
// 失敗しても本フローは partial_success で継続させる。
async function insertAutoSnapshot(
  articleId: string,
  bodyHtml: string,
  title: string,
  userId: string | null,
): Promise<void> {
  const supabase = await createServiceRoleClient();
  const { error } = await supabase.from('article_revisions').insert({
    article_id: articleId,
    revision_number: 1,
    html_snapshot: bodyHtml,
    change_type: 'auto_snapshot',
    changed_by: userId,
    comment: JSON.stringify({ title, source: 'zero-generate-full' }),
  });
  if (error) {
    throw new Error(
      `article_revisions INSERT 失敗: ${error.message}`,
    );
  }
}

// ─── slug 生成（CTA UTM 用） ──────────────────────────────────────────────

function buildArticleSlug(articleId: string, title: string): string {
  // CTA は articleSlug 必須。タイトルが空の場合は articleId を使うフォールバック。
  const safeTitle = title
    .toLowerCase()
    .replace(/[\s　]+/g, '-')
    .replace(/[^a-z0-9\-_]/gu, '')
    .slice(0, 32);
  return safeTitle || `article-${articleId.slice(0, 8)}`;
}

// ─── POST ハンドラ ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const stages: PipelineStageStatus = {
    outline: 'failed',
    rag: 'skipped',
    writing: 'failed',
    hallucination: 'skipped',
    tone: 'skipped',
    images: 'skipped',
    cta_variants: 'skipped',
    insert_article: 'failed',
    insert_claims: 'skipped',
    insert_cta_variants: 'skipped',
    insert_tone: 'skipped',
    insert_revision: 'skipped',
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
    let bodyHtml = '';
    try {
      bodyHtml = await generateStage2Body({
        outline,
        theme,
        persona,
        retrievedChunks: rag.chunks,
      });
      stages.writing = 'ok';
    } catch (err) {
      logger.error(
        'api',
        'zero-generate-full.writing_failed',
        undefined,
        err,
      );
      stages.writing = 'failed';
      // writing 失敗時は記事 INSERT に進めないので 500 で返す
      throw err;
    }

    // 7. 並列検証 (claim 抽出 + 4 検証 + tone)
    const [halluSettled, toneSettled] = await Promise.all([
      runHallucinationChecks(bodyHtml).then(
        (result) => ({ ok: true as const, result }),
        (err: unknown) => ({ ok: false as const, err }),
      ),
      runToneChecks(bodyHtml).then(
        (result) => ({ ok: true as const, result }),
        (err: unknown) => ({ ok: false as const, err }),
      ),
    ]);

    const halluResult = halluSettled.ok ? halluSettled.result : null;
    if (halluSettled.ok) {
      stages.hallucination = 'ok';
    } else {
      stages.hallucination = 'failed';
      logger.warn('api', 'zero-generate-full.hallucination_failed', {
        error:
          halluSettled.err instanceof Error
            ? halluSettled.err.message
            : String(halluSettled.err),
      });
    }

    const toneResult = toneSettled.ok ? toneSettled.result : null;
    if (toneSettled.ok) {
      stages.tone = 'ok';
    } else {
      stages.tone = 'failed';
      logger.warn('api', 'zero-generate-full.tone_failed', {
        error:
          toneSettled.err instanceof Error
            ? toneSettled.err.message
            : String(toneSettled.err),
      });
    }

    // 8. 画像プロンプト
    let imagePrompts: { hero: string; body: string; summary: string } = {
      hero: '',
      body: '',
      summary: '',
    };
    try {
      imagePrompts = buildZeroImagePrompts({
        outline,
        persona: { image_style: persona.image_style as never },
        theme: {
          visual_mood: theme.visual_mood as never,
          name: theme.name,
        },
      });
      stages.images = 'ok';
    } catch (err) {
      logger.warn('api', 'zero-generate-full.image_prompts_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      stages.images = 'failed';
    }

    // 10. articles INSERT（11 → 9 の順を保つため、CTA 生成は INSERT 後 articleId が必要なら後段）
    const hallucinationScore =
      halluResult && typeof halluResult.hallucination_score === 'number'
        ? halluResult.hallucination_score
        : null;
    const yukikoToneScore =
      toneResult && typeof toneResult.tone?.total === 'number'
        ? toneResult.tone.total
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

    const articleTitle =
      outline.h2_chapters?.[0]?.title ?? body.keywords[0] ?? 'untitled';
    const articleSlug = buildArticleSlug(articleId, articleTitle);

    // 9. CTA variants 生成
    let ctaVariants: Awaited<ReturnType<typeof generateCtaVariants>> = [];
    try {
      ctaVariants = generateCtaVariants({
        articleSlug,
        persona: {
          id: persona.id,
          name: persona.name,
          age_range: persona.age_range,
        },
        intent: body.intent,
      });
      stages.cta_variants = ctaVariants.length > 0 ? 'ok' : 'skipped';
    } catch (err) {
      logger.warn('api', 'zero-generate-full.cta_variants_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      stages.cta_variants = 'failed';
    }

    // 11. persistClaims / persistCtaVariants / persistToneScore
    if (halluResult && Array.isArray(halluResult.claims) && halluResult.claims.length > 0) {
      try {
        await persistClaims(articleId, halluResult.claims);
        stages.insert_claims = 'ok';
      } catch (err) {
        logger.warn('api', 'zero-generate-full.persist_claims_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        stages.insert_claims = 'failed';
      }
    } else {
      stages.insert_claims = 'skipped';
    }

    if (Array.isArray(ctaVariants) && ctaVariants.length > 0) {
      try {
        await persistCtaVariants(articleId, ctaVariants);
        stages.insert_cta_variants = 'ok';
      } catch (err) {
        logger.warn('api', 'zero-generate-full.persist_cta_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        stages.insert_cta_variants = 'failed';
      }
    } else {
      stages.insert_cta_variants = 'skipped';
    }

    if (toneResult) {
      try {
        await persistToneScore(articleId, toneResult);
        stages.insert_tone = 'ok';
      } catch (err) {
        logger.warn('api', 'zero-generate-full.persist_tone_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        stages.insert_tone = 'failed';
      }
    } else {
      stages.insert_tone = 'skipped';
    }

    // 12. article_revisions に履歴 INSERT (HTML 履歴ルール)
    try {
      await insertAutoSnapshot(articleId, bodyHtml, articleTitle, user.id);
      stages.insert_revision = 'ok';
    } catch (err) {
      logger.warn('api', 'zero-generate-full.insert_revision_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      stages.insert_revision = 'failed';
    }

    // 13. レスポンス
    // writing は失敗時に throw して 500 へ抜けるため、ここでは ok 固定。
    const partial =
      stages.rag === 'failed' ||
      stages.hallucination === 'failed' ||
      stages.tone === 'failed' ||
      stages.images === 'failed' ||
      stages.cta_variants === 'failed' ||
      stages.insert_claims === 'failed' ||
      stages.insert_cta_variants === 'failed' ||
      stages.insert_tone === 'failed' ||
      stages.insert_revision === 'failed';

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
        centroid_similarity: toneResult?.centroidSimilarity ?? null,
      },
      claims_count:
        halluResult && Array.isArray(halluResult.claims)
          ? halluResult.claims.length
          : 0,
      criticals: halluResult?.criticals ?? 0,
      tone_passed: toneResult?.passed ?? null,
      rag: {
        chunks_count: rag.chunks.length,
        status: rag.status,
      },
      image_prompts: imagePrompts,
      cta_variants_count: Array.isArray(ctaVariants) ? ctaVariants.length : 0,
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
