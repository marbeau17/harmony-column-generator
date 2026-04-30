// ============================================================================
// src/app/api/articles/[id]/regenerate-segment/route.ts
// POST /api/articles/[id]/regenerate-segment
//
// UI G8 から呼ばれる「部分再生成」API。
//
// body: { scope: 'sentence' | 'chapter' | 'full', target_idx?: number }
//
// 処理フロー:
//   1. 認証 (createServerSupabaseClient.auth.getUser)
//   2. body 検証 (regenerateSegmentRequestSchema)
//   3. articles から記事を取得（service role）
//   4. session-guard 経由 write 許可確認 (assertArticleWriteAllowed)
//   5. 旧 stage2_body_html を article_revisions に履歴 INSERT（HTML 履歴ルール）
//   6. scope 別に再生成:
//        - sentence : 該当 sentence_idx の文だけ Gemini に書換指示
//        - chapter  : 該当 H2 章だけ Gemini に再生成指示
//        - full     : Stage1 outline → Stage2 writing で全体再生成
//   7. articles UPDATE (stage2_body_html / yukiko_tone_score / hallucination_score)
//   8. レスポンス: { before, after, claims_count_before, claims_count_after }
//
// 注意:
//   - 既存 publish-control コア / articles.ts は変更しない
//   - 既存 zero-generate / zero-generate-full route は変更しない
//   - 記事本文 UPDATE 時は必ず article_revisions に履歴先行 INSERT
//   - Tone / Hallucination モジュール未着地時は score を null のまま継続
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  createServerSupabaseClient,
  createServiceRoleClient,
} from '@/lib/supabase/server';
import { generateJson } from '@/lib/ai/gemini-client';
import {
  regenerateSegmentRequestSchema,
  type RegenerateSegmentRequest,
} from '@/lib/validators/regenerate-segment';
import { assertArticleWriteAllowed } from '@/lib/publish-control/session-guard';
import { saveRevision } from '@/lib/db/article-revisions';
import {
  buildZeroOutlinePrompt,
  ZERO_OUTLINE_TEMPERATURE,
  type ZeroOutlineInput,
  type ZeroOutlineOutput,
} from '@/lib/ai/prompts/stage1-zero-outline';
import { logger } from '@/lib/logger';

type RouteParams = { params: { id: string } };

// ─── 型 ────────────────────────────────────────────────────────────────────

interface ArticleRow {
  id: string;
  title: string | null;
  intent: string | null;
  keyword: string | null;
  theme: string | null;
  persona: string | null;
  target_word_count: number | null;
  stage1_outline: ZeroOutlineOutput | null;
  stage2_body_html: string | null;
  html_body: string | null;
  yukiko_tone_score: number | null;
  hallucination_score: number | null;
}

// ─── Gemini ヘルパ: sentence / chapter 部分書換 ──────────────────────────────

function buildSentenceRewritePrompt(args: {
  bodyHtml: string;
  sentenceIdx: number;
}): { system: string; user: string } {
  const system = [
    'あなたはスピリチュアルカウンセラー小林由起子のトーンを忠実に再現する編集者です。',
    '与えられた本文 HTML のうち、指定 sentence_idx の文 1 つだけを書き換えてください。',
    '他の文・段落・見出し・属性は一字一句保持してください。語尾は柔らかく、抽象表現や断定を避けてください。',
    '出力は JSON: {"html": "書換後の本文HTML全文"} のみ。',
  ].join('\n');
  const user = [
    `# 書換指示`,
    `- sentence_idx: ${args.sentenceIdx}`,
    `- ルール: 該当する文のみ自然な日本語で書き直し、他は変更しない。`,
    ``,
    `# 本文HTML`,
    args.bodyHtml,
  ].join('\n');
  return { system, user };
}

function buildChapterRewritePrompt(args: {
  bodyHtml: string;
  chapterIdx: number;
  outline: ZeroOutlineOutput | null;
}): { system: string; user: string } {
  const chapter =
    args.outline?.h2_chapters?.[args.chapterIdx] ?? null;
  const system = [
    'あなたはスピリチュアルカウンセラー小林由起子のトーンを忠実に再現する編集者です。',
    '与えられた本文 HTML のうち、指定された H2 章（chapter_idx）に属するブロック (H2 + 直後の本文) のみを書き換えてください。',
    '他の章は一字一句保持してください。語尾は柔らかく、抽象表現や断定・医療助言を避けてください。',
    '出力は JSON: {"html": "書換後の本文HTML全文"} のみ。',
  ].join('\n');
  const user = [
    `# 書換指示`,
    `- chapter_idx: ${args.chapterIdx}`,
    chapter
      ? `- 章タイトル: ${chapter.title}\n- 章サマリ: ${chapter.summary ?? ''}\n- 想定文字数: ${chapter.target_chars ?? ''}`
      : '- 章メタ情報: 不明',
    `- ルール: 指定章のみ書き直し、他章は完全保持。`,
    ``,
    `# 本文HTML`,
    args.bodyHtml,
  ].join('\n');
  return { system, user };
}

