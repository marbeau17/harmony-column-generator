// ============================================================================
// src/lib/ai/prompts/zero-image-prompt.ts
// Zero Generation 専用 画像プロンプトビルダー（Banana Pro 用）
// spec §10.1 に対応：persona / theme から style を導出し、
// hero / body / summary の 3 プロンプトを「決定論的に」組み立てる。
//
// 既存 src/lib/ai/prompts/image-prompt.ts の motif map と style 指示を踏襲する。
// （image-prompt.ts は LLM 経由生成、本ファイルは ZeroOutline からの直接合成）
// ============================================================================

import type { ZeroOutlineOutput } from './stage1-zero-outline';

// ─── 共通スタイル / ネガティブ ────────────────────────────────────────────────

/** Banana Pro 共通スタイルキーワード（image-prompt.ts と同一トーン） */
const COMMON_STYLE_KEYWORDS =
  'soft pastel illustration, ethereal, dreamy, warm lighting, gentle glow';

/** Zero Generation 用ネガティブプロンプト（spec §10.1 固定 + P5-29 強化） */
export const ZERO_NEGATIVE_PROMPT =
  'text, watermark, logo, signature, deformed hands, religious symbols, medical equipment, ' +
  'human face, portrait, person, character, woman face, man face, body parts, eyes, mouth';

// ─── テーマ別モチーフマップ（image-prompt.ts から踏襲） ──────────────────────

const THEME_MOTIFS: Record<string, string> = {
  '魂と使命': 'cosmos, path of light, stars, galaxy, celestial glow',
  '人間関係': 'hands reaching, threads of connection, bridge, gentle touch',
  'グリーフケア': 'butterfly, rainbow, soft flowers, peaceful meadow',
  '自己成長': 'seed sprouting, lotus bloom, sunrise, golden dawn',
  '癒しと浄化': 'crystal, clear water, forest, morning dew',
  '日常の気づき': 'four seasons, sky, sunset, gentle clouds',
  '入門': 'doorway, path ahead, tunnel of light, open gate',
};

// ─── ペルソナ別スタイルプリセット（spec §10.1） ─────────────────────────────

/** 30 代主婦：パステル系・暖かいベージュ・自然光・夢幻的ボケ */
const STYLE_30S_HOMEMAKER =
  'soft pastel, warm beige, natural light, dreamy bokeh';

/** 40 代キャリア：クリーンミニマル・ミュートアース・モダンインテリア */
const STYLE_40S_CAREER =
  'clean minimal, muted earth tones, modern interior';

/** 50 代以上：荘厳・ディープアンバー・ゴールデンアワー・成熟したエレガンス */
const STYLE_50S_PLUS =
  'serene, deep amber, golden hour, mature elegance';

/** ペルソナ未指定時のフォールバック */
const STYLE_FALLBACK =
  'soft pastel, gentle warm tones, natural light, peaceful atmosphere';

// ─── 入出力型 ────────────────────────────────────────────────────────────────

export interface ZeroImagePromptPersona {
  /** 任意のスタイル属性（age_range / preset / palette 等） */
  age_range?: string;
  preset?: '30s_homemaker' | '40s_career' | '50s_plus' | string;
  palette?: string;
  mood?: string;
  /** 上記以外の自由カスタム文字列群（end of style 連結） */
  extra?: string[];
}

export interface ZeroImagePromptTheme {
  /** カラーパレット（例: "warm gold, soft lavender"） */
  palette?: string;
  /** ライティング・トーン（例: "morning haze, golden hour"） */
  lighting?: string;
  /** 雰囲気・形容（例: "introspective, hopeful"） */
  mood?: string;
  /** 任意の自由形式文字列（先頭に追加） */
  extra?: string[];
}

export interface ZeroImagePromptInput {
  outline: ZeroOutlineOutput;
  persona?: { image_style?: ZeroImagePromptPersona } | null;
  theme?: { visual_mood?: ZeroImagePromptTheme; name?: string } | null;
}

export interface ZeroImagePromptResult {
  hero: string;
  body: string;
  summary: string;
}

// ─── 内部ヘルパ ───────────────────────────────────────────────────────────────

/** persona.image_style から style 文字列を組み立てる */
function buildPersonaStyle(style: ZeroImagePromptPersona | undefined): string {
  if (!style || Object.keys(style).length === 0) {
    return STYLE_FALLBACK;
  }

  // preset 優先
  if (style.preset === '30s_homemaker') return STYLE_30S_HOMEMAKER;
  if (style.preset === '40s_career') return STYLE_40S_CAREER;
  if (style.preset === '50s_plus') return STYLE_50S_PLUS;

  // age_range から推定
  if (style.age_range) {
    const range = style.age_range.toLowerCase();
    if (range.includes('30') || range.includes('homemaker')) return STYLE_30S_HOMEMAKER;
    if (range.includes('40') || range.includes('career')) return STYLE_40S_CAREER;
    if (
      range.includes('50') ||
      range.includes('60') ||
      range.includes('70') ||
      range.includes('mature') ||
      range.includes('senior')
    ) {
      return STYLE_50S_PLUS;
    }
  }

  // 個別属性から構築
  const parts: string[] = [];
  if (style.palette) parts.push(style.palette);
  if (style.mood) parts.push(style.mood);
  if (style.extra && style.extra.length > 0) parts.push(...style.extra);

  return parts.length > 0 ? parts.join(', ') : STYLE_FALLBACK;
}

