// ============================================================================
// src/app/api/articles/zero-generate/suggest-keywords/route.ts
// POST /api/articles/zero-generate/suggest-keywords
//
// 入力 (theme_id + persona_id + intent? + exclude?[]) から、検索ボリュームを取りやすい
// 長尾キーワード候補を 12〜18 件返す。
//
// ロジック:
//   1. 認証 (createServerSupabaseClient.auth.getUser)
//   2. 入力検証 (suggestKeywordsRequestSchema)
//   3. theme + persona を service role で SELECT
//   4. persona-based 候補を計算 (Gemini コール不要、即時)
//   5. AI 候補を Gemini に依頼 (1 呼出、~$0.001)
//   6. dedupe → exclude 除外 → score 降順ソート → 最大 18 件返す
//   7. AI 失敗時は persona 候補のみ返す partial_success モード
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  createServerSupabaseClient,
  createServiceRoleClient,
} from '@/lib/supabase/server';
import { generateJson } from '@/lib/ai/gemini-client';
import {
  suggestKeywordsRequestSchema,
  type KeywordSuggestion,
  type SuggestKeywordsResponse,
} from '@/lib/validators/zero-generate';
import {
  buildPersonaCandidates,
  buildAiSuggestionPrompt,
  normalizeAiCandidates,
} from '@/lib/ai/prompts/keyword-suggestions';
import { logger } from '@/lib/logger';

const MAX_CANDIDATES = 18;
const AI_TEMPERATURE = 0.6;
const AI_MAX_OUTPUT_TOKENS = 2000;

interface ThemeRow {
  id: string;
  name: string;
  category: string | null;
}
interface PersonaRow {
  id: string;
  name: string;
  age_range: string | null;
  description: string | null;
  search_patterns: string[] | null;
  tone_guide: string | null;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  // 1. 認証
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  // 2. 入力検証
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 解析に失敗しました' }, { status: 400 });
  }
  const parsed = suggestKeywordsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'バリデーションエラー', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { theme_id, persona_id, intent, exclude = [] } = parsed.data;

  console.log('[suggest-kw.begin]', {
    theme_id,
    persona_id,
    intent: intent ?? null,
    exclude_count: exclude.length,
  });

  // 3. theme + persona 取得
  const serviceClient = await createServiceRoleClient();
  const [themeRes, personaRes] = await Promise.all([
    serviceClient
      .from('themes')
      .select('id, name, category')
      .eq('id', theme_id)
      .maybeSingle(),
    serviceClient
      .from('personas')
      .select('id, name, age_range, description, search_patterns, tone_guide')
      .eq('id', persona_id)
      .maybeSingle(),
  ]);
  if (themeRes.error || !themeRes.data) {
    return NextResponse.json(
      { error: 'theme が見つかりません' },
      { status: 404 },
    );
  }
  if (personaRes.error || !personaRes.data) {
    return NextResponse.json(
      { error: 'persona が見つかりません' },
      { status: 404 },
    );
  }
  const theme = themeRes.data as ThemeRow;
  const persona = {
    name: (personaRes.data as PersonaRow).name,
    age_range: (personaRes.data as PersonaRow).age_range,
    description: (personaRes.data as PersonaRow).description,
    search_patterns: (personaRes.data as PersonaRow).search_patterns ?? [],
    tone_guide: (personaRes.data as PersonaRow).tone_guide,
  };

  // 4. persona-based 候補（Gemini コール不要、即時）
  const personaCandidates = buildPersonaCandidates({
    theme: { name: theme.name, category: theme.category },
    persona,
    intent,
  });

  // 5. AI 候補（1 呼出、失敗時は partial）
  let aiCandidates: KeywordSuggestion[] = [];
  let aiOk = true;
  let aiErrorMessage: string | null = null;
  try {
    const { system, user: userPrompt } = buildAiSuggestionPrompt({
      theme: { name: theme.name, category: theme.category },
      persona,
      intent,
      exclude,
    });
    const t0 = Date.now();
    const { data: aiRaw } = await generateJson<unknown>(system, userPrompt, {
      temperature: AI_TEMPERATURE,
      topP: 0.9,
      maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
    });
    aiCandidates = normalizeAiCandidates(aiRaw);
    console.log('[suggest-kw.ai.end]', {
      ok: true,
      ai_candidates_count: aiCandidates.length,
      elapsed_ms: Date.now() - t0,
    });
  } catch (e) {
    aiOk = false;
    aiErrorMessage = (e as Error).message;
    console.warn('[suggest-kw.ai.end]', {
      ok: false,
      error_message: aiErrorMessage,
    });
  }

  // 6. dedupe → exclude 除外 → score 降順 → 最大 N 件
  const seen = new Set<string>();
  const excludeSet = new Set(exclude.map((s) => s.trim()));
  const merged: KeywordSuggestion[] = [];
  for (const c of [...personaCandidates, ...aiCandidates]) {
    const key = c.keyword.trim();
    if (!key) continue;
    if (excludeSet.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...c, keyword: key });
  }
  merged.sort((a, b) => b.score - a.score);
  const candidates = merged.slice(0, MAX_CANDIDATES);

  const response: SuggestKeywordsResponse = {
    candidates,
    context: {
      theme_name: theme.name,
      persona_name: persona.name,
      persona_age_range: persona.age_range,
    },
  };

  console.log('[suggest-kw.end]', {
    persona_count: personaCandidates.length,
    ai_count: aiCandidates.length,
    final_count: candidates.length,
    ai_ok: aiOk,
    elapsed_ms: Date.now() - startedAt,
  });

  if (!aiOk && candidates.length === 0) {
    logger.error('api', 'suggest-keywords', {
      theme_id,
      persona_id,
      ai_error: aiErrorMessage,
    });
    return NextResponse.json(
      { error: 'キーワード候補の生成に失敗しました', details: aiErrorMessage },
      { status: 502 },
    );
  }

  // 一部 AI 失敗時は 207 partial（HTTP では 200 を返しつつ partial フラグでもよいが、
  // 現状の他 API と同じく 200 / 207 で表現）
  return NextResponse.json(
    aiOk ? response : { ...response, partial_success: true, ai_error: aiErrorMessage },
    { status: aiOk ? 200 : 207 },
  );
}
