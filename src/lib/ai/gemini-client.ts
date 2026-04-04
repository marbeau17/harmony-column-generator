// ============================================================================
// src/lib/ai/gemini-client.ts
// Gemini API 共通クライアント（スピリチュアルコラム向け・シングルテナント）
//
// 機能:
//   - REST API 直接呼び出し (fetch ベース・SDK不使用)
//   - リトライ (指数バックオフ・最大1回)
//   - タイムアウト制御 (120秒)
//   - JSON レスポンスモード
//   - JSON 切り詰め修復機能
//   - トークン使用量追跡
//   - 構造化ログ出力
// ============================================================================

import type {
  GeminiRequestConfig,
  GeminiResponse,
  GeminiMessage,
} from '@/types/ai';

// ─── 環境変数 & 定数 ───────────────────────────────────────────────────────

const GEMINI_API_KEY = () => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  return key;
};

const GEMINI_MODEL = () =>
  process.env.GEMINI_MODEL || 'gemini-pro-3.1';

const GEMINI_IMAGE_MODEL = () =>
  process.env.GEMINI_IMAGE_MODEL || 'banana-pro';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/** デフォルト設定 */
const DEFAULTS = {
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192,       // 2000字記事対応
  timeoutMs: 120_000,          // 2分
  maxRetries: 1,               // 1回リトライ（合計2回試行）
  retryBaseDelayMs: 1000,
} as const;

// ─── リトライ用ヘルパー ─────────────────────────────────────────────────────

function isRetryableError(status: number): boolean {
  return status === 429 || status === 503 || status >= 500;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── メイン呼び出し関数 ─────────────────────────────────────────────────────

/**
 * Gemini API を呼び出して応答テキストを取得する。
 *
 * @example
 * ```ts
 * const response = await callGemini({
 *   systemInstruction: 'あなたはスピリチュアルコラムのライターです。',
 *   messages: [{ role: 'user', parts: [{ text: 'タイトル案を3つ提案して' }] }],
 *   temperature: 0.8,
 *   responseAsJson: true,
 * });
 * const data = JSON.parse(response.text);
 * ```
 */
export async function callGemini(
  config: GeminiRequestConfig,
): Promise<GeminiResponse> {
  const model = config.model || GEMINI_MODEL();
  const apiKey = config.apiKey || GEMINI_API_KEY();
  const url = `${BASE_URL}/${model}:generateContent?key=${apiKey}`;

  // ── リクエストボディ組み立て ──
  const requestBody: Record<string, unknown> = {
    contents: config.messages.map((msg) => ({
      role: msg.role,
      parts: msg.parts,
    })),
    generationConfig: {
      temperature: config.temperature ?? DEFAULTS.temperature,
      topP: config.topP ?? DEFAULTS.topP,
      topK: config.topK ?? DEFAULTS.topK,
      maxOutputTokens: config.maxOutputTokens ?? DEFAULTS.maxOutputTokens,
      ...(config.responseAsJson
        ? { responseMimeType: 'application/json' }
        : {}),
    },
  };

  // systemInstruction を追加
  if (config.systemInstruction) {
    requestBody.systemInstruction = {
      parts: [{ text: config.systemInstruction }],
    };
  }

  // ── リトライループ ──
  const maxRetries = config.maxRetries ?? DEFAULTS.maxRetries;
  const timeoutMs = config.timeoutMs ?? DEFAULTS.timeoutMs;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = DEFAULTS.retryBaseDelayMs * Math.pow(2, attempt - 1);
      console.warn('[gemini.retry]', {
        attempt,
        delayMs: delay,
        model,
      });
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

      // ── エラーハンドリング ──
      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'unknown');

        if (isRetryableError(response.status) && attempt < maxRetries) {
          console.warn('[gemini.retryable_error]', {
            status: response.status,
            attempt,
            errorBody: errorBody.substring(0, 500),
          });
          lastError = new Error(
            `Gemini API error ${response.status}: ${errorBody.substring(0, 200)}`,
          );
          continue;
        }

        // レートリミット特別処理
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          console.error('[gemini.rate_limited]', {
            retryAfter,
            model,
          });
        }

        throw new Error(
          `Gemini API error ${response.status}: ${errorBody.substring(0, 500)}`,
        );
      }

      // ── レスポンスパース ──
      const data = await response.json();
      const durationMs = Date.now() - startTime;

      const candidate = data.candidates?.[0];
      if (!candidate) {
        throw new Error(
          `Gemini returned no candidates: ${JSON.stringify(data).substring(0, 500)}`,
        );
      }

      const text =
        candidate.content?.parts
          ?.map((p: { text?: string }) => p.text || '')
          .join('') || '';

      const finishReason = candidate.finishReason || 'UNKNOWN';

      // トークン使用量
      const usage = data.usageMetadata || {};
      const tokenUsage = {
        promptTokens: usage.promptTokenCount || 0,
        completionTokens: usage.candidatesTokenCount || 0,
        totalTokens: usage.totalTokenCount || 0,
      };

      console.info('[gemini.success]', {
        model,
        durationMs,
        finishReason,
        promptTokens: tokenUsage.promptTokens,
        completionTokens: tokenUsage.completionTokens,
        totalTokens: tokenUsage.totalTokens,
        responseLength: text.length,
        attempt,
      });

      return {
        text,
        finishReason,
        tokenUsage,
        rawResponse: data,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'AbortError'
      ) {
        lastError = new Error(
          `Gemini API timeout after ${timeoutMs}ms (attempt ${attempt + 1})`,
        );
        console.error('[gemini.timeout]', {
          timeoutMs,
          attempt,
          model,
        });

        if (attempt < maxRetries) continue;
        throw lastError;
      }

      if (attempt >= maxRetries) {
        console.error('[gemini.final_failure]', {
          attempt,
          model,
          error,
        });
        throw error;
      }

      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || new Error('Gemini API call failed after retries');
}

