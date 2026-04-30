/**
 * scripts/embed-all-source-chunks.ts
 *
 * source_articles 全件 (約 1499 記事) を chunk 化 → text-embedding-004 →
 * source_chunks テーブルへ INSERT する一括 embed CLI（H11 強化版）。
 *
 * 強化機能:
 *   1. Resume: tmp/embed-progress.json と既存 source_chunks.content_hash で skip
 *   2. Chunked 実行: --batch-size=N で記事単位の並列度を制御
 *   3. Cost reporting: 想定 chunk 数 × 平均 token × 単価で見積もり
 *   4. Progress tracking: 完了済み source_article_id を tmp/embed-progress.json へ随時保存
 *   5. Error handling: 個別 chunk / 記事失敗で全体停止せず最後にエラーサマリ
 *   6. Dry-run 強化: --dry-run は chunk 化 + コスト試算のみ（Gemini 呼び出し無し）
 *
 * CLI フラグ:
 *   --limit=N         先頭 N 件のみ
 *   --batch-size=N    バッチ並列度 (default 10)
 *   --progress-every=N 進捗ログ周期 (default 10)
 *   --dry-run         コスト試算のみ
 *   --confirm         確認 prompt をスキップ
 *   --resume          tmp/embed-progress.json を読んで途中再開
 *   --verbose         詳細ログ
 *
 * 既存 src/lib/rag/embed-source-chunks.ts は変更しない。呼出方法のみスクリプト側で工夫する。
 */

import { createClient } from '@supabase/supabase-js';
import { promises as fs } from 'fs';
import { dirname, resolve as pathResolve } from 'path';
import * as readline from 'readline';
import {
  embedSourceArticle,
  fetchExistingChunkHashes,
  splitIntoChunks,
  type SupabaseLikeClient,
  type SourceArticleForEmbed,
  type EmbedAllResult,
} from '../src/lib/rag/embed-source-chunks';
import { estimateTokens } from '../src/lib/ai/gemini-client';

// ─── 定数 ───────────────────────────────────────────────────────────────────

/** Gemini text-embedding-004 の概算単価（USD / 1M tokens）。
 *  ドキュメント上 free tier ありだが本番投入見積もり用に保守的な値を採用。 */
export const EMBEDDING_USD_PER_MTOKEN = 0.025;

/** 1 chunk あたりの平均 token 数（splitIntoChunks の windowTokens=400, overlap=50 を想定） */
export const AVG_TOKENS_PER_CHUNK = 380;

/** progress ファイルの既定パス */
export const DEFAULT_PROGRESS_PATH = 'tmp/embed-progress.json';

// ─── CLI 引数パース ─────────────────────────────────────────────────────────

export interface EmbedCliArgs {
  limit?: number;
  batchSize: number;
  progressEvery: number;
  dryRun: boolean;
  confirm: boolean;
  resume: boolean;
  verbose: boolean;
  /** progress ファイルパス（テスト差し替え用） */
  progressPath: string;
}

/**
 * argv 配列から CLI 引数をパースする。
 * 不正な数値は例外を投げる。process.argv 全体ではなく argv.slice(2) 相当を渡しても
 * 受け取れるよう、`--` で始まる要素のみを評価する（先頭の node / script path は無視）。
 */
