// ============================================================================
// src/lib/image/vision-check.ts
// 画像ハルシネーション Vision 検査 (G6)
//
// 機能:
//   - 生成画像 (base64 / data URL / http(s) URL) を Gemini Vision で検査
//   - テキスト混入・ロゴ混入・人体構造破綻・テーマ整合性を判定
//   - 0〜100 の総合スコアを算出（< 70 で flagged）
//
// プライバシールール:
//   - 画像 base64 / 画像 URL を logger に出力しない
//   - 画像サイズ等のメタ情報のみログ出力
// ============================================================================

import type { VisionCheckResult } from '@/types/vision';

// ─── 環境変数 & 定数 ─────────────────────────────────────────────────────────

const GEMINI_API_KEY = () => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  return key;
};

const GEMINI_VISION_MODEL = () =>
  process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/** flagged と判定するしきい値（score < FLAG_THRESHOLD で再生成推奨） */
export const FLAG_THRESHOLD = 70;

/** デフォルト設定 */
const DEFAULTS = {
  timeoutMs: 60_000,
  maxRetries: 1,
  retryBaseDelayMs: 1000,
} as const;

// ─── 入出力型 ────────────────────────────────────────────────────────────────

export interface VisionCheckOptions {
  /** テーマ（例: "瞑想", "チャクラ"）。整合性判定に使用 */
  theme?: string;
  /** ペルソナ（例: "30代女性"）。整合性判定に使用 */
  persona?: string;
  /** ビジュアルムード（例: "calm warm", "ethereal"）。整合性判定に使用 */
  visualMood?: string;
  /** タイムアウト (ms) */
  timeoutMs?: number;
  /** API キー（未指定時は環境変数フォールバック） */
  apiKey?: string;
  /** モデル名上書き */
  model?: string;
  /** リトライ回数 */
  maxRetries?: number;
}

/** Gemini Vision に投げる JSON スキーマ準拠の生レスポンス */
interface RawVisionJson {
  has_text?: boolean;
  has_logo?: boolean;
  anatomy_ok?: boolean;
  theme_alignment?: number;
  notes?: string;
}

// ─── ヘルパー ────────────────────────────────────────────────────────────────

function isRetryableError(status: number): boolean {
  return status === 429 || status === 503 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 画像入力 (base64 / data URL / http(s) URL) を、
 * Gemini Vision API が受け付ける parts 形式に変換する。
 *
 * - "data:image/png;base64,xxxx"  → inline_data { mime_type, data }
 * - 純粋な base64 ("/9j/...")     → inline_data { mime_type: image/png, data }
 * - "https://..."                 → fileData { fileUri, mimeType }
 */
export function buildImagePart(
  imageDataOrUrl: string,
): { inline_data: { mime_type: string; data: string } } | { file_data: { mime_type: string; file_uri: string } } {
  if (!imageDataOrUrl || typeof imageDataOrUrl !== 'string') {
    throw new Error('vision-check: imageDataOrUrl must be a non-empty string');
  }

  // data URL
  const dataUrlMatch = imageDataOrUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUrlMatch) {
    return {
      inline_data: {
        mime_type: dataUrlMatch[1],
        data: dataUrlMatch[2],
      },
    };
  }

  // http(s) URL
  if (/^https?:\/\//i.test(imageDataOrUrl)) {
    // mime type は拡張子から推定（不明なら image/png にフォールバック）
    const ext = imageDataOrUrl.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();
    const mime =
      ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'webp'
          ? 'image/webp'
          : ext === 'gif'
            ? 'image/gif'
            : 'image/png';
    return {
      file_data: {
        mime_type: mime,
        file_uri: imageDataOrUrl,
      },
    };
  }

  // 純粋な base64 とみなす
  return {
    inline_data: {
      mime_type: 'image/png',
      data: imageDataOrUrl,
    },
  };
}

/**
 * Gemini Vision に渡す検査プロンプト。
 * JSON モードで以下のフィールドを返させる。
 */
function buildPrompt(theme?: string, persona?: string, visualMood?: string): string {
  const themeLine = theme ? `テーマ: ${theme}` : 'テーマ: （未指定）';
  const personaLine = persona ? `想定読者: ${persona}` : '想定読者: （未指定）';
  const moodLine = visualMood
    ? `ビジュアルムード: ${visualMood}`
    : 'ビジュアルムード: （未指定）';

  return [
    'あなたは画像品質検査官です。提示された画像を厳密に分析し、',
    '以下の JSON スキーマに **そのまま** 従って判定結果を返してください。',
    '',
    '## 判定対象',
    themeLine,
    personaLine,
    moodLine,
    '',
    '## 判定項目',
    '- has_text       : 画像内に文字（日本語・英数字・記号）が一文字でも描かれているなら true、なければ false',
    '- has_logo       : 画像内にロゴ・透かし・ブランドマーク・ウォーターマークが描かれているなら true、なければ false',
    '- anatomy_ok     : 人物が描かれている場合、指本数・関節・顔のパーツが自然なら true、破綻していれば false。人物が描かれていない場合も true',
    '- theme_alignment: 0.0〜1.0 の小数で、テーマ／ビジュアルムードとの整合性を評価',
    '- notes          : 上記判定の根拠を 60 文字以内の日本語で要約',
    '',
    '## 出力形式',
    '```',
    '{"has_text": bool, "has_logo": bool, "anatomy_ok": bool, "theme_alignment": number, "notes": string}',
    '```',
    'JSON のみを返してください。前後の説明文は不要です。',
  ].join('\n');
}