// ─── ユーティリティ関数 ─────────────────────────────────────────────────────

/**
 * シンプルな単発テキスト生成。
 * system + user の1ターンだけのケースで使いやすいショートカット。
 */
export async function generateText(
  systemPrompt: string,
  userPrompt: string,
  options?: Partial<GeminiRequestConfig>,
): Promise<GeminiResponse> {
  return callGemini({
    systemInstruction: systemPrompt,
    messages: [
      { role: 'user', parts: [{ text: userPrompt }] },
    ],
    ...options,
  });
}

/**
 * 切り詰められたJSON文字列を修復する。
 * 文字列リテラルの内外を正確にスキャンし、
 * 未閉じの文字列・配列・オブジェクトを閉じる。
 */
function repairTruncatedJson(text: string): string {
  let inString = false;
  let escaped = false;
  const stack: string[] = []; // '{' or '['

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') stack.push('{');
    else if (ch === '[') stack.push('[');
    else if (ch === '}') { if (stack.length > 0 && stack[stack.length - 1] === '{') stack.pop(); }
    else if (ch === ']') { if (stack.length > 0 && stack[stack.length - 1] === '[') stack.pop(); }
  }

  let repaired = text;

  // 未閉じの文字列を閉じる
  if (inString) {
    repaired += '"';
  }

  // 末尾の不完全なキー/値区切りを除去 (例: "key":  や "key": "val", )
  repaired = repaired.replace(/,\s*$/, '');
  repaired = repaired.replace(/:\s*$/, ': null');

  // 未閉じのブラケット/ブレースを内側から順に閉じる
  while (stack.length > 0) {
    const open = stack.pop();
    repaired += open === '{' ? '}' : ']';
  }

  return repaired;
}

/**
 * JSON レスポンスを生成してパースする。
 * パース失敗時は切り詰められたJSONの自動修復を試みる。
 */