export function parseArgs(argv: string[]): EmbedCliArgs {
  let limit: number | undefined;
  let batchSize = 10;
  let progressEvery = 10;
  let dryRun = false;
  let confirm = false;
  let resume = false;
  let verbose = false;
  let progressPath = DEFAULT_PROGRESS_PATH;

  for (const a of argv) {
    if (!a.startsWith('--')) continue;

    const limitMatch = a.match(/^--limit=(\d+)$/);
    if (limitMatch) {
      limit = Number(limitMatch[1]);
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error(`--limit must be a positive integer: ${a}`);
      }
      continue;
    }

    const batchMatch = a.match(/^--batch-size=(\d+)$/);
    if (batchMatch) {
      batchSize = Number(batchMatch[1]);
      if (!Number.isFinite(batchSize) || batchSize <= 0) {
        throw new Error(`--batch-size must be a positive integer: ${a}`);
      }
      continue;
    }

    const progressMatch = a.match(/^--progress-every=(\d+)$/);
    if (progressMatch) {
      progressEvery = Number(progressMatch[1]);
      if (!Number.isFinite(progressEvery) || progressEvery <= 0) {
        throw new Error(`--progress-every must be a positive integer: ${a}`);
      }
      continue;
    }

    const progressPathMatch = a.match(/^--progress-path=(.+)$/);
    if (progressPathMatch) {
      progressPath = progressPathMatch[1];
      continue;
    }

    if (a === '--dry-run' || a === '--dryRun') {
      dryRun = true;
      continue;
    }
    if (a === '--confirm') {
      confirm = true;
      continue;
    }
    if (a === '--resume') {
      resume = true;
      continue;
    }
    if (a === '--verbose') {
      verbose = true;
      continue;
    }
  }

  return {
    limit,
    batchSize,
    progressEvery,
    dryRun,
    confirm,
    resume,
    verbose,
    progressPath,
  };
}

// ─── コスト見積もり ─────────────────────────────────────────────────────────

export interface CostEstimate {
  totalArticles: number;
  totalChunks: number;
  totalTokens: number;
  estimatedUsd: number;
}

/**
 * source_articles 一覧から chunk 数 / token 数 / USD コストを試算する。
 * splitIntoChunks をローカル実行するため、Gemini API 呼び出しは発生しない。
 */
export function estimateCost(
  articles: { content: string }[],
  options: {
    windowTokens?: number;
    overlapTokens?: number;
    pricePerMToken?: number;
  } = {},
): CostEstimate {
  const pricePerMToken = options.pricePerMToken ?? EMBEDDING_USD_PER_MTOKEN;
  let totalChunks = 0;
  let totalTokens = 0;

  for (const a of articles) {
    if (!a || typeof a.content !== 'string' || a.content.length === 0) continue;
    const chunks = splitIntoChunks(a.content, {
      windowTokens: options.windowTokens,
      overlapTokens: options.overlapTokens,
    });
    totalChunks += chunks.length;
    for (const c of chunks) totalTokens += estimateTokens(c);
  }

  const estimatedUsd = (totalTokens / 1_000_000) * pricePerMToken;
  return {
    totalArticles: articles.length,
    totalChunks,
    totalTokens,
    estimatedUsd,
  };
}

/**
 * 記事一覧が手元に無い段階での粗見積もり（記事数のみから推定）。
 * `AVG_TOKENS_PER_CHUNK` × 1 記事あたり平均 chunk 数 で算出する。
 */
export function estimateCostRough(
  articleCount: number,
  avgChunksPerArticle: number,
  pricePerMToken: number = EMBEDDING_USD_PER_MTOKEN,
): CostEstimate {
  const totalChunks = Math.round(articleCount * avgChunksPerArticle);
  const totalTokens = totalChunks * AVG_TOKENS_PER_CHUNK;
  const estimatedUsd = (totalTokens / 1_000_000) * pricePerMToken;
  return {
    totalArticles: articleCount,
    totalChunks,
    totalTokens,
    estimatedUsd,
  };
}

// ─── 進捗ファイル ───────────────────────────────────────────────────────────

export interface EmbedProgress {
  startedAt: string;
  updatedAt: string;
  completedArticleIds: string[];
  errors: { sourceArticleId: string; chunkIndex: number; error: string }[];
}

export async function loadProgress(path: string): Promise<EmbedProgress | null> {
  try {
    const buf = await fs.readFile(path, 'utf8');
    const json = JSON.parse(buf) as EmbedProgress;
    if (!Array.isArray(json.completedArticleIds)) return null;
    return json;
  } catch {
    return null;
  }
}

export async function saveProgress(path: string, prog: EmbedProgress): Promise<void> {
  const dir = dirname(pathResolve(path));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path, JSON.stringify(prog, null, 2), 'utf8');
}

// ─── 確認 prompt ────────────────────────────────────────────────────────────

