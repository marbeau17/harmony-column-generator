// ============================================================================
// src/lib/ai/prompts/image-prompt.ts
// Banana Pro 用画像プロンプト生成
// スピリチュアルコラム向け — 記事構成から画像生成用プロンプトを生成
// ============================================================================

// ─── 定数 ─────────────────────────────────────────────────────────────────────

/** ネガティブプロンプト共通 */
const COMMON_NEGATIVE_PROMPT =
  'text, watermark, logo, dark, scary, horror, religious symbols, realistic human face, photorealistic portrait';

/** テーマ別モチーフマッピング */
const THEME_MOTIFS: Record<string, string> = {
  '魂と使命': 'cosmos, path of light, stars, galaxy, celestial glow',
  '人間関係': 'hands reaching, threads of connection, bridge, gentle touch',
  'グリーフケア': 'butterfly, rainbow, soft flowers, peaceful meadow',
  '自己成長': 'seed sprouting, lotus bloom, sunrise, golden dawn',
  '癒しと浄化': 'crystal, clear water, forest, morning dew',
  '日常の気づき': 'four seasons, sky, sunset, gentle clouds',
  '入門': 'doorway, path ahead, tunnel of light, open gate',
};

// ─── 型定義 ─────────────────────────────────────────────────────────────────

export interface ImagePromptInput {
  title: string;
  theme: string;
  sections: string[];
  imagePositions: {
    position: string;
    context: string;
  }[];
}

export interface ImagePromptItem {
  position: 'hero' | 'body' | 'summary';
  prompt: string;
  negative_prompt: string;
  aspect_ratio: '16:9' | '1:1';
  alt_text_ja: string;
  caption_ja: string;
}

export interface ImagePromptsResult {
  prompts: ImagePromptItem[];
}

// ─── システムプロンプト ─────────────────────────────────────────────────────

export function buildImagePromptSystemPrompt(): string {
  return `あなたはスピリチュアル系ブログ専門の画像ディレクターです。

## あなたの役割
- ブログ記事の内容に基づいて、Banana Pro 画像生成モデル向けの英語プロンプトを設計する
- 記事のテーマ・雰囲気に合った、読者の心を癒す画像を指示する
- 各画像の配置位置に応じた最適な構図・アスペクト比を選定する

## 画像スタイルガイド（必ず従うこと）

### トーン
- 穏やか、温かみ、癒し、光を基調とする
- 幻想的でありつつ、押しつけがましくない柔らかさ

### カラーパレット
- パステル基調
- 淡い金色（warm gold, #d4a574 tone）
- 薄紫（soft lavender）
- 若草色（fresh green, sage）
- 全体的に明るく透明感のある色彩

### 絶対禁止事項（NG）
- 暗い・不気味な画像
- 宗教シンボルの直接描写（十字架、数珠、仏像など）
- 人物の顔がはっきり見える構図
- テキスト・文字入り画像
- ホラー・恐怖を連想させるモチーフ

### テーマ別モチーフ（参考にすること）
${Object.entries(THEME_MOTIFS)
  .map(([theme, motifs]) => `- ${theme}: ${motifs}`)
  .join('\n')}

## 出力ルール（必ず守ること）

1. レスポンスは **JSON のみ** で返してください（前後の説明文は不要）
2. prompt は **英語で100語以内** にすること
3. negative_prompt は必ず以下を含めること: "${COMMON_NEGATIVE_PROMPT}"
4. aspect_ratio は hero を "16:9"、body と summary を "1:1" にすること
5. alt_text_ja と caption_ja は **日本語** で記述すること
6. prompt にはスタイルキーワード "soft pastel illustration, ethereal, dreamy, warm lighting, gentle glow" を含めること
7. 各 position に対して1つずつ、合計で imagePositions の数だけプロンプトを生成すること

## 出力 JSON スキーマ
\`\`\`json
{
  "prompts": [
    {
      "position": "hero" | "body" | "summary",
      "prompt": "英語プロンプト（100語以内）",
      "negative_prompt": "ネガティブプロンプト",
      "aspect_ratio": "16:9" | "1:1",
      "alt_text_ja": "日本語altテキスト",
      "caption_ja": "日本語キャプション"
    }
  ]
}
\`\`\``;
}

// ─── ユーザープロンプト ─────────────────────────────────────────────────────

export function buildImagePromptUserPrompt(input: ImagePromptInput): string {
  // テーマに対応するモチーフを取得（部分一致で検索）
  const matchedMotifs = Object.entries(THEME_MOTIFS)
    .filter(([key]) => input.theme.includes(key) || key.includes(input.theme))
    .map(([, motifs]) => motifs)
    .join(', ');

  const motifHint = matchedMotifs
    ? `\n### 推奨モチーフ（テーマに基づく）\n${matchedMotifs}`
    : '';

  return `以下の記事情報に基づいて、画像生成用プロンプトを作成してください。

## 記事情報

### タイトル
${input.title}

### テーマ
${input.theme}
${motifHint}

### セクション構成
${input.sections.map((s, i) => `${i + 1}. ${s}`).join('\n')}

### 画像配置位置
${input.imagePositions
  .map(
    (pos) => `- **${pos.position}**: ${pos.context}`,
  )
  .join('\n')}

## 指示
- 各 imagePositions に対して1つずつ、プロンプトを生成してください
- hero 画像は記事全体の世界観を表現する16:9のワイド画像にしてください
- body 画像は該当セクションの内容を象徴する1:1の正方形画像にしてください
- summary 画像は記事の結びにふさわしい、希望や癒しを感じる1:1の画像にしてください
- alt_text_ja は画像の内容を簡潔に説明するテキスト（SEO対応）にしてください
- caption_ja は記事内に表示するキャプション（読者向け）にしてください

JSON スキーマに完全準拠した結果を出力してください。`;
}
