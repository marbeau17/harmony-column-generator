// publish-control-v2 / dangling-deploying 自動回復の純ロジック。
// route.ts から切り出したのは、Next.js App Router が route ファイルで
// 許容しない named export（handleDanglingRecoveryRequest 等）があるため。
// Spec: docs/optimized_spec.md §2.2 #7

import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { STALE_DEPLOYING_MS } from '@/lib/publish-control/state-machine';

const MAX_ROWS = 100;

/**
 * 依存性注入用のファクトリ。既定では `@supabase/supabase-js` の service role
 * クライアントを返すが、単体テストから差し替え可能にしておく。
 */
export type SupabaseFactory = () => SupabaseClient;

export const defaultSupabaseFactory: SupabaseFactory = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase service-role credentials are not configured');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

// publish-control コアの idempotency.ts には未実装のため、
// ここに閉じた簡易 ULID 生成を置く（Crockford Base32）。
// 衝突は監査ログの request_id 用途に限定されるため、この簡易実装で十分。
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateUlid(now: number = Date.now()): string {
  // 上位 10 文字は時刻（ミリ秒）、下位 16 文字はランダム。合計 26 文字。
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

interface DanglingRow {
  id: string;
  visibility_updated_at: string | null;
}

export interface RecoveryResult {
  recovered: number;
  ids: string[];
}

/**
 * 実処理本体。HTTP ハンドラからもテストからも呼び出せるように分離する。
 */
export async function runDanglingRecovery(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<RecoveryResult> {
  const threshold = new Date(now.getTime() - STALE_DEPLOYING_MS).toISOString();

  const { data: rows, error: selectErr } = await supabase
    .from('articles')
    // guard-approved: read-only select of publish-control columns
    .select('id, visibility_updated_at')
    .eq('visibility_state', 'deploying')
    .lt('visibility_updated_at', threshold)
    .limit(MAX_ROWS);

  if (selectErr) {
    throw new Error(`select failed: ${selectErr.message}`);
  }

  const targets = (rows ?? []) as DanglingRow[];
  if (targets.length === 0) {
    return { recovered: 0, ids: [] };
  }

  const recoveredIds: string[] = [];

  for (const row of targets) {
    const elapsedSec = row.visibility_updated_at
      ? Math.floor((now.getTime() - new Date(row.visibility_updated_at).getTime()) / 1000)
      : -1;

    const { error: updErr } = await supabase
      .from('articles')
      // guard-approved: dangling-deploying recovery (visibility_state rollback)
      .update({
        visibility_state: 'failed',
        visibility_updated_at: now.toISOString(),
      })
      .eq('id', row.id)
      .eq('visibility_state', 'deploying');

    if (updErr) {
      // 1 行ずつ独立処理。1 行失敗しても残りは進める。
      continue;
    }

    const { error: evtErr } = await supabase.from('publish_events').insert({
      article_id: row.id,
      action: 'dangling-recovery',
      actor_id: null,
      actor_email: 'system',
      request_id: generateUlid(now.getTime()),
      hub_deploy_status: 'skipped',
      hub_deploy_error: null,
      reason: `dangling-deploying recovered after ${elapsedSec}s`,
    });

    if (!evtErr) {
      recoveredIds.push(row.id);
    }
  }

  return { recovered: recoveredIds.length, ids: recoveredIds };
}

/**
 * Route ハンドラ本体。テストから Supabase ファクトリと now を差し替え可能。
 */
export async function handleDanglingRecoveryRequest(
  req: NextRequest,
  factory: SupabaseFactory = defaultSupabaseFactory,
  now: Date = new Date(),
): Promise<NextResponse> {
  const expectedToken = process.env.DANGLING_RECOVERY_TOKEN;
  if (!expectedToken) {
    return NextResponse.json({ error: 'recovery token not configured' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/.exec(authHeader);
  if (!match || match[1] !== expectedToken) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const supabase = factory();
    const result = await runDanglingRecovery(supabase, now);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'recovery failed', detail: msg }, { status: 500 });
  }
}