// ─── articles 取得 ────────────────────────────────────────────────────────

async function fetchArticle(id: string): Promise<ArticleRow | null> {
  const supabase = await createServiceRoleClient();
  const { data, error } = await supabase
    .from('articles')
    .select(
      'id, title, intent, keyword, theme, persona, target_word_count, stage1_outline, stage2_body_html, html_body, yukiko_tone_score, hallucination_score',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw new Error(`articles 取得失敗: ${error.message}`);
  }
  return (data as ArticleRow | null) ?? null;
}

// ─── claim 抽出（任意。失敗しても流す） ─────────────────────────────────────

async function tryExtractClaims(html: string): Promise<unknown[]> {
  try {
    const mod = await import('@/lib/hallucination/claim-extractor').catch(
      () => null,
    );
    if (!mod || typeof mod.extractClaims !== 'function') return [];
    const claims = await mod.extractClaims(html);
    return Array.isArray(claims) ? claims : [];
  } catch (err) {
    logger.warn('api', 'regenerate-segment.claims_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ─── tone / hallucination（任意） ──────────────────────────────────────────

async function tryRunHallucination(
  html: string,
): Promise<{ hallucination_score: number | null }> {
  try {
    const mod = await import('@/lib/hallucination/run-checks').catch(
      () => null,
    );
    if (!mod || typeof mod.runHallucinationChecks !== 'function') {
      return { hallucination_score: null };
    }
    const result = (await mod.runHallucinationChecks(html)) as {
      hallucination_score?: number;
    };
    return {
      hallucination_score:
        typeof result?.hallucination_score === 'number'
          ? result.hallucination_score
          : null,
    };
  } catch (err) {
    logger.warn('api', 'regenerate-segment.hallucination_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { hallucination_score: null };
  }
}

async function tryRunTone(
  html: string,
): Promise<{ yukiko_tone_score: number | null }> {
  try {
    const mod = await import('@/lib/tone/run-tone-checks').catch(() => null);
    if (!mod || typeof mod.runToneChecks !== 'function') {
      return { yukiko_tone_score: null };
    }
    const result = (await mod.runToneChecks(html)) as {
      tone?: { total?: number };
    };
    return {
      yukiko_tone_score:
        typeof result?.tone?.total === 'number' ? result.tone.total : null,
    };
  } catch (err) {
    logger.warn('api', 'regenerate-segment.tone_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { yukiko_tone_score: null };
  }
}

// ─── full 再生成（Stage1 → Stage2） ────────────────────────────────────────

async function regenerateFull(article: ArticleRow): Promise<string> {
  // theme / persona は最低限の情報を articles レコードから引いて Stage1 を回す。
  // theme_id / persona_id を持たない既存記事も再生成可能にするため、name ベースで
  // ZeroOutlineInput を組み立てる。intent は既存値、無ければ 'empathy' をデフォルト。
  const keywords = (article.keyword ?? '')
    .split(/[、,，\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const zeroInput: ZeroOutlineInput = {
    theme: {
      id: 'unknown',
      name: article.theme ?? 'general',
    },
    persona: {
      id: 'unknown',
      name: article.persona ?? 'general',
    },
    keywords: keywords.length > 0 ? keywords : [article.title ?? '記事'],
    intent:
      (article.intent as ZeroOutlineInput['intent']) ?? ('empathy' as never),
    target_length: article.target_word_count ?? 2000,
  };
  const outlinePrompt = buildZeroOutlinePrompt(zeroInput);
  const { data: outline } = await generateJson<ZeroOutlineOutput>(
    outlinePrompt.system,
    outlinePrompt.user,
    { temperature: ZERO_OUTLINE_TEMPERATURE, topP: 0.9 },
  );

  // Stage2 writing
  const writingSystem = [
    'あなたはスピリチュアルカウンセラー小林由起子のトーンを忠実に再現する執筆者です。',
    '与えられた outline JSON に基づき、本文 HTML を生成してください。',
    '出力は JSON: {"html": "本文HTML全文"} のみ。',
  ].join('\n');
  const writingUser = [
    `# Outline`,
    JSON.stringify(outline, null, 2),
    ``,
    `# 制約`,
    `- 目標文字数: ${zeroInput.target_length}`,
    `- 語尾は柔らかく、抽象表現や断定・医療助言を避ける`,
  ].join('\n');
  const { data: writingData } = await generateJson<{ html: string } | string>(
    writingSystem,
    writingUser,
    { temperature: 0.7, topP: 0.9 },
  );
  const html =
    typeof writingData === 'string'
      ? writingData
      : (writingData as { html?: string })?.html ?? '';
  return html;
}

// ─── articles UPDATE（履歴先行 INSERT 必須） ───────────────────────────────

async function persistRegeneratedHtml(args: {
  articleId: string;
  beforeHtml: string;
  afterHtml: string;
  beforeTitle: string | null;
  hallucinationScore: number | null;
  yukikoToneScore: number | null;
  changedBy: string | null;
  scope: RegenerateSegmentRequest['scope'];
}): Promise<void> {
  // 1. 履歴先行 INSERT (HTML 履歴ルール)
  await saveRevision(
    args.articleId,
    {
      title: args.beforeTitle ?? undefined,
      body_html: args.beforeHtml,
    },
    `regenerate_${args.scope}`,
    args.changedBy ?? undefined,
  );

  // 2. articles UPDATE
  const supabase = await createServiceRoleClient();
  const updatePayload: Record<string, unknown> = {
    stage2_body_html: args.afterHtml,
  };
  if (args.hallucinationScore !== null) {
    updatePayload.hallucination_score = args.hallucinationScore;
  }
  if (args.yukikoToneScore !== null) {
    updatePayload.yukiko_tone_score = args.yukikoToneScore;
  }

  const { error } = await supabase
    .from('articles')
    .update(updatePayload)
    .eq('id', args.articleId);

  if (error) {
    throw new Error(`articles UPDATE 失敗: ${error.message}`);
  }
}

// ─── POST ハンドラ ─────────────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: RouteParams) {
  const startedAt = Date.now();
  const articleId = params.id;

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
    const parsed = regenerateSegmentRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'バリデーションエラー', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const body: RegenerateSegmentRequest = parsed.data;

    // 3. 記事取得
    const article = await fetchArticle(articleId);
    if (!article) {
      return NextResponse.json(
        { error: '記事が見つかりません' },
        { status: 404 },
      );
    }

    // 4. session-guard write 許可確認
    assertArticleWriteAllowed(articleId, ['stage2_body_html']);

    // 5. before snapshot
    const beforeHtml =
      article.stage2_body_html ?? article.html_body ?? '';

    // 6. 再生成
    let afterHtml = '';
    if (body.scope === 'sentence') {
      const prompt = buildSentenceRewritePrompt({
        bodyHtml: beforeHtml,
        sentenceIdx: body.target_idx as number,
      });
      const { data } = await generateJson<{ html: string } | string>(
        prompt.system,
        prompt.user,
        { temperature: 0.7, topP: 0.9 },
      );
      afterHtml =
        typeof data === 'string'
          ? data
          : (data as { html?: string })?.html ?? '';
    } else if (body.scope === 'chapter') {
      const prompt = buildChapterRewritePrompt({
        bodyHtml: beforeHtml,
        chapterIdx: body.target_idx as number,
        outline: article.stage1_outline,
      });
      const { data } = await generateJson<{ html: string } | string>(
        prompt.system,
        prompt.user,
        { temperature: 0.7, topP: 0.9 },
      );
      afterHtml =
        typeof data === 'string'
          ? data
          : (data as { html?: string })?.html ?? '';
    } else {
      // full
      afterHtml = await regenerateFull(article);
    }

    // 7. claims_count_before / after
    const claimsBefore = await tryExtractClaims(beforeHtml);
    const claimsAfter = await tryExtractClaims(afterHtml);

    // 8. tone / hallucination 再計測（best-effort）
    const [tone, hallu] = await Promise.all([
      tryRunTone(afterHtml),
      tryRunHallucination(afterHtml),
    ]);

    // 9. 履歴先行 INSERT → articles UPDATE
    await persistRegeneratedHtml({
      articleId,
      beforeHtml,
      afterHtml,
      beforeTitle: article.title,
      hallucinationScore: hallu.hallucination_score,
      yukikoToneScore: tone.yukiko_tone_score,
      changedBy: user.id ?? null,
      scope: body.scope,
    });

    logger.info('api', 'regenerate-segment.completed', {
      articleId,
      scope: body.scope,
      target_idx: body.target_idx ?? null,
      claims_before: claimsBefore.length,
      claims_after: claimsAfter.length,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json(
      {
        article_id: articleId,
        scope: body.scope,
        target_idx: body.target_idx ?? null,
        before: beforeHtml,
        after: afterHtml,
        claims_count_before: claimsBefore.length,
        claims_count_after: claimsAfter.length,
        scores: {
          hallucination: hallu.hallucination_score,
          yukiko_tone: tone.yukiko_tone_score,
        },
        duration_ms: Date.now() - startedAt,
      },
      { status: 200 },
    );
  } catch (error) {
    logger.error(
      'api',
      'regenerate-segment.failed',
      { articleId },
      error,
    );
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'regenerate-segment に失敗しました',
      },
      { status: 500 },
    );
  }
}