export async function generateJson<T>(
  systemPrompt: string,
  userPrompt: string,
  options?: Partial<GeminiRequestConfig>,
): Promise<{ data: T; response: GeminiResponse }> {
  const response = await callGemini({
    systemInstruction: systemPrompt,
    messages: [
      { role: 'user', parts: [{ text: userPrompt }] },
    ],
    responseAsJson: true,
    ...options,
  });

  // finishReason を先にチェック — 切り詰められた応答はパース前に拒否
  if (response.finishReason === 'MAX_TOKENS') {
    console.error('[gemini.json_truncated]', {
      finishReason: response.finishReason,
      tokenUsage: response.tokenUsage,
      responseText: response.text.substring(0, 300),
    });
    throw new Error('AI出力がトークン上限で切り捨てられました。再試行してください。');
  }

  // Gemini が ```json ... ``` で囲む場合があるため除去
  const cleanText = response.text
    .replace(/^```json\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const data = JSON.parse(cleanText) as T;
    return { data, response };
  } catch (parseError) {
    // JSON修復を試みる（切り詰められたレスポンス対応）
    console.warn('[gemini.json_parse_attempt_repair]', {
      finishReason: response.finishReason,
      responseLength: response.text.length,
      tokenUsage: response.tokenUsage,
    });

    try {
      const repaired = repairTruncatedJson(cleanText);
      const data = JSON.parse(repaired) as T;
      console.info('[gemini.json_repair_success]', {
        finishReason: response.finishReason,
        originalLength: cleanText.length,
        repairedLength: repaired.length,
      });
      return { data, response };
    } catch {
      // 修復失敗
      console.error('[gemini.json_parse_failed]', {
        finishReason: response.finishReason,
        responseText: response.text.substring(0, 500),
        parseError,
      });

      throw new Error(
        `Gemini returned invalid JSON (finishReason: ${response.finishReason}): ${response.text.substring(0, 200)}`,
      );
    }
  }
}

/**
 * 会話履歴を引き継ぐマルチターン呼び出し。
 * プロンプトチェーン（Stage2）で使用。
 */
export async function generateWithHistory(
  systemPrompt: string,
  history: GeminiMessage[],
  newUserMessage: string,
  options?: Partial<GeminiRequestConfig>,
): Promise<GeminiResponse> {
  const messages: GeminiMessage[] = [
    ...history,
    { role: 'user', parts: [{ text: newUserMessage }] },
  ];

  return callGemini({
    systemInstruction: systemPrompt,
    messages,
    ...options,
  });
}

// ─── 画像生成 ───────────────────────────────────────────────────────────────

export interface GenerateImageResult {
  imageBuffer: Buffer;
  mimeType: string;
}

/**
 * Gemini Image Model で画像を生成する。
 * stage1_image_prompts のプロンプトを入力し、画像バッファを返す。
 */
export async function generateImage(
  prompt: string,
  options?: { timeoutMs?: number; apiKey?: string },
): Promise<GenerateImageResult> {
  const model = GEMINI_IMAGE_MODEL();
  const apiKey = options?.apiKey || GEMINI_API_KEY();
  const url = `${BASE_URL}/${model}:generateContent?key=${apiKey}`;
  const timeoutMs = options?.timeoutMs ?? 180_000; // 3 min for image gen

  const requestBody = {
    contents: [
      { role: 'user', parts: [{ text: prompt }] },
    ],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT'],
      temperature: 0.8,
      topP: 0.95,
      topK: 40,
    },
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= DEFAULTS.maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = DEFAULTS.retryBaseDelayMs * Math.pow(2, attempt - 1);
      console.warn('[gemini.image.retry]', { attempt, delayMs: delay, model });
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
        if (isRetryableError(response.status) && attempt < DEFAULTS.maxRetries) {
          lastError = new Error(`Gemini Image API error ${response.status}: ${errorBody.substring(0, 200)}`);
          continue;
        }
        throw new Error(`Gemini Image API error ${response.status}: ${errorBody.substring(0, 500)}`);
      }

      const data = await response.json();
      const durationMs = Date.now() - startTime;

      const candidate = data.candidates?.[0];
      if (!candidate) {
        throw new Error(`Gemini Image returned no candidates: ${JSON.stringify(data).substring(0, 500)}`);
      }

      // Extract image data from inlineData parts
      const imagePart = candidate.content?.parts?.find(
        (p: { inlineData?: { mimeType: string; data: string } }) => p.inlineData,
      );

      if (!imagePart?.inlineData) {
        throw new Error('Gemini Image response contains no image data');
      }

      const { mimeType, data: base64Data } = imagePart.inlineData;
      const imageBuffer = Buffer.from(base64Data, 'base64');

      console.info('[gemini.image.success]', {
        model,
        durationMs,
        mimeType,
        imageSizeBytes: imageBuffer.length,
        promptLength: prompt.length,
        attempt,
      });

      return { imageBuffer, mimeType };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = new Error(`Gemini Image API timeout after ${timeoutMs}ms (attempt ${attempt + 1})`);
        console.error('[gemini.image.timeout]', { timeoutMs, attempt, model });
        if (attempt < DEFAULTS.maxRetries) continue;
        throw lastError;
      }
      if (attempt >= DEFAULTS.maxRetries) {
        console.error('[gemini.image.final_failure]', { attempt, model, error });
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || new Error('Gemini Image API call failed after retries');
}

// ─── トークン推定 (簡易) ────────────────────────────────────────────────────

/**
 * テキストのトークン数を概算する（日本語: 文字数 x 1.5 で推定）。
 * 正確なカウントには Google の countTokens API を使うべきだが、
 * quotaチェック用の概算には十分。
 */
export function estimateTokens(text: string): number {
  // 英数字: ~4文字/token、日本語: ~1.5文字/token の混合概算
  const japaneseChars = (text.match(/[\u3000-\u9fff\uf900-\ufaff]/g) || []).length;
  const otherChars = text.length - japaneseChars;
  return Math.ceil(japaneseChars * 1.5 + otherChars / 4);
}
