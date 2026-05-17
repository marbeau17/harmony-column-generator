// generation_queue の current_agent (役割) と現在 step から、
// 実際に動作している AI モデル名を併記した表示ラベルを組み立てる server-side helper。
//
// 例:
//   composeAgentLabel('Planner',   'outline')   → 'AI プランナー (gemini-3.1-pro-preview)'
//   composeAgentLabel('Generator', 'body')      → 'AI ライター (gemini-3.1-pro-preview)'
//   composeAgentLabel('Generator', 'images')    → 'AI ライター (gemini-3-pro-image-preview)'
//   composeAgentLabel('Evaluator', 'seo_check') → 'AI 校閲 (gemini-3.1-pro-preview)'
//   composeAgentLabel('Publisher', null)        → '公開処理'    (AI 非関与)
//   composeAgentLabel(null,        null)        → null
//
// 設計方針:
//   - モデル名は process.env から read (gemini-client.ts と同じ default)
//   - role/step → モデル種別 (text/image/none) のマッピングのみここに閉じる
//   - クライアント側に env を漏らさないため、API レスポンスで合成済みの文字列を渡す

export const TEXT_MODEL_NAME = (): string =>
  process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';

export const IMAGE_MODEL_NAME = (): string =>
  process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview';

const ROLE_LABEL_JA: Record<string, string> = {
  Planner: 'AI プランナー',
  Generator: 'AI ライター',
  Evaluator: 'AI 校閲',
  Publisher: '公開処理',
};

// step ごとに使用される AI モデル種別 ('text' / 'image' / 'none')
// 'none' は AI 非関与 (公開処理など) — モデル名は付与しない
const STEP_MODEL_KIND: Record<string, 'text' | 'image' | 'none'> = {
  pending: 'none',
  outline: 'text',
  body: 'text',
  images: 'image',
  seo_check: 'text',
  completed: 'none',
  failed: 'none',
};

export function composeAgentLabel(
  role: string | null | undefined,
  step: string | null | undefined,
): string | null {
  if (!role) return null;
  const baseLabel = ROLE_LABEL_JA[role] ?? role;
  if (!step) return baseLabel;

  const kind = STEP_MODEL_KIND[step] ?? 'none';
  if (kind === 'none') return baseLabel;

  const modelName = kind === 'image' ? IMAGE_MODEL_NAME() : TEXT_MODEL_NAME();
  return `${baseLabel} (${modelName})`;
}
