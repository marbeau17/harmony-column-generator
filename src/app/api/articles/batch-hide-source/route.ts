// ============================================================================
// src/app/api/articles/batch-hide-source/route.ts
// publish-control-v2: ソースベース既存記事を一括ソフト撤回する API
//
// POST /api/articles/batch-hide-source
//   body: { confirm: 'HIDE_ALL_SOURCE', dry_run?: boolean }
//
// - PUBLISH_CONTROL_V2=on でなければ 404
// - 認証必須（auth.getUser）
// - 対象抽出は articles WHERE is_hub_visible=true AND
//   (generation_mode='source' OR generation_mode IS NULL)
// - dry_run=true は ID リスト返却のみ
// - dry_run=false は順次:
//     1) articles UPDATE (visibility 列のみ)
//     2) softWithdrawFile で FTP に noindex HTML を上書き (PUBLISH_CONTROL_FTP=on の時のみ)
//     3) publish_events に action='unpublish', reason='batch-hide-source' で INSERT
// - 全件処理後にハブ再生成
//
// 実装方針: 純ロジックは src/lib/articles/batch-hide.ts に分離。本ファイルは
// HTTP のバインディング（auth / zod / 環境変数読み出し / レスポンス整形）に専念。
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { isPublishControlEnabled } from '@/lib/publish-control/feature-flag';
import { batchHideSourceArticles } from '@/lib/articles/batch-hide';
import { logger } from '@/lib/logger';

export const maxDuration = 120;

// ─── バリデーション ──────────────────────────────────────────────────────────

const BatchHideBodySchema = z.object({
  confirm: z.literal('HIDE_ALL_SOURCE'),
  dry_run: z.boolean().optional(),
});

// ─── 簡易 ULID 生成（Crockford Base32, 26 文字）──────────────────────────────
// publish-control コアの idempotency.ts には未実装のため、ここに閉じた実装を置く。
// （src/lib/dangling-recovery/recover.ts と同様の方針）

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function generateUlid(now: number = Date.now()): string {
  let time = now;
  const timeChars: string[] = [];
  for (let i = 0; i < 10; i++) {
    const mod = time % 32;
    timeChars.unshift(ULID_ALPHABET[mod]);
    time = Math.floor(time / 32);
  }
  const randomChars: string[] = [];
  for (let i = 0; i < 16; i++) {
    randomChars.push(ULID_ALPHABET[Math.floor(Math.random() * 32)]);
  }
  return (timeChars.join('') + randomChars.join('')).slice(0, 26);
}

// ─── ハンドラ ────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isPublishControlEnabled()) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // 認証
  const supabaseAuth = await createServerSupabaseClient();
  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // ボディ
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = BatchHideBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid body',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      },
      { status: 400 },
    );
  }

  const dryRun = parsed.data.dry_run === true;
  const ftpEnabled = process.env.PUBLISH_CONTROL_FTP === 'on';

  const service = await createServiceRoleClient();

  // ハブ再生成は dry_run=false の時のみ実行
  const runHubRebuild = !dryRun && ftpEnabled;

  try {
    const result = await batchHideSourceArticles(
      {
        dryRun,
        ftpEnabled,
        runHubRebuild,
        actorEmail: user.email ?? null,
        actorId: user.id ?? null,
        reason: 'batch-hide-source',
      },
      {
        supabase: service,
        generateRequestId: () => generateUlid(),
        rebuildHub: async () => {
          // server-side からは同オリジンの /api/hub/deploy を叩く。
          // (UI 側 rebuildHub は relative fetch を使うため SSR では使えない)
          try {
            const origin = new URL(req.url).origin;
            const res = await fetch(`${origin}/api/hub/deploy`, {
              method: 'POST',
              headers: { cookie: req.headers.get('cookie') ?? '' },
            });
            if (!res.ok) {
              return { ok: false, error: `hub rebuild http ${res.status}` };
            }
            const body = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
            if (body && body.success === false) {
              return { ok: false, error: body.error ?? 'hub rebuild failed' };
            }
            return { ok: true };
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
          }
        },
      },
    );

    logger.info('api', 'batch-hide-source.completed', {
      dryRun,
      candidates: result.candidates,
      hidden: result.hidden,
      failures: result.failures.length,
      hubRebuildStatus: result.hubRebuildStatus,
    });

    const status = result.failures.length > 0 || result.hubRebuildStatus === 'failed' ? 207 : 200;
    return NextResponse.json(
      {
        dry_run: result.dryRun,
        candidates: result.candidates,
        hidden: result.hidden,
        ids: result.ids,
        succeeded_ids: result.succeededIds,
        failures: result.failures,
        hub_rebuild_status: result.hubRebuildStatus,
        hub_rebuild_error: result.hubRebuildError ?? null,
      },
      { status },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('api', 'batch-hide-source.failed', { message: msg });
    return NextResponse.json({ error: 'batch-hide failed', detail: msg }, { status: 500 });
  }
}