async function askConfirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    // TTY でなければ自動拒否（CI など）
    console.warn('[embed-all-source-chunks] non-TTY; aborting (use --confirm to skip)');
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(`${message} (yes/no) > `, (ans) => {
      rl.close();
      res(/^y(es)?$/i.test(ans.trim()));
    });
  });
}

// ─── バッチ実行 ─────────────────────────────────────────────────────────────

interface RunOptions {
  args: EmbedCliArgs;
  supabase: SupabaseLikeClient;
}

/**
 * バッチ実行のメイン。テスト容易性のため supabase / args は外から注入する。
 */
async function runEmbedBatch(opts: RunOptions): Promise<EmbedAllResult> {
  const { args, supabase } = opts;

  // 1) source_articles 全件取得
  let query = (supabase as any)
    .from('source_articles')
    .select('id, title, content, themes, emotional_tone, spiritual_concepts')
    .order('id', { ascending: true });
  if (typeof args.limit === 'number') {
    query = query.limit(args.limit);
  }
  const { data: articles, error: listErr } = await query;
  if (listErr) {
    throw new Error(`Failed to load source_articles: ${listErr.message ?? String(listErr)}`);
  }

  let list: SourceArticleForEmbed[] = (articles ?? []).filter(
    (a: SourceArticleForEmbed) =>
      a && typeof a.content === 'string' && a.content.length > 0,
  );

  // 2) resume: 進捗ファイル読込 → 完了済み id を skip
  let progress: EmbedProgress = {
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedArticleIds: [],
    errors: [],
  };
  if (args.resume) {
    const loaded = await loadProgress(args.progressPath);
    if (loaded) {
      progress = loaded;
      const done = new Set(loaded.completedArticleIds);
      const before = list.length;
      list = list.filter((a) => !done.has(a.id));
      console.log(
        `[embed-all-source-chunks] resume: skipping ${before - list.length} already-completed articles ` +
          `(remaining=${list.length})`,
      );
    } else {
      console.log('[embed-all-source-chunks] resume requested but no progress file found, starting fresh');
    }
  }

  // 3) コスト見積もり
  const estimate = estimateCost(list);
  console.log('[embed-all-source-chunks] cost estimate', {
    articles: estimate.totalArticles,
    chunks: estimate.totalChunks,
    tokens: estimate.totalTokens,
    estimatedUsd: estimate.estimatedUsd.toFixed(4),
  });

  if (args.dryRun) {
    console.log('[embed-all-source-chunks] --dry-run: skipping Gemini calls');
    return {
      totalArticles: estimate.totalArticles,
      totalChunks: estimate.totalChunks,
      insertedChunks: 0,
      skippedChunks: 0,
      errors: [],
    };
  }

  // 4) 確認 prompt
  if (!args.confirm) {
    const ok = await askConfirm(
      `Proceed to embed ${estimate.totalChunks} chunks (~$${estimate.estimatedUsd.toFixed(4)})?`,
    );
    if (!ok) {
      console.log('[embed-all-source-chunks] aborted by user');
      return {
        totalArticles: estimate.totalArticles,
        totalChunks: estimate.totalChunks,
        insertedChunks: 0,
        skippedChunks: 0,
        errors: [],
      };
    }
  }

  // 5) 既存 chunk hash を一括ロード
  const allIds = list.map((a) => a.id);
  const existingByArticle = new Map<string, Set<string>>();
  const HASH_BATCH = 200;
  for (let i = 0; i < allIds.length; i += HASH_BATCH) {
    const partial = await fetchExistingChunkHashes(supabase, allIds.slice(i, i + HASH_BATCH));
    for (const [k, v] of partial) existingByArticle.set(k, v);
  }

  // 6) batchSize ずつ並列で処理
  const result: EmbedAllResult = {
    totalArticles: list.length,
    totalChunks: 0,
    insertedChunks: 0,
    skippedChunks: 0,
    errors: [],
  };

  let processed = 0;
  for (let i = 0; i < list.length; i += args.batchSize) {
    const batch = list.slice(i, i + args.batchSize);
    const batchResults = await Promise.all(
      batch.map(async (article) => {
        try {
          const { records, skipped } = await embedSourceArticle(article, {
            existingHashes: existingByArticle.get(article.id) ?? new Set(),
          });

          if (records.length > 0) {
            const { error: insErr } = await (supabase as any)
              .from('source_chunks')
              .insert(records);
            if (insErr) {
              return {
                article,
                ok: false as const,
                error: `insert failed: ${insErr.message ?? String(insErr)}`,
                inserted: 0,
                skipped,
                total: records.length + skipped,
              };
            }
          }
          return {
            article,
            ok: true as const,
            inserted: records.length,
            skipped,
            total: records.length + skipped,
          };
        } catch (e) {
          return {
            article,
            ok: false as const,
            error: e instanceof Error ? e.message : String(e),
            inserted: 0,
            skipped: 0,
            total: 0,
          };
        }
      }),
    );

    for (const br of batchResults) {
      result.totalChunks += br.total;
      result.insertedChunks += br.inserted;
      result.skippedChunks += br.skipped;
      if (br.ok) {
        progress.completedArticleIds.push(br.article.id);
      } else {
        const err = {
          sourceArticleId: br.article.id,
          chunkIndex: -1,
          error: br.error ?? 'unknown',
        };
        result.errors.push(err);
        progress.errors.push(err);
      }
      if (args.verbose) {
        console.log(
          `[embed-all-source-chunks] ${br.article.id} ` +
            `inserted=${br.inserted} skipped=${br.skipped} ok=${br.ok}`,
        );
      }
    }

    processed += batch.length;
    progress.updatedAt = new Date().toISOString();
    // バッチ完了ごとに progress を保存（非ブロッキングで例外は警告のみ）
    try {
      await saveProgress(args.progressPath, progress);
    } catch (e) {
      console.warn(
        '[embed-all-source-chunks] saveProgress failed:',
        e instanceof Error ? e.message : String(e),
      );
    }

    if (processed % args.progressEvery === 0 || processed === list.length) {
      console.log(
        `[embed-all-source-chunks] progress ${processed}/${list.length} ` +
          `inserted=${result.insertedChunks} skipped=${result.skippedChunks} ` +
          `errors=${result.errors.length}`,
      );
    }
  }

  return result;
}

