// ============================================================================
// src/lib/rag/embed-source-chunks.ts
// RAG: source_articles → chunk 化 → text-embedding-004 → source_chunks INSERT
//
// spec §6 (ハルシネーション軽減) / §3 (パイプライン) RAG 部分の実装。
//
// 設計:
//   1. source_articles 全件 (約 1499 記事) を読み込み
//   2. 段落単位 (空行区切り) で一次分割
//   3. 400 token sliding window (overlap 50) で二次分割
//   4. Gemini text-embedding-004 (task_type=RETRIEVAL_DOCUMENT) で 768 次元 embed
//   5. content_hash (SHA-256) で差分判定 → 既存 hash と一致なら skip
//   6. source_chunks へ INSERT
//
// 既存 publish-control コア / articles.ts / hub-deploy には触れない。
// マイグレ追加は F1 担当のため、このファイルでは行わない。
// ============================================================================

import { createHash } from 'crypto';
import { generateEmbedding } from '@/lib/ai/embedding-client';
import { estimateTokens } from '@/lib/ai/gemini-client';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

/**
 * Supabase クライアント抽象（依存方向を切るため最小 IF だけ要求する）。
 * `@supabase/supabase-js` の SupabaseClient と互換。
 */
export interface SupabaseLikeClient {
  from(table: string): {
    select: (
      columns?: string,
      options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean },
    ) => any;
    insert: (rows: unknown) => any;
    delete: () => any;
    upsert?: (rows: unknown, opts?: unknown) => any;
  };
}

export interface SourceArticleForEmbed {
  id: string;
  title: string;
  content: string;
  themes: string[] | null;
  emotional_tone: string | null;
  spiritual_concepts: string[] | null;
}

export interface ChunkRecord {
  source_article_id: string;
  chunk_index: number;
  chunk_text: string;
  embedding: number[];
  themes: string[];
  emotional_tone: string | null;
  spiritual_concepts: string[];
  content_hash: string;
}

export interface EmbedAllOptions {
  /** 1 件ごとの進捗ログ出力周期（デフォルト 10） */
  progressEvery?: number;
  /** 1 chunk あたりの最大 token 数（デフォルト 400） */
  windowTokens?: number;
  /** sliding window overlap token 数（デフォルト 50） */
  overlapTokens?: number;
  /** 上限件数（テスト用に少数だけ走らせるとき。未指定なら全件） */
  limit?: number;
  /** dry-run なら DB に書かず chunk 数だけ返す */
  dryRun?: boolean;
}

export interface EmbedAllResult {
  totalArticles: number;
  totalChunks: number;
  insertedChunks: number;
  skippedChunks: number;
  errors: { sourceArticleId: string; chunkIndex: number; error: string }[];
}

// ─── ハッシュ ───────────────────────────────────────────────────────────────

/** chunk_text の SHA-256（hashHtml と同じハッシュ関数を採用） */
export function hashChunk(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ─── chunk 化 ───────────────────────────────────────────────────────────────

/**
 * テキストを段落 + sliding window で chunk に分割する。
 *
 * 1. 段落分割: 連続改行（\n\n 以上）で区切る
 * 2. 段落が windowTokens 以下ならそのまま 1 chunk
 * 3. 超える段落は文字単位の sliding window（overlap あり）で分割
 *
 * token 数は estimateTokens を利用（日本語想定の概算）。
 */
export function splitIntoChunks(
  text: string,
  options: { windowTokens?: number; overlapTokens?: number } = {},
): string[] {
  const windowTokens = options.windowTokens ?? 400;
  const overlapTokens = options.overlapTokens ?? 50;

  if (!text || text.trim().length === 0) return [];

  // 段落分割（空行 1 つ以上で区切り）
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: string[] = [];

  for (const para of paragraphs) {
    const tokens = estimateTokens(para);
    if (tokens <= windowTokens) {
      chunks.push(para);
      continue;
    }
    // sliding window 分割
    chunks.push(...slidingWindow(para, windowTokens, overlapTokens));
  }

  return chunks;
}

/**
 * 文字単位 sliding window 分割。
 * estimateTokens の挙動（日本語: 1.5 文字/token）に合わせ、
 * window 文字数 ≒ windowTokens / 1.5 を使う。
 */
function slidingWindow(
  text: string,
  windowTokens: number,
  overlapTokens: number,
): string[] {
  const charsPerToken = 1.5; // estimateTokens の japaneseChars 係数の逆数の近似
  const windowChars = Math.max(1, Math.floor(windowTokens * charsPerToken));
  const overlapChars = Math.max(0, Math.floor(overlapTokens * charsPerToken));
  const stride = Math.max(1, windowChars - overlapChars);

  const out: string[] = [];
  for (let i = 0; i < text.length; i += stride) {
    const slice = text.slice(i, i + windowChars).trim();
    if (slice.length > 0) out.push(slice);
    if (i + windowChars >= text.length) break;
  }
  return out;
}

// ─── 1 記事を chunk 化 + embed ──────────────────────────────────────────────

/**
 * 1 件の source_article を chunk 化し、各 chunk に embedding を付与して返す。
 * content_hash で既存 source_chunks と突き合わせ、未変更なら skip 判定するため、
 * ここでは embedding 生成を「skipSet に含まれない hash のみ」に絞り込む。
 */
export async function embedSourceArticle(
  article: SourceArticleForEmbed,
  options: {
    windowTokens?: number;
    overlapTokens?: number;
    /** 既存 chunk の content_hash 集合（記事単位） */
    existingHashes?: Set<string>;
  } = {},
): Promise<{ records: ChunkRecord[]; skipped: number }> {
  const chunks = splitIntoChunks(article.content, options);
  const records: ChunkRecord[] = [];
  let skipped = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    const contentHash = hashChunk(chunkText);

    if (options.existingHashes?.has(contentHash)) {
      skipped += 1;
      continue;
    }

    const embedding = await generateEmbedding(chunkText, 'RETRIEVAL_DOCUMENT', {
      title: article.title,
    });

    records.push({
      source_article_id: article.id,
      chunk_index: i,
      chunk_text: chunkText,
      embedding,
      themes: article.themes ?? [],
      emotional_tone: article.emotional_tone ?? null,
      spiritual_concepts: article.spiritual_concepts ?? [],
      content_hash: contentHash,
    });
  }

  return { records, skipped };
}

