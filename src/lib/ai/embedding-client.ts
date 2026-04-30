// ============================================================================
// src/lib/ai/embedding-client.ts
// Gemini text-embedding-004 用の薄いクライアント
//
// gemini-client.ts はテキスト/画像生成専用で、本ファイルが embedding を担当。
// gemini-client.ts の既存メソッド（callGemini, generateText, generateJson,
// generateImage, estimateTokens）には触れない。
// ============================================================================

/** Gemini text-embedding-004 の task_type */
export type EmbeddingTaskType =
  | 'RETRIEVAL_DOCUMENT'
  | 'RETRIEVAL_QUERY'
  | 'SEMANTIC_SIMILARITY'
  | 'CLASSIFICATION'
  | 'CLUSTERING'
  | 'QUESTION_ANSWERING'
  | 'FACT_VERIFICATION';

export interface GenerateEmbeddingOptions {
  /** モデル名（デフォルト text-embedding-004） */
  model?: string;
  /** タイムアウト ms（デフォルト 60_000） */
  timeoutMs?: number;
  /** APIキー（未設定時は環境変数フォールバック） */
  apiKey?: string;
  /** リトライ回数（デフォルト 1） */
  maxRetries?: number;
  /** 任意のタイトル（task_type=RETRIEVAL_DOCUMENT のときのみ Gemini API が利用） */
  title?: string;
}

const EMBEDDING_MODEL_DEFAULT = 'text-embedding-004';
const EMBEDDING_DIMENSIONS = 768;
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const RETRY_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_TIMEOUT_MS = 60_000;

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  return key;
}

function isRetryableError(status: number): boolean {
  return status === 429 || status === 503 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Gemini text-embedding-004 で embedding ベクトル（768 次元）を取得する。
 *
 * task_type は仕様書 §6 RAG 連携に従い、index 時 = RETRIEVAL_DOCUMENT、
 * クエリ時 = RETRIEVAL_QUERY を指定する。
 *
 * @example
 * ```ts
 * const vec = await generateEmbedding('泣いていい朝もある', 'RETRIEVAL_DOCUMENT');
 * ```
 */
export async function generateEmbedding(
  text: string,
  taskType: EmbeddingTaskType,
  options: GenerateEmbeddingOptions = {},
): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error('generateEmbedding: text must be non-empty');
  }

  const model = options.model || EMBEDDING_MODEL_DEFAULT;
  const apiKey = options.apiKey || getApiKey();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  const url = `${BASE_URL}/${model}:embedContent?key=${apiKey}`;

  const requestBody: Record<string, unknown> = {
    model: `models/${model}`,
    content: { parts: [{ text }] },
    taskType,
  };
  if (options.title && taskType === 'RETRIEVAL_DOCUMENT') {
    requestBody.title = options.title;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn('[gemini.embed.retry]', { attempt, delayMs: delay, model });
      await sleep(delay);
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const startTime = Date.now();

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'unknown');
        if (isRetryableError(response.status) && attempt < maxRetries) {
          lastError = new Error(
            `Gemini Embedding API error ${response.status}: ${errorBody.substring(0, 200)}`,
          );
          continue;
        }
        throw new Error(
          `Gemini Embedding API error ${response.status}: ${errorBody.substring(0, 500)}`,
        );
      }

      const data = await response.json();
      const durationMs = Date.now() - startTime;

      const values: number[] | undefined = data?.embedding?.values;
      if (!values || !Array.isArray(values)) {
        throw new Error(
          `Gemini Embedding returned no values: ${JSON.stringify(data).substring(0, 300)}`,
        );
      }
      if (values.length !== EMBEDDING_DIMENSIONS) {
        console.warn('[gemini.embed.unexpected_dims]', {
          expected: EMBEDDING_DIMENSIONS,
          got: values.length,
          model,
        });
      }

      console.info('[gemini.embed.success]', {
        model,
        taskType,
        durationMs,
        dims: values.length,
        textLength: text.length,
        attempt,
      });

      return values;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = new Error(
          `Gemini Embedding API timeout after ${timeoutMs}ms (attempt ${attempt + 1})`,
        );
        if (attempt < maxRetries) continue;
        throw lastError;
      }
      if (attempt >= maxRetries) {
        console.error('[gemini.embed.final_failure]', { attempt, model, error });
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || new Error('Gemini Embedding API call failed after retries');
}

/** テスト/小規模用の素朴なバッチ embedding。1 件ずつ順次呼ぶ。 */
export async function generateEmbeddingsBatch(
  texts: string[],
  taskType: EmbeddingTaskType,
  options: GenerateEmbeddingOptions = {},
): Promise<number[][]> {
  const out: number[][] = [];
  for (const t of texts) {
    out.push(await generateEmbedding(t, taskType, options));
  }
  return out;
}
