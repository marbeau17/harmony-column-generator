// ============================================================================
// src/app/api/articles/zero-generate/route.ts
// POST /api/articles/zero-generate
//
// spec §12.1 — ゼロ生成 API（P5-1: outline 生成のみ。Stage2 以降は P5-2 で組込）
//
// 処理フロー:
//   1. 認証 (createServerSupabaseClient.auth.getUser)
//   2. body 検証 (zeroGenerateRequestSchema)
//   3. theme + persona を DB から取得
//   4. ZeroOutlineInput 構築 → buildZeroOutlinePrompt (F7)
//   5. Gemini generateJson で outline 取得（temperature=0.5 / topP=0.9）
//   6. articles に INSERT
//        status='draft', generation_mode='zero', intent=...,
//        stage1_outline=outline JSON, lead_summary, narrative_arc
//   7. レスポンス: { article_id, status, lead_summary, narrative_arc }
//
// 注意:
//   - 既存 articles の UPDATE はしない（新規 INSERT のみ）
//   - createArticle() は generation_mode/intent/stage1_outline を受け取らないため
//     service role client で直接 INSERT する
//   - Stage2 以降（writing / hallucination / image / publish gate）はこのルートでは扱わない
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

// ─── ヘルパ: theme + persona 取得 ────────────────────────────────────────────

interface ThemeRow {
  id: string;
  name: string;
  category: string | null;
}

interface PersonaRow {
  id: string;
  name: string;
  age_range: string | null;
  tone_guide: string | null;
}

async function fetchThemeAndPersona(
  themeId: string,
  personaId: string,
): Promise<{ theme: ThemeRow; persona: PersonaRow }> {
  const supabase = await createServiceRoleClient();

  const [themeResult, personaResult] = await Promise.all([
    supabase
      .from('themes')
      .select('id, name, category')
      .eq('id', themeId)
      .maybeSingle(),
    supabase
      .from('personas')
      .select('id, name, age_range, tone_guide')
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

// ─── ヘルパ: articles INSERT ─────────────────────────────────────────────────

interface InsertArticleInput {
  keywords: string[];
  intent: ZeroGenerateRequest['intent'];
  target_length: number;
  outline: ZeroOutlineOutput;
  themeName: string;
  personaName: string;
}

async function insertZeroDraft(
  input: InsertArticleInput,
): Promise<{ id: string }> {
  const supabase = await createServiceRoleClient();

  // articles テーブルへ ZG モード draft を新規 INSERT
  const insertPayload: Record<string, unknown> = {
    status: 'draft',
    generation_mode: 'zero',
    intent: input.intent,
    keyword: input.keywords.join(', '),
    theme: input.themeName,
    persona: input.personaName,
    target_word_count: input.target_length,
    // outline からタイトル候補がない段階では先頭キーワードを仮タイトルに
    title: input.keywords[0] ?? 'untitled',
    stage1_outline: input.outline,
    lead_summary: input.outline.lead_summary ?? null,
    narrative_arc: input.outline.narrative_arc ?? null,
    emotion_curve: input.outline.emotion_curve ?? null,
    citation_highlights: input.outline.citation_highlights ?? null,
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

// ─── POST ハンドラ ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

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

    // 3. theme + persona 取得
    const { theme, persona } = await fetchThemeAndPersona(
      body.theme_id,
      body.persona_id,
    );

    // 4. ZeroOutlineInput 構築 → prompt
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

    const { system, user: userPrompt } = buildZeroOutlinePrompt(zeroInput);

    // 5. Gemini で outline JSON 取得
    const { data: outline } = await generateJson<ZeroOutlineOutput>(
      system,
      userPrompt,
      {
        // spec §5.3: Stage1 outline は temperature=0.5 / topP=0.9 で構成を決定的に
        temperature: ZERO_OUTLINE_TEMPERATURE,
        topP: 0.9,
      },
    );

    // 6. articles INSERT
    const { id: articleId } = await insertZeroDraft({
      keywords: body.keywords,
      intent: body.intent,
      target_length: body.target_length,
      outline,
      themeName: theme.name,
      personaName: persona.name,
    });

    logger.info('api', 'zero-generate.outline_created', {
      articleId,
      themeId: body.theme_id,
      personaId: body.persona_id,
      intent: body.intent,
      keywordsCount: body.keywords.length,
      durationMs: Date.now() - startedAt,
    });

    // 7. レスポンス
    return NextResponse.json(
      {
        article_id: articleId,
        status: 'draft',
        lead_summary: outline.lead_summary ?? null,
        narrative_arc: outline.narrative_arc ?? null,
      },
      { status: 201 },
    );
  } catch (error) {
    logger.error('api', 'zero-generate.failed', undefined, error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'ゼロ生成に失敗しました',
      },
      { status: 500 },
    );
  }
}