// ─── DB I/O ─────────────────────────────────────────────────────────────────

/**
 * 指定した source_article_id 群について、既存 source_chunks の content_hash を取得。
 * 記事 id ごとに Set を返す。
 */
export async function fetchExistingChunkHashes(
  supabase: SupabaseLikeClient,
  sourceArticleIds: string[],
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (sourceArticleIds.length === 0) return map;

  // chunk 数が多くても hash 列だけなので 1 回でとる
  const { data, error } = await (supabase as any)
    .from('source_chunks')
    .select('source_article_id, content_hash')
    .in('source_article_id', sourceArticleIds);

  if (error) {
    throw new Error(
      `fetchExistingChunkHashes failed: ${error.message ?? String(error)}`,
    );
  }

  for (const row of (data ?? []) as Array<{
    source_article_id: string;
    content_hash: string | null;
  }>) {
    if (!row.content_hash) continue;
    const set = map.get(row.source_article_id) ?? new Set<string>();
    set.add(row.content_hash);
    map.set(row.source_article_id, set);
  }
  return map;
}

/**
 * source_articles を読み込んで chunk 化 + embed + INSERT する。
 * content_hash で差分判定し、既存と同一の chunk は skip する。
 */
export async function embedAllSourceChunks(
  supabase: SupabaseLikeClient,
  options: EmbedAllOptions = {},
): Promise<EmbedAllResult> {
  const progressEvery = options.progressEvery ?? 10;
  const windowTokens = options.windowTokens ?? 400;
  const overlapTokens = options.overlapTokens ?? 50;
  const dryRun = options.dryRun === true;

  // 1) source_articles 全件取得
  let query = (supabase as any)
    .from('source_articles')
    .select(
      'id, title, content, themes, emotional_tone, spiritual_concepts',
    )
    .order('id', { ascending: true });
  if (typeof options.limit === 'number') {
    query = query.limit(options.limit);
  }

  const { data: articles, error: listErr } = await query;
  if (listErr) {
    throw new Error(
      `Failed to load source_articles: ${listErr.message ?? String(listErr)}`,
    );
  }

  const list: SourceArticleForEmbed[] = (articles ?? []).filter(
    (a: SourceArticleForEmbed) => a && typeof a.content === 'string' && a.content.length > 0,
  );

  // 2) 既存 chunk hash を一括ロード（バッチで分割）
  const allIds = list.map((a) => a.id);
  const existingByArticle = new Map<string, Set<string>>();
  const BATCH = 200;
  for (let i = 0; i < allIds.length; i += BATCH) {
    const batchIds = allIds.slice(i, i + BATCH);
    const partial = await fetchExistingChunkHashes(supabase, batchIds);
    for (const [k, v] of partial) existingByArticle.set(k, v);
  }

  const result: EmbedAllResult = {
    totalArticles: list.length,
    totalChunks: 0,
    insertedChunks: 0,
    skippedChunks: 0,
    errors: [],
  };

  // 3) 1 記事ずつ chunk → embed → insert
  for (let idx = 0; idx < list.length; idx++) {
    const article = list[idx];
    const existingHashes = existingByArticle.get(article.id) ?? new Set();

    try {
      const { records, skipped } = await embedSourceArticle(article, {
        windowTokens,
        overlapTokens,
        existingHashes,
      });
      result.totalChunks += records.length + skipped;
      result.skippedChunks += skipped;

      if (records.length > 0 && !dryRun) {
        const { error: insErr } = await (supabase as any)
          .from('source_chunks')
          .insert(records);
        if (insErr) {
          result.errors.push({
            sourceArticleId: article.id,
            chunkIndex: -1,
            error: `insert failed: ${insErr.message ?? String(insErr)}`,
          });
          continue;
        }
      }
      result.insertedChunks += records.length;
    } catch (e) {
      result.errors.push({
        sourceArticleId: article.id,
        chunkIndex: -1,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    if ((idx + 1) % progressEvery === 0) {
      console.log(
        `[embed-source-chunks] progress ${idx + 1}/${list.length} ` +
          `inserted=${result.insertedChunks} skipped=${result.skippedChunks} ` +
          `errors=${result.errors.length}`,
      );
    }
  }

  console.log(
    `[embed-source-chunks] done articles=${result.totalArticles} ` +
      `chunks=${result.totalChunks} inserted=${result.insertedChunks} ` +
      `skipped=${result.skippedChunks} errors=${result.errors.length}`,
  );
  return result;
}
