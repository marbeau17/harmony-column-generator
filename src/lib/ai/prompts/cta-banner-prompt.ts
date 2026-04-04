// ============================================================================
// src/lib/ai/prompts/cta-banner-prompt.ts
// CTAバナー画像用 Banana Pro プロンプト設計
// 3段階ファネルに対応した3種類のバナー画像プロンプト
// ============================================================================

// ─── 共通ネガティブプロンプト ────────────────────────────────────────────────

const COMMON_NEGATIVE_PROMPT =
  'text, watermark, logo, dark, scary, realistic human face, religious symbols, horror, gore, nsfw, low quality, blurry';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

export interface CtaBannerPromptItem {
  position: 'cta1' | 'cta2' | 'cta3';
  label: string;
  prompt: string;
  negative_prompt: string;
  aspect_ratio: '16:9';
  width: number;
  height: number;
  alt_text_ja: string;
}

// ─── バナープロンプト生成 ────────────────────────────────────────────────────

/**
 * 3つのCTAバナー用画像生成プロンプトを返す。
 *
 * - CTA1（説明ページ向け）: 柔らかな光のカウンセリングルーム、温かいブラウン系
 * - CTA2（流れページ向け）: ステップを象徴する光の道、階段、扉が開くイメージ
 * - CTA3（予約ページ向け）: 手と手が光で繋がるイメージ、ゴールド系、希望
 *
 * サイズ: 16:9 バナー（1200x675 想定）
 */
export function buildCtaBannerPrompts(): CtaBannerPromptItem[] {
  return [
    {
      position: 'cta1',
      label: 'カウンセリング説明ページ向けバナー',
      prompt: [
        'A serene and inviting counseling room bathed in soft warm light,',
        'comfortable armchair near a window with gentle sunlight streaming through sheer curtains,',
        'small table with a cup of herbal tea and a single flower in a vase,',
        'warm brown and beige color palette with touches of soft gold,',
        'cozy and welcoming atmosphere,',
        'soft pastel illustration style, ethereal, dreamy, warm lighting, gentle glow,',
        'no people visible, peaceful interior, minimalist Japanese aesthetic,',
        'wide banner composition 16:9 aspect ratio',
      ].join(' '),
      negative_prompt: COMMON_NEGATIVE_PROMPT,
      aspect_ratio: '16:9',
      width: 1200,
      height: 675,
      alt_text_ja: '温かな光に包まれた癒しのカウンセリングルーム',
    },
    {
      position: 'cta2',
      label: '予約の流れページ向けバナー',
      prompt: [
        'A mystical pathway of soft golden light leading through an opening doorway,',
        'gentle stepping stones made of glowing crystal floating in a dreamy space,',
        'each step illuminated with a different pastel color creating a progression,',
        'an ornate door at the end slowly opening to reveal warm radiant light,',
        'lavender and soft blue gradient background with sparkles,',
        'soft pastel illustration style, ethereal, dreamy, warm lighting, gentle glow,',
        'symbolizing a journey of steps and progression,',
        'wide banner composition 16:9 aspect ratio',
      ].join(' '),
      negative_prompt: COMMON_NEGATIVE_PROMPT,
      aspect_ratio: '16:9',
      width: 1200,
      height: 675,
      alt_text_ja: '光の道が導くカウンセリングへのステップ',
    },
    {
      position: 'cta3',
      label: '予約ページ向けバナー',
      prompt: [
        'Two graceful hands reaching toward each other connected by streams of golden light and sparkles,',
        'warm gold and amber color palette radiating hope and connection,',
        'soft ethereal background with gentle bokeh light effects,',
        'delicate energy threads weaving between the hands like a bridge of light,',
        'sense of warmth, trust, and new beginnings,',
        'soft pastel illustration style, ethereal, dreamy, warm lighting, gentle glow,',
        'abstract and spiritual, no realistic skin details,',
        'wide banner composition 16:9 aspect ratio',
      ].join(' '),
      negative_prompt: COMMON_NEGATIVE_PROMPT,
      aspect_ratio: '16:9',
      width: 1200,
      height: 675,
      alt_text_ja: '光でつながる手と手 — カウンセリングのご予約',
    },
  ];
}

/**
 * 特定のCTAポジション用のプロンプトを取得する
 */
export function getCtaBannerPrompt(
  position: 'cta1' | 'cta2' | 'cta3',
): CtaBannerPromptItem | undefined {
  return buildCtaBannerPrompts().find((p) => p.position === position);
}
