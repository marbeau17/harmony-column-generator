// ============================================================================
// src/lib/content/image-prompts-normalizer.ts
// 画像プロンプトの正規化＋検証
//
// 背景: AI 出力には 2 系統のスキーマが歴史的に混在する
//   - stage1-outline.ts → { section_id, heading_text, prompt, suggested_filename }
//   - image-prompt.ts   → { position, prompt, alt_text_ja, caption_ja, ... }
// route.ts の images ステップは `position` のみを参照していたため、
// stage1 形式が DB に残ったまま images ステップに到達すると
// `position=undefined` で画像が無音失敗 → image_files=0 → 公開記事に画像が出ない。
//
// この正規化レイヤで両形式を canonical な NormalizedImagePrompt に変換し、
// 不正なものは即座に throw して上流の queue を failed に落とす。
// ============================================================================

export type ImagePosition = 'hero' | 'body' | 'summary';

export interface NormalizedImagePrompt {
  position: ImagePosition;
  prompt: string;
  alt: string;
}

const VALID_POSITIONS: ReadonlySet<string> = new Set(['hero', 'body', 'summary']);

// null/undefined/循環参照などで JSON.stringify が失敗・undefined を返すケースを吸収
function safeJsonSlice(value: unknown, maxLen: number): string {
  try {
    const s = JSON.stringify(value);
    return typeof s === 'string' ? s.slice(0, maxLen) : String(value).slice(0, maxLen);
  } catch {
    return String(value).slice(0, maxLen);
  }
}

/**
 * 1 件の画像プロンプト raw 値を canonical 形式に変換する。
 * 不正値は throw する（呼び出し側で catch して queue を failed に落とす想定）。
 *
 * 受け入れる入力スキーマ:
 *   { position, prompt, alt_text_ja? }                        (image-prompt.ts 形式)
 *   { section_id, prompt, heading_text? }                      (stage1-outline.ts 形式)
 *   どちらか一方の混在は許容、両方ある場合は image-prompt.ts 形式優先
 */
export function normalizeImagePrompt(raw: unknown): NormalizedImagePrompt {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`画像プロンプトが object でない: ${safeJsonSlice(raw, 120)}`);
  }
  const obj = raw as Record<string, unknown>;

  const rawPosition = (obj.position ?? obj.section_id) as unknown;
  const rawPrompt = obj.prompt as unknown;
  const rawAlt = (obj.alt_text_ja ?? obj.heading_text ?? '') as unknown;

  if (typeof rawPrompt !== 'string' || rawPrompt.trim().length === 0) {
    throw new Error(`画像プロンプトの prompt が空: ${safeJsonSlice(obj, 120)}`);
  }
  if (typeof rawPosition !== 'string' || rawPosition.trim().length === 0) {
    throw new Error(
      `画像プロンプトの position/section_id が未指定: ${safeJsonSlice(obj, 120)}`,
    );
  }
  if (!VALID_POSITIONS.has(rawPosition)) {
    throw new Error(
      `画像プロンプトの position 値が不正 (hero/body/summary のいずれか): "${rawPosition}"`,
    );
  }

  return {
    position: rawPosition as ImagePosition,
    prompt: rawPrompt,
    alt: typeof rawAlt === 'string' ? rawAlt : '',
  };
}

/**
 * 配列全体を正規化。
 * 1 件でも不正があれば全体 throw（無音スキップ禁止）。
 */
export function normalizeImagePrompts(rawList: unknown): NormalizedImagePrompt[] {
  if (!Array.isArray(rawList)) {
    throw new Error(`画像プロンプトが配列でない: ${safeJsonSlice(rawList, 120)}`);
  }
  return rawList.map((raw, i) => {
    try {
      return normalizeImagePrompt(raw);
    } catch (e) {
      throw new Error(`画像プロンプト[${i}] 正規化失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}
