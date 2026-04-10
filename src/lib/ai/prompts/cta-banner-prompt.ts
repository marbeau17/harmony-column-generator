// ============================================================================
// src/lib/ai/prompts/cta-banner-prompt.ts
// CTAバナー画像用 Banana Pro プロンプト設計
// 3段階ファネルに対応した3種類のバナー画像プロンプト
//
// デザイン方針:
// - 3:1 横長バナー（1200x400）で記事画像(16:9)と明確に差別化
// - テキストオーバーレイ前提: 下半分〜中央が暗めのグラデーションになるよう設計
// - 上部に明るいモチーフ、下部は暗め or ぼかしで可読性を確保
// ============================================================================

// ─── 共通ネガティブプロンプト ────────────────────────────────────────────────

const COMMON_NEGATIVE_PROMPT =
  'text, letters, words, watermark, logo, dark, scary, realistic human face, religious symbols, horror, gore, nsfw, low quality, blurry, cluttered, busy composition, centered subject';

// ─── 共通スタイル指示（テキストオーバーレイ前提） ──────────────────────────

const OVERLAY_READY_STYLE = [
  'ultra-wide panoramic banner composition 3:1 aspect ratio,',
  'the bottom half gradually fades to a dark warm brown tone for text overlay readability,',
  'main visual elements positioned in upper portion of the frame,',
  'soft pastel illustration style, ethereal, dreamy, warm lighting, gentle glow,',
  'subtle vignette darkening toward bottom edge,',
  'painterly digital art style with soft edges,',
].join(' ');

// ─── 型定義 ─────────────────────────────────────────────────────────────────

export interface CtaBannerPromptItem {
  position: 'cta2' | 'cta3';
  label: string;
  prompt: string;
  negative_prompt: string;
  aspect_ratio: '3:1';
  width: number;
  height: number;
  alt_text_ja: string;
}

// ─── バナープロンプト生成 ────────────────────────────────────────────────────

/**
 * 2つのCTAバナー用画像生成プロンプトを返す。
 *
 * - CTA2（流れページ向け）: ステップを象徴する光の道、階段、扉が開くイメージ
 * - CTA3（予約ページ向け）: 手と手が光で繋がるイメージ、ゴールド系、希望
 *
 * サイズ: 3:1 横長バナー（1200x400）- テキストオーバーレイ前提
 * 下半分が暗めになるよう設計し、CSSの半透明オーバーレイと組み合わせて使用
 */
export function buildCtaBannerPrompts(): CtaBannerPromptItem[] {
  return [
    {
      position: 'cta2',
      label: '予約の流れページ向けバナー',
      prompt: [
        'A mystical panoramic landscape with a pathway of soft golden light,',
        'gentle glowing stepping stones leading toward an ornate door opening in the distance,',
        'each stone illuminated with pastel colors showing progression from left to right,',
        'lavender and soft blue gradient sky in the upper portion with sparkles and stars,',
        'the path and door positioned in the upper third of the frame,',
        'symbolizing a gentle journey of steps toward a warm destination,',
        'lower portion dissolves into deep twilight purple-brown tones,',
        OVERLAY_READY_STYLE,
      ].join(' '),
      negative_prompt: COMMON_NEGATIVE_PROMPT,
      aspect_ratio: '3:1',
      width: 1200,
      height: 400,
      alt_text_ja: '光の道が導くカウンセリングへのステップ',
    },
    {
      position: 'cta3',
      label: '予約ページ向けバナー',
      prompt: [
        'Two graceful abstract hands reaching toward each other in the upper portion of frame,',
        'connected by streams of golden light sparkles and energy ribbons,',
        'warm gold and amber color palette radiating hope and connection,',
        'soft ethereal background with gentle bokeh light effects in upper half,',
        'delicate energy threads weaving between the hands like a bridge of light,',
        'sense of warmth trust and new beginnings,',
        'abstract and spiritual, no realistic skin details,',
        'lower half transitions to deep warm amber-brown darkness,',
        OVERLAY_READY_STYLE,
      ].join(' '),
      negative_prompt: COMMON_NEGATIVE_PROMPT,
      aspect_ratio: '3:1',
      width: 1200,
      height: 400,
      alt_text_ja: '光でつながる手と手 — カウンセリングのご予約',
    },
  ];
}

/**
 * 特定のCTAポジション用のプロンプトを取得する
 */
export function getCtaBannerPrompt(
  position: 'cta2' | 'cta3',
): CtaBannerPromptItem | undefined {
  return buildCtaBannerPrompts().find((p) => p.position === position);
}