/**
 * Gemini Vision の生 JSON を VisionCheckResult に正規化し、
 * total score を算出する。
 *
 * スコア配点（合計 100）:
 *   - has_text == false       : 30 点
 *   - has_logo == false       : 20 点
 *   - anatomy_ok == true      : 20 点
 *   - theme_alignment * 30    : 0〜30 点
 *
 * → score < FLAG_THRESHOLD (70) で flagged
 */
export function calcScore(raw: RawVisionJson): VisionCheckResult {
  const has_text = raw.has_text === true;
  const has_logo = raw.has_logo === true;
  // anatomy_ok は未提供時 true 扱い（人物無し画像で省略されるケース対応）
  const anatomy_ok = raw.anatomy_ok !== false;

  const rawAlignment =
    typeof raw.theme_alignment === 'number' && Number.isFinite(raw.theme_alignment)
      ? raw.theme_alignment
      : 0;
  const theme_alignment = Math.max(0, Math.min(1, rawAlignment));

  let score = 0;
  if (!has_text) score += 30;
  if (!has_logo) score += 20;
  if (anatomy_ok) score += 20;
  score += Math.round(theme_alignment * 30);

  // 安全に 0〜100 にクランプ
  score = Math.max(0, Math.min(100, score));

  const flagged = score < FLAG_THRESHOLD;
  const notes = typeof raw.notes === 'string' ? raw.notes : '';

  return {
    has_text,
    has_logo,
    anatomy_ok,
    theme_alignment,
    score,
    flagged,
    notes,
  };
}

/**
 * Gemini Vision のレスポンス JSON 文字列をパースする。
 * ```json ... ``` ラップに対応。
 */
function parseVisionJson(text: string): RawVisionJson {
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned) as RawVisionJson;
}

// ─── メイン関数 ──────────────────────────────────────────────────────────────

/**
 * 画像ハルシネーション Vision 検査。
 *
 * @param imageDataOrUrl 画像 (base64 / data URL / http(s) URL)
 * @param theme          テーマ (省略可)
 * @param persona        ペルソナ (省略可)
 * @returns VisionCheckResult
 *
 * @example
 * ```ts
 * const result = await checkImageHallucination(
 *   'data:image/png;base64,iVBORw0KGgo...',
 *   '瞑想',
 *   '30代女性',
 * );
 * if (result.flagged) {
 *   // 再生成
 * }
 * ```
 */
export async function checkImageHallucination(
  imageDataOrUrl: string,
  theme?: string,
  persona?: string,
  options: VisionCheckOptions = {},
): Promise<VisionCheckResult> {
  const model = options.model || GEMINI_VISION_MODEL();
  const apiKey = options.apiKey || GEMINI_API_KEY();
  const url = `${BASE_URL}/${model}:generateContent?key=${apiKey}`;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;

  const visualMood = options.visualMood ?? options.theme;
  const promptText = buildPrompt(theme ?? options.theme, persona ?? options.persona, visualMood);
  const imagePart = buildImagePart(imageDataOrUrl);

  // ── プライバシー: 画像本体は決してログに出さない ──
  const imageMeta = 'inline_data' in imagePart
    ? { kind: 'inline', mime: imagePart.inline_data.mime_type, sizeBytes: imagePart.inline_data.data.length }
    : { kind: 'file_uri', mime: imagePart.file_data.mime_type };

  const requestBody: Record<string, unknown> = {
    contents: [
      {
        role: 'user',
        parts: [
          imagePart,
          { text: promptText },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
    },
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = DEFAULTS.retryBaseDelayMs * Math.pow(2, attempt - 1);
      console.warn('[vision-check.retry]', { attempt, delayMs: delay, model });
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
          console.warn('[vision-check.retryable_error]', {
            status: response.status,
            attempt,
            errorBody: errorBody.substring(0, 300),
          });
          lastError = new Error(
            `Vision API error ${response.status}: ${errorBody.substring(0, 200)}`,
          );
          continue;
        }
        throw new Error(
          `Vision API error ${response.status}: ${errorBody.substring(0, 500)}`,
        );
      }

      const data = await response.json();
      const durationMs = Date.now() - startTime;

      const candidate = data.candidates?.[0];
      if (!candidate) {
        throw new Error(
          `Vision API returned no candidates: ${JSON.stringify(data).substring(0, 300)}`,
        );
      }

      const text =
        candidate.content?.parts
          ?.map((p: { text?: string }) => p.text || '')
          .join('') || '';

      let raw: RawVisionJson;
      try {
        raw = parseVisionJson(text);
      } catch (parseErr) {
        console.error('[vision-check.parse_failed]', {
          model,
          // 画像は出さない・レスポンス先頭のみ
          responseHead: text.substring(0, 200),
          parseErr: parseErr instanceof Error ? parseErr.message : String(parseErr),
        });
        throw new Error('Vision API returned non-JSON output');
      }

      const result = calcScore(raw);

      console.info('[vision-check.success]', {
        model,
        durationMs,
        // 画像メタのみ・本体は出さない
        image: imageMeta,
        themeProvided: Boolean(theme),
        personaProvided: Boolean(persona),
        score: result.score,
        flagged: result.flagged,
        attempt,
      });

      return result;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = new Error(
          `Vision API timeout after ${timeoutMs}ms (attempt ${attempt + 1})`,
        );
        console.error('[vision-check.timeout]', { timeoutMs, attempt, model });
        if (attempt < maxRetries) continue;
        throw lastError;
      }
      if (attempt >= maxRetries) {
        console.error('[vision-check.final_failure]', {
          attempt,
          model,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || new Error('Vision API call failed after retries');
}

// ─── テスト用 export ────────────────────────────────────────────────────────

/** ユニットテスト用の内部 API 公開 */
export const __test__ = {
  buildPrompt,
  parseVisionJson,
};