// ─── エントリポイント ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error(
      '[embed-all-source-chunks] missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY',
    );
    process.exit(1);
  }

  // dry-run 以外は GEMINI_API_KEY 必須（API キー値は決してログに出さない）
  const args = parseArgs(process.argv.slice(2));
  if (!args.dryRun && !process.env.GEMINI_API_KEY) {
    console.error('[embed-all-source-chunks] missing GEMINI_API_KEY');
    process.exit(1);
  }

  console.log('[embed-all-source-chunks] start', {
    limit: args.limit,
    batchSize: args.batchSize,
    dryRun: args.dryRun,
    resume: args.resume,
    verbose: args.verbose,
    progressPath: args.progressPath,
  });

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const startedAt = Date.now();
  const result = await runEmbedBatch({
    args,
    supabase: supabase as unknown as SupabaseLikeClient,
  });

  const durationSec = Math.round((Date.now() - startedAt) / 1000);
  console.log('[embed-all-source-chunks] finished', {
    durationSec,
    totalArticles: result.totalArticles,
    totalChunks: result.totalChunks,
    insertedChunks: result.insertedChunks,
    skippedChunks: result.skippedChunks,
    errors: result.errors.length,
  });

  if (result.errors.length > 0) {
    console.warn(
      '[embed-all-source-chunks] sample errors:',
      result.errors.slice(0, 5),
    );
  }
  process.exit(result.errors.length > 0 ? 2 : 0);
}

// テスト時 (vitest が import するだけ) は main を実行しない
const isDirectRun =
  typeof require !== 'undefined' &&
  typeof module !== 'undefined' &&
  require.main === module;

if (isDirectRun) {
  main().catch((err) => {
    console.error('[embed-all-source-chunks] fatal', err);
    process.exit(1);
  });
}
