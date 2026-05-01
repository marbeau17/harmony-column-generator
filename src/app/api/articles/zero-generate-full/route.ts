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
// エラーハンドリング:
//   - validation 系   → 400
//   - 認証            → 401
//   - upstream 失敗   → 502 (Gemini API down 等)
//   - DB error        → 500
//   - その他想定外    → 500
//   レスポンスには `stages` と `failures` を含めフロントが分析しやすい形にする。
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

type StageName =
  | 'outline'
  | 'rag'
  | 'writing'
  | 'claim_extraction'
  | 'hallucination'
  | 'tone'
  | 'image'
  | 'cta'
  | 'db_insert'
  | 'persist_claims'
  | 'persist_cta'
  | 'persist_tone'
  | 'article_revisions';

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

interface FailureEntry {
  stage: StageName;
  status: 'failed';
  error_message: string;
}

// ─── request_id 生成（trace 用） ─────────────────────────────────────────────

function generateRequestId(): string {
  // Web Crypto に対応している環境では UUID を、なければ簡易ランダム ID を返す。
  try {
    if (
      typeof globalThis !== 'undefined' &&
      'crypto' in globalThis &&
      typeof (globalThis.crypto as Crypto).randomUUID === 'function'
    ) {
      return (globalThis.crypto as Crypto).randomUUID();
    }
  } catch {
    // fallthrough
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── エラー要約ヘルパ ───────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * stage 失敗の構造化ログ + failures 配列への追記をまとめて行う。
 * - logger.error('api', action, details, error) として吐く
 * - details には request_id / stage / articleId? を含める
 */
function recordStageFailure(
  failures: FailureEntry[],
  stage: StageName,
  err: unknown,
  ctx: { requestId: string; articleId?: string | null },
): void {
  const message = errorMessage(err);
  failures.push({ stage, status: 'failed', error_message: message });
  logger.error(
    'api',
    `zero-generate-full.${stage}_failed`,
    {
      stage,
      request_id: ctx.requestId,
      ...(ctx.articleId ? { article_id: ctx.articleId } : {}),
    },
    err,
  );
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
  error?: unknown;
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
    return { chunks: [], status: 'failed', error: err };
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
  const requestId = generateRequestId();
  console.log('[zero-gen.full.request.begin]', {
    requestId,
    startedAt: new Date().toISOString(),
  });
  const failures: FailureEntry[] = [];
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

  // 1. 認証（401）
  let userId: string | null = null;
  try {
    const authClient = await createServerSupabaseClient();
    const {
      data: { user },
    } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: '認証が必要です', request_id: requestId },
        { status: 401 },
      );
    }
    userId = user.id;
    const email = user.email ?? '';
    const emailLocal = email.includes('@') ? email.split('@')[0] : email;
    console.log('[zero-gen.full.auth.ok]', {
      requestId,
      userId,
      email_masked: emailLocal.slice(0, 3) + '***',
    });
  } catch (err) {
    logger.error(
      'api',
      'zero-generate-full.auth_failed',
      { stage: 'auth', request_id: requestId },
      err,
    );
    return NextResponse.json(
      {
        error: '認証処理に失敗しました',
        stage: 'auth',
        request_id: requestId,
        detail: errorMessage(err),
      },
      { status: 401 },
    );
  }

  // 2. body 検証（400）
  let body: ZeroGenerateRequest;
  try {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: 'バリデーションエラー',
          stage: 'validation',
          request_id: requestId,
          details: { _errors: ['JSON が不正です'] },
        },
        { status: 400 },
      );
    }
    const parsed = zeroGenerateRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'バリデーションエラー',
          stage: 'validation',
          request_id: requestId,
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }
    body = parsed.data;
    console.log('[zero-gen.full.body.validated]', {
      requestId,
      theme_id: body.theme_id,
      persona_id: body.persona_id,
      intent: body.intent,
      target_length: body.target_length,
      keywords_count: body.keywords.length,
    });
  } catch (err) {
    logger.error(
      'api',
      'zero-generate-full.validation_failed',
      { stage: 'validation', request_id: requestId },
      err,
    );
    return NextResponse.json(
      {
        error: 'バリデーションエラー',
        stage: 'validation',
        request_id: requestId,
        detail: errorMessage(err),
      },
      { status: 400 },
    );
  }

  // 3. theme + persona 取得（DB error → 500）
  let theme: ThemeRow;
  let persona: PersonaRow;
  try {
    const fetched = await fetchThemeAndPersona(body.theme_id, body.persona_id);
    theme = fetched.theme;
    persona = fetched.persona;
    console.log('[zero-gen.full.refs.resolved]', {
      requestId,
      theme_name: theme.name,
      persona_name: persona.name,
      has_visual_mood: theme.visual_mood != null,
      has_image_style: persona.image_style != null,
    });
  } catch (err) {
    logger.error(
      'api',
      'zero-generate-full.theme_persona_failed',
      { stage: 'db_insert', request_id: requestId },
      err,
    );
    return NextResponse.json(
      {
        error: 'theme/persona 取得失敗',
        stage: 'db_insert',
        request_id: requestId,
        detail: errorMessage(err),
        stages,
        failures: [
          { stage: 'db_insert' as const, status: 'failed' as const, error_message: errorMessage(err) },
        ],
      },
      { status: 500 },
    );
  }

  // 4. Stage1 outline 生成（upstream Gemini → 502）
  let outline: ZeroOutlineOutput;
  console.log('[zero-gen.full.outline.begin]', { requestId });
  const outlineStartedAt = Date.now();
  try {
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
    outline = await generateStage1Outline(zeroInput);
    stages.outline = 'ok';
    console.log('[zero-gen.full.outline.end]', {
      requestId,
      ok: true,
      h2_chapters_count: Array.isArray(outline.h2_chapters)
        ? outline.h2_chapters.length
        : 0,
      citation_highlights_count: Array.isArray(outline.citation_highlights)
        ? outline.citation_highlights.length
        : 0,
      faq_count: Array.isArray((outline as { faq?: unknown[] }).faq)
        ? ((outline as { faq?: unknown[] }).faq as unknown[]).length
        : 0,
      elapsed_ms: Date.now() - outlineStartedAt,
    });
  } catch (err) {
    console.log('[zero-gen.full.outline.end]', {
      requestId,
      ok: false,
      error_message: errorMessage(err),
      elapsed_ms: Date.now() - outlineStartedAt,
    });
    recordStageFailure(failures, 'outline', err, { requestId });
    stages.outline = 'failed';
    return NextResponse.json(
      {
        error: 'outline 生成失敗',
        stage: 'outline',
        request_id: requestId,
        detail: errorMessage(err),
        stages,
        failures,
      },
      { status: 502 },
    );
  }

  // 5. RAG retrieve（失敗しても本フロー継続）
  const ragStartedAt = Date.now();
  const rag = await retrieveRagChunks({
    theme: theme.name,
    persona_pain: persona.tone_guide ?? '',
    keywords: body.keywords,
  });
  stages.rag = rag.status;
  console.log('[zero-gen.full.rag.end]', {
    requestId,
    status: rag.status,
    chunks_count: rag.chunks.length,
    elapsed_ms: Date.now() - ragStartedAt,
  });
  if (rag.status === 'failed') {
    recordStageFailure(failures, 'rag', rag.error, { requestId });
  }

  // 6. Stage2 writing 生成（upstream Gemini → 502）
  let bodyHtml = '';
  console.log('[zero-gen.full.writing.begin]', { requestId });
  const writingStartedAt = Date.now();
  try {
    bodyHtml = await generateStage2Body({
      outline,
      theme,
      persona,
      retrievedChunks: rag.chunks,
    });
    stages.writing = 'ok';
    console.log('[zero-gen.full.writing.end]', {
      requestId,
      ok: true,
      body_chars: bodyHtml.length,
      elapsed_ms: Date.now() - writingStartedAt,
    });
  } catch (err) {
    console.log('[zero-gen.full.writing.end]', {
      requestId,
      ok: false,
      error_message: errorMessage(err),
      elapsed_ms: Date.now() - writingStartedAt,
    });
    recordStageFailure(failures, 'writing', err, { requestId });
    stages.writing = 'failed';
    return NextResponse.json(
      {
        error: 'writing 生成失敗',
        stage: 'writing',
        request_id: requestId,
        detail: errorMessage(err),
        stages,
        failures,
      },
      { status: 502 },
    );
  }

  // 7. 並列検証 (claim 抽出 + 4 検証 + tone)
  console.log('[zero-gen.full.validation.begin]', {
    requestId,
    body_chars: bodyHtml.length,
  });
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
    console.log('[zero-gen.full.hallucination.result]', {
      requestId,
      ok: true,
      score:
        halluResult && typeof halluResult.hallucination_score === 'number'
          ? halluResult.hallucination_score
          : null,
      claims_count:
        halluResult && Array.isArray(halluResult.claims)
          ? halluResult.claims.length
          : 0,
    });
  } else {
    stages.hallucination = 'failed';
    console.log('[zero-gen.full.hallucination.result]', {
      requestId,
      ok: false,
      score: null,
      claims_count: 0,
      error_message: errorMessage(halluSettled.err),
    });
    // claim_extraction も hallucination も同経路で実行されるため、両方を記録。
    recordStageFailure(failures, 'claim_extraction', halluSettled.err, {
      requestId,
    });
    recordStageFailure(failures, 'hallucination', halluSettled.err, {
      requestId,
    });
  }

  const toneResult = toneSettled.ok ? toneSettled.result : null;
  if (toneSettled.ok) {
    stages.tone = 'ok';
    console.log('[zero-gen.full.tone.result]', {
      requestId,
      ok: true,
      total: toneResult?.tone?.total ?? null,
      passed: toneResult?.passed ?? null,
      blockers_count: Array.isArray(toneResult?.tone?.blockers)
        ? toneResult.tone.blockers.length
        : 0,
    });
  } else {
    stages.tone = 'failed';
    console.log('[zero-gen.full.tone.result]', {
      requestId,
      ok: false,
      total: null,
      passed: null,
      blockers_count: 0,
      error_message: errorMessage(toneSettled.err),
    });
    recordStageFailure(failures, 'tone', toneSettled.err, { requestId });
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
    console.log('[zero-gen.full.image.end]', {
      requestId,
      ok: true,
      hero_chars: imagePrompts.hero.length,
      body_chars: imagePrompts.body.length,
      summary_chars: imagePrompts.summary.length,
    });
  } catch (err) {
    recordStageFailure(failures, 'image', err, { requestId });
    stages.images = 'failed';
    console.log('[zero-gen.full.image.end]', {
      requestId,
      ok: false,
      hero_chars: 0,
      body_chars: 0,
      summary_chars: 0,
      error_message: errorMessage(err),
    });
  }

  // 10. articles INSERT（DB error → 500）
  const hallucinationScore =
    halluResult && typeof halluResult.hallucination_score === 'number'
      ? halluResult.hallucination_score
      : null;
  const yukikoToneScore =
    toneResult && typeof toneResult.tone?.total === 'number'
      ? toneResult.tone.total
      : null;

  let articleId: string;
  console.log('[zero-gen.full.db.insert.begin]', { requestId });
  const dbInsertStartedAt = Date.now();
  try {
    const inserted = await insertZeroArticle({
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
    articleId = inserted.id;
    stages.insert_article = 'ok';
    console.log('[zero-gen.full.db.insert.end]', {
      requestId,
      ok: true,
      articleId,
      elapsed_ms: Date.now() - dbInsertStartedAt,
    });
  } catch (err) {
    console.log('[zero-gen.full.db.insert.end]', {
      requestId,
      ok: false,
      articleId: null,
      error_message: errorMessage(err),
      elapsed_ms: Date.now() - dbInsertStartedAt,
    });
    recordStageFailure(failures, 'db_insert', err, { requestId });
    stages.insert_article = 'failed';
    return NextResponse.json(
      {
        error: 'articles INSERT 失敗',
        stage: 'db_insert',
        request_id: requestId,
        detail: errorMessage(err),
        stages,
        failures,
      },
      { status: 500 },
    );
  }

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
    recordStageFailure(failures, 'cta', err, { requestId, articleId });
    stages.cta_variants = 'failed';
  }

  // 11. persistClaims / persistCtaVariants / persistToneScore
  if (halluResult && Array.isArray(halluResult.claims) && halluResult.claims.length > 0) {
    try {
      await persistClaims(articleId, halluResult.claims);
      stages.insert_claims = 'ok';
    } catch (err) {
      recordStageFailure(failures, 'persist_claims', err, {
        requestId,
        articleId,
      });
      stages.insert_claims = 'failed';
    }
  } else {
    stages.insert_claims = 'skipped';
  }
  console.log('[zero-gen.full.persist.claims]', {
    requestId,
    articleId,
    status: stages.insert_claims,
  });

  if (Array.isArray(ctaVariants) && ctaVariants.length > 0) {
    try {
      await persistCtaVariants(articleId, ctaVariants);
      stages.insert_cta_variants = 'ok';
    } catch (err) {
      recordStageFailure(failures, 'persist_cta', err, {
        requestId,
        articleId,
      });
      stages.insert_cta_variants = 'failed';
    }
  } else {
    stages.insert_cta_variants = 'skipped';
  }
  console.log('[zero-gen.full.persist.cta]', {
    requestId,
    articleId,
    status: stages.insert_cta_variants,
    count: Array.isArray(ctaVariants) ? ctaVariants.length : 0,
  });

  if (toneResult) {
    try {
      await persistToneScore(articleId, toneResult);
      stages.insert_tone = 'ok';
    } catch (err) {
      recordStageFailure(failures, 'persist_tone', err, {
        requestId,
        articleId,
      });
      stages.insert_tone = 'failed';
    }
  } else {
    stages.insert_tone = 'skipped';
  }
  console.log('[zero-gen.full.persist.tone]', {
    requestId,
    articleId,
    status: stages.insert_tone,
  });

  // 12. article_revisions に履歴 INSERT (HTML 履歴ルール)
  try {
    await insertAutoSnapshot(articleId, bodyHtml, articleTitle, userId);
    stages.insert_revision = 'ok';
  } catch (err) {
    recordStageFailure(failures, 'article_revisions', err, {
      requestId,
      articleId,
    });
    stages.insert_revision = 'failed';
  }
  console.log('[zero-gen.full.persist.revision]', {
    requestId,
    articleId,
    status: stages.insert_revision,
  });

  // 13. レスポンス
  // writing は失敗時に既に return しているため、ここでは ok 固定。
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
    request_id: requestId,
    stages,
    failures,
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
    failures_count: failures.length,
    request_id: requestId,
    durationMs: responseBody.duration_ms,
  });

  const statusCode = partial ? 207 : 201;
  console.log('[zero-gen.full.request.end]', {
    requestId,
    articleId,
    partial,
    status_code: statusCode,
    total_elapsed_ms: Date.now() - startedAt,
  });

  return NextResponse.json(responseBody, { status: statusCode });
}