/** theme.visual_mood から mood 文字列を組み立てる */
function buildThemeMood(mood: ZeroImagePromptTheme | undefined): string {
  if (!mood || Object.keys(mood).length === 0) return '';

  const parts: string[] = [];
  if (mood.extra && mood.extra.length > 0) parts.push(...mood.extra);
  if (mood.palette) parts.push(mood.palette);
  if (mood.lighting) parts.push(mood.lighting);
  if (mood.mood) parts.push(mood.mood);

  return parts.join(', ');
}

/** theme name からモチーフを部分一致で取得 */
function resolveThemeMotif(themeName: string | undefined): string {
  if (!themeName) return '';
  const matched = Object.entries(THEME_MOTIFS)
    .filter(([key]) => themeName.includes(key) || key.includes(themeName))
    .map(([, motifs]) => motifs);
  return matched.join(', ');
}

/** outline.image_prompts から slot のシード文字列を取得 */
function pickOutlineSeed(
  outline: ZeroOutlineOutput,
  slot: 'hero' | 'body' | 'summary',
): string {
  const found = outline.image_prompts?.find((p) => p.slot === slot);
  return found?.prompt?.trim() ?? '';
}

/** 1 つのスロット用に最終プロンプト文字列を合成する */
function composePrompt(params: {
  slot: 'hero' | 'body' | 'summary';
  outlineSeed: string;
  personaStyle: string;
  themeMood: string;
  motif: string;
  fallbackContext: string;
}): string {
  const {
    slot,
    outlineSeed,
    personaStyle,
    themeMood,
    motif,
    fallbackContext,
  } = params;

  // スロット別役割記述
  const slotRole: Record<typeof slot, string> = {
    hero: 'wide hero composition, 16:9, establishing the article world',
    body: 'square body composition, 1:1, symbolizing the chapter feeling',
    summary: 'square summary composition, 1:1, hopeful closing scene',
  };

  // 文脈：outline のシードがあれば優先、なければ fallback
  const context = outlineSeed.length > 0 ? outlineSeed : fallbackContext;

  // 順序: 文脈 → モチーフ → ペルソナスタイル → テーマムード → 共通スタイル → 役割
  const segments = [
    context,
    motif,
    personaStyle,
    themeMood,
    COMMON_STYLE_KEYWORDS,
    slotRole[slot],
    `negative_prompt: ${ZERO_NEGATIVE_PROMPT}`,
  ].filter((s) => s && s.length > 0);

  return segments.join(' | ');
}

// ─── 公開 API ─────────────────────────────────────────────────────────────────

/**
 * Zero Generation 用に hero / body / summary の 3 プロンプトをビルドする。
 * spec §10.1 に従い、persona / theme から決定論的に画像プロンプトを合成する。
 *
 * @param input - outline / persona / theme
 * @returns hero / body / summary の 3 プロンプト
 */
export function buildZeroImagePrompts(
  input: ZeroImagePromptInput,
): ZeroImagePromptResult {
  const { outline } = input;

  console.log('[image-prompt.begin]', {
    theme_name: input.theme?.name,
    has_visual_mood: !!input.theme?.visual_mood,
    has_image_style: !!input.persona?.image_style,
    outline_h2_count: outline.h2_chapters?.length ?? 0,
  });

  const personaStyle = buildPersonaStyle(input.persona?.image_style);
  const themeMood = buildThemeMood(input.theme?.visual_mood);
  const motif = resolveThemeMotif(input.theme?.name);

  // outline からの fallback context（lead_summary を簡易翻案に使う）
  const fallbackBase =
    outline.lead_summary?.slice(0, 80) ?? 'gentle spiritual scene';

  const slots: Array<'hero' | 'body' | 'summary'> = ['hero', 'body', 'summary'];
  const result: Record<'hero' | 'body' | 'summary', string> = {
    hero: '',
    body: '',
    summary: '',
  };

  for (const slot of slots) {
    const seed = pickOutlineSeed(outline, slot);
    const fallbackContext =
      slot === 'hero'
        ? `${fallbackBase} — opening atmosphere of the article`
        : slot === 'body'
          ? `${fallbackBase} — symbolic moment from the middle chapter`
          : `${fallbackBase} — quiet hopeful closing scene`;

    result[slot] = composePrompt({
      slot,
      outlineSeed: seed,
      personaStyle,
      themeMood,
      motif,
      fallbackContext,
    });
  }

  console.log('[image-prompt.end]', {
    hero_chars: result.hero.length,
    body_chars: result.body.length,
    summary_chars: result.summary.length,
  });

  return result;
}

// ─── 補助 export（テスト用） ──────────────────────────────────────────────────

export const ZERO_IMAGE_STYLE_PRESETS = {
  homemaker_30s: STYLE_30S_HOMEMAKER,
  career_40s: STYLE_40S_CAREER,
  mature_50s_plus: STYLE_50S_PLUS,
  fallback: STYLE_FALLBACK,
} as const;
