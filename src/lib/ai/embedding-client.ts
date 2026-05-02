// ============================================================================
// src/lib/ai/embedding-client.ts
// Gemini Embedding 用の薄いクライアント
//
// gemini-client.ts はテキスト/画像生成専用で、本ファイルが embedding を担当。
// gemini-client.ts の既存メソッド（callGemini, generateText, generateJson,
// generateImage, estimateTokens）には触れない。
//
// バグE (2026-05-02): text-embedding-004 が API から deprecated/削除されたため、
// gemini-embedding-001 (v1beta) + outputDimensionality:768 で 768 dim を維持する。
// (既存 source_chunks.embedding vector(768) と互換)
// ============================================================================

/** Gemini Embedding の task_type */
export type EmbeddingTaskType =
  | 'RETRIEVAL_DOCUMENT'
  | 'RETRIEVAL_QUERY'
  | 'SEMANTIC_SIMILARITY'
  | 'CLASSIFICATION'
  | 'CLUSTERING'
  | 'QUESTION_ANSWERING'
  | 'FACT_VERIFICATION';

export interface GenerateEmbeddingOptions {
  /** モデル名（デフォルト gemini-embedding-001） */
  model?: string;
  /** タイムアウト ms（デフォルト 60_000） */
  timeoutMs?: number;
  /** APIキー（未設定時は環境変数フォールバック） */
  apiKey?: string;
  /** リトライ回数（デフォルト 1） */
  maxRetries?: number;
  /** 任意のタイトル（task_type=RETRIEVAL_DOCUMENT のときのみ Gemini API が利用） */
  title?: string;
  /** 出力次元数（gemini-embedding-001 default=3072。DB は 768 で揃えるためデフォルト 768） */
  outputDimensionality?: number;
}

const EMBEDDING_MODEL_DEFAULT = 'gemini-embedding-001';
const EMBEDDING_DIMENSIONS = 768;
const BASE_HOST = 'https://generativelanguage.googleapis.com';
// gemini-embedding-001 は v1beta のみ提供。v1 endpoint にはモデルが存在せず 404。
const API_VERSIONS = ['v1beta'] as const;
type ApiVersion = (typeof API_VERSIONS)[number];

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

/** APIキーをマスクした URL 文字列を返す（ログ出力用）。 */
function maskUrl(url: string): string {
  return url.replace(/key=[^&]+/g, 'key=***');
}

/** 指定 API バージョンの embedContent エンドポイントを組み立てる。 */
function buildEmbedUrl(apiVersion: ApiVersion, model: string, apiKey: string): string {
  return `${BASE_HOST}/${apiVersion}/models/${model}:embedContent?key=${apiKey}`;
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

  const outputDim = options.outputDimensionality ?? EMBEDDING_DIMENSIONS;
  const requestBody: Record<string, unknown> = {
    model: `models/${model}`,
    content: { parts: [{ text }] },
    taskType,
    // gemini-embedding-001 は default 3072 dim を返すため、DB 互換性のため明示縮小
    outputDimensionality: outputDim,
  };
  if (options.title && taskType === 'RETRIEVAL_DOCUMENT') {
    requestBody.title = options.title;
  }

  let lastError: Error | null = null;
  let lastFailureStatus: number | null = null;
  let lastFailureBody = '';
  let lastApiVersionTried: ApiVersion | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn('[gemini.embed.retry]', { attempt, delayMs: delay, model });
      await sleep(delay);
    }

    // ── API バージョンフォールバック: v1 → v1beta ───────────────────────────
    // text-embedding-004 は v1 エンドポイントに存在するため v1 を優先し、
    // 404 が返った場合のみ v1beta にフォールバックする。
    let attemptError: Error | null = null;
    let attemptShouldRetry = false;

    versionLoop: for (let vi = 0; vi < API_VERSIONS.length; vi++) {
      const apiVersion = API_VERSIONS[vi];
      const url = buildEmbedUrl(apiVersion, model, apiKey);
      const maskedUrl = maskUrl(url);
      lastApiVersionTried = apiVersion;

      console.log('[gemini.embed.begin]', {
        model_id: model,
        api_version: apiVersion,
        url: maskedUrl,
        content_chars: text.length,
        task_type: taskType,
        output_dim: outputDim,
        attempt,
      });

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
          lastFailureStatus = response.status;
          lastFailureBody = errorBody;

          // 404 のときは次のバージョン (v1beta) にフォールバック
          if (response.status === 404 && vi < API_VERSIONS.length - 1) {
            console.warn('[gemini.embed.version_fallback]', {
              from: apiVersion,
              to: API_VERSIONS[vi + 1],
              reason: '404',
              body_head: errorBody.slice(0, 200),
            });
            continue versionLoop;
          }

          // リトライ可能なステータスコードならリトライへ
          if (isRetryableError(response.status) && attempt < maxRetries) {
            attemptError = new Error(
              `Gemini Embedding API error ${response.status} (${apiVersion}): ${errorBody.substring(0, 200)}`,
            );
            attemptShouldRetry = true;
            break versionLoop;
          }

          // それ以外のエラーは即時失敗
          throw new Error(
            `Gemini Embedding API error ${response.status} (${apiVersion}): ${errorBody.substring(0, 500)}`,
          );
        }

        const data = await response.json();
        const elapsed_ms = Date.now() - startTime;

        const values: number[] | undefined = data?.embedding?.values;
        if (!values || !Array.isArray(values)) {
          throw new Error(
            `Gemini Embedding returned no values (${apiVersion}): ${JSON.stringify(data).substring(0, 300)}`,
          );
        }
        if (values.length !== outputDim) {
          console.warn('[gemini.embed.unexpected_dims]', {
            expected: outputDim,
            got: values.length,
            model,
            api_version: apiVersion,
          });
        }

        console.log('[gemini.embed.success]', {
          model_id: model,
          api_version_used: apiVersion,
          content_chars: text.length,
          dimension: values.length,
          elapsed_ms,
          taskType,
          attempt,
        });

        return values;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          attemptError = new Error(
            `Gemini Embedding API timeout after ${timeoutMs}ms (${apiVersion}, attempt ${attempt + 1})`,
          );
          attemptShouldRetry = attempt < maxRetries;
          break versionLoop;
        }
        // fetch 自体がスローした場合は他バージョンも試さず、リトライ判定へ
        attemptError = error instanceof Error ? error : new Error(String(error));
        attemptShouldRetry = attempt < maxRetries;
        break versionLoop;
      }
    }
    // ── /API バージョンフォールバック ──────────────────────────────────────

    if (attemptError && attemptShouldRetry) {
      lastError = attemptError;
      continue;
    }
    if (attemptError) {
      console.error('[gemini.embed.final_failure]', {
        model_id: model,
        api_version_tried: lastApiVersionTried,
        status: lastFailureStatus,
        body_head: lastFailureBody.slice(0, 500),
        attempt,
        error: attemptError.message,
      });
      throw attemptError;
    }
  }

  console.error('[gemini.embed.final_failure]', {
    model_id: model,
    api_version_tried: lastApiVersionTried,
    status: lastFailureStatus,
    body_head: lastFailureBody.slice(0, 500),
    attempt: maxRetries,
    error: lastError?.message ?? 'unknown',
  });
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
