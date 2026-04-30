// ============================================================================
// POST /api/articles/[id]/hallucination-check
// 記事 ID を起点にハルシネーション検出パイプラインを再実行する。
//
// 処理フロー (spec §6.2 / Generator H4 設計):
//   1. articles から stage2_body_html を取得（read-only）
//   2. runHallucinationChecks(htmlBody, retrieveChunks) を実行
//   3. persistClaims(articleId, claims) で article_claims を DELETE+INSERT
//   4. articles の hallucination_score 列のみを UPDATE（本文は触らない）
//   5. { hallucination_score, criticals, claims_count, claims } を返却
//
// 絶対ルール:
//   - 既存 publish-control コア / articles.ts は変更しない
//   - 既存 hallucination モジュール (run-checks 等) は変更しない
//   - 記事本文 (stage2_body_html / title 等) への write は禁止
//   - articles の hallucination_score 列のみ UPDATE 許可
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  createServerSupabaseClient,
  createServiceRoleClient,
} from '@/lib/supabase/server';
import { runHallucinationChecks } from '@/lib/hallucination/run-checks';
import { persistClaims } from '@/lib/hallucination/persist-claims';
import type {
  RetrieveChunksFn,
  RetrievedChunk,
} from '@/lib/hallucination/types';

export const maxDuration = 60;

type RouteParams = { params: { id: string } };

/**
 * F2 RAG retriever を動的 import してハルシネーション層が要求する
 * `RetrieveChunksFn` シグネチャに適合させる。
 *
 * - retrieve-chunks モジュールが存在しない / API が未着地の場合は空配列を返す。
 * - 取得結果は `id / content / similarity / source?` のみ抽出して返す。
 *
 * 例外は throw せず、retrieval 失敗時は空配列を返すことで factual validator は
 * fallback 経由で安全に動作する（既存 hallucination モジュールを変更しない）。
 */
async function makeRetrieveChunksFn(): Promise<RetrieveChunksFn> {
  let ragModule: { retrieveChunks?: unknown } | null = null;
  try {
    ragModule = (await import('@/lib/rag/retrieve-chunks').catch(
      () => null,
    )) as { retrieveChunks?: unknown } | null;
  } catch {
    ragModule = null;
  }

  return async (query: string, topK: number): Promise<RetrievedChunk[]> => {
    if (
      !ragModule ||
      typeof (ragModule as { retrieveChunks?: unknown }).retrieveChunks !==
        'function'
    ) {
      return [];
    }
    try {
      const supabase = await createServiceRoleClient();
      const fn = (ragModule as { retrieveChunks: (...args: unknown[]) => unknown })
        .retrieveChunks;
      const result = (await fn(supabase, {
        query,
        topK,
      })) as { chunks?: Array<Partial<RetrievedChunk>> } | null;
      const chunks = Array.isArray(result?.chunks) ? result!.chunks : [];
      return chunks.map((c) => ({
        id: String(c.id ?? ''),
        content: String(c.content ?? ''),
        similarity: typeof c.similarity === 'number' ? c.similarity : 0,
        source: typeof c.source === 'string' ? c.source : undefined,
      }));
    } catch {
      return [];
    }
  };
}

export async function POST(_req: NextRequest, { params }: RouteParams) {
  const { id: articleId } = params;

  try {
    // ─── Auth (必須) ───────────────────────────────────────────────────────
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: '認証が必要です' },
        { status: 401 },
      );
    }

    // ─── 1. stage2_body_html の取得（read-only） ──────────────────────────
    const service = await createServiceRoleClient();
    const { data: article, error: fetchErr } = await service
      .from('articles')
      .select('id, stage2_body_html')
      .eq('id', articleId)
      .maybeSingle();

    if (fetchErr || !article) {
      return NextResponse.json(
        { error: '記事が見つかりません' },
        { status: 404 },
      );
    }

    const htmlBody = (article.stage2_body_html ?? '') as string;

    // ─── 2. ハルシネーション検証パイプラインを実行 ────────────────────────
    const retrieveChunks = await makeRetrieveChunksFn();
    const result = await runHallucinationChecks(htmlBody, retrieveChunks);

    // ─── 3. article_claims を置換（DELETE+INSERT） ────────────────────────
    await persistClaims(articleId, result.claims);

    // ─── 4. articles.hallucination_score のみ UPDATE（本文は触らない） ───
    const { error: updateErr } = await service
      .from('articles')
      .update({ hallucination_score: result.hallucination_score } as Record<
        string,
        unknown
      >)
      .eq('id', articleId);
    if (updateErr) {
      throw new Error(
        `failed to update hallucination_score: ${updateErr.message}`,
      );
    }

    // ─── 5. 返却 ──────────────────────────────────────────────────────────
    return NextResponse.json({
      hallucination_score: result.hallucination_score,
      criticals: result.criticals,
      claims_count: result.claims.length,
      claims: result.claims,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
