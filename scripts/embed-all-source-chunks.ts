/**
 * scripts/embed-all-source-chunks.ts
 *
 * source_articles 全件 (約 1499 記事) を chunk 化 → text-embedding-004 →
 * source_chunks テーブルへ INSERT する一括 embed CLI。
 *
 * 使い方:
 *   tsx scripts/embed-all-source-chunks.ts            # 全件
 *   tsx scripts/embed-all-source-chunks.ts --limit=10 # 動作確認用
 *   tsx scripts/embed-all-source-chunks.ts --dry-run  # DB 書き込みなし
 *
 * 仕様:
 *   - 段落 + 400 token sliding window (overlap 50) で chunk
 *   - content_hash (SHA-256) で差分判定 → 既存と一致なら skip（再開可能）
 *   - 進捗ログは 10 件ごとに出力
 *   - エラー時は当該記事を errors に積み、次の記事へ進む
 */

import { createClient } from '@supabase/supabase-js';
import {
  embedAllSourceChunks,
  type SupabaseLikeClient,
} from '../src/lib/rag/embed-source-chunks';

function parseArgs(argv: string[]): {
  limit?: number;
  dryRun: boolean;
  progressEvery: number;
} {
  let limit: number | undefined;
  let dryRun = false;
  let progressEvery = 10;

  for (const a of argv.slice(2)) {
    const m = a.match(/^--limit=(\d+)$/);
    if (m) {
      limit = Number(m[1]);
      continue;
    }
    const p = a.match(/^--progress-every=(\d+)$/);
    if (p) {
      progressEvery = Number(p[1]);
      continue;
    }
    if (a === '--dry-run' || a === '--dryRun') {
      dryRun = true;
      continue;
    }
  }
  return { limit, dryRun, progressEvery };
}

async function main(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error(
      '[embed-all-source-chunks] missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY',
    );
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error('[embed-all-source-chunks] missing GEMINI_API_KEY');
    process.exit(1);
  }

  const args = parseArgs(process.argv);
  console.log('[embed-all-source-chunks] start', args);

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const startedAt = Date.now();
  const result = await embedAllSourceChunks(supabase as unknown as SupabaseLikeClient, {
    limit: args.limit,
    dryRun: args.dryRun,
    progressEvery: args.progressEvery,
  });

  const durationSec = Math.round((Date.now() - startedAt) / 1000);
  console.log('[embed-all-source-chunks] finished', {
    durationSec,
    ...result,
    errors: result.errors.length,
  });

  if (result.errors.length > 0) {
    // 先頭 5 件だけサンプル表示
    console.warn('[embed-all-source-chunks] sample errors:', result.errors.slice(0, 5));
  }
  // 再開可能な設計のため、エラーがあっても exit 0 で正常終了させない
  process.exit(result.errors.length > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error('[embed-all-source-chunks] fatal', err);
  process.exit(1);
});
