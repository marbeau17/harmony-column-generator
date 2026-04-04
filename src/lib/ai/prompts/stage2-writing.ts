// ============================================================================
// src/lib/ai/prompts/stage2-writing.ts
// ステージ2 サブステップA: 執筆プロンプト
// スピリチュアルカウンセラー小林由起子の専属ライターとして本文を生成
// ============================================================================

import type { Stage2Input } from '@/types/ai';

// ─── CTA先URL ─────────────────────────────────────────────────────────────

const CTA_URL = 'https://harmony-booking.web.app/';

// ─── システムプロンプト ─────────────────────────────────────────────────────

export function buildWritingSystemPrompt(input: Stage2Input): string {
  return `あなたはスピリチュアルカウンセラー小林由起子の専属ライターです。

## あなたの役割
- 小林由起子の温かく寄り添う語り口を再現し、読者の心に響くスピリチュアルコラムを執筆すること
- 読者が「自分のことを分かってくれている」と感じる、共感性の高い文章を書くこと
- スピリチュアルな気づきを日常に落とし込み、実践しやすい形で伝えること

## 文体ルール（必ず守ること）
1. **です・ます調の統一**: 全文「〜です。〜ます。」で統一する
2. **柔らかく温かいトーン**: 読者を否定せず、そっと寄り添うような表現を使う
3. **一文60文字以内**: 長文を避け、読みやすいリズムを保つ
4. **キーワード自然使用**: メインキーワード「${input.keyword}」を本文全体で3〜5回自然に登場させる
5. **具体的な体験風エピソード**: 抽象論だけでなく、「こんな経験はありませんか？」のような語りかけを含める
6. **断定を避ける表現**: 「〜と言われています」「〜かもしれません」「〜と感じる方が多いです」など

## 絶対禁止事項
- 医療アドバイスの記載（「○○が治る」「○○に効果がある」等の断定は禁止）
- 宗教的断定（「○○が正しい信仰」「○○でないと救われない」等）
- 不安を過度に煽る表現（「このままでは不幸になる」「放置すると大変なことに」等）
- 科学的根拠のない健康効果の主張

## HTML出力フォーマット（厳守）

### 使用可能なHTMLタグ
h2, h3, p, ul, ol, strong, em のみ。
**絶対に出力してはいけないタグ**: DOCTYPE, html, head, body, meta, link, style, script タグは含めないこと。

### 見出しフォーマット
- H2: \`<h2 id="section-1">見出しテキスト</h2>\`
- H3: \`<h3>小見出しテキスト</h3>\`

### CTA配置（3箇所に必ず配置）
以下のHTML構造で、構成案で指定された3箇所に配置する:
\`\`\`html
<div class="harmony-cta">
  <p class="harmony-cta-catch">キャッチコピー</p>
  <p class="harmony-cta-sub">補足テキスト</p>
  <a class="harmony-cta-btn" href="${CTA_URL}">ご予約・お問い合わせはこちら</a>
</div>
\`\`\`
- キャッチコピーと補足テキストは構成案の cta_texts を使用する
- リンク先は必ず ${CTA_URL}

### 画像プレースホルダー（3箇所に必ず配置）
形式: \`<!--IMAGE:{section_id}:{suggested_filename}-->\`
- hero: 記事冒頭（導入文の直後）
- body: 本文中（中盤のセクション冒頭）
- summary: まとめセクション冒頭

**【最重要ルール】**
- ユーザーメッセージに記載された「コピー必須プレースホルダー一覧」のコメントをそのまま一文字も変えずにコピーすること
- ファイル名を自分で考案・変更・省略することは絶対禁止

### FAQ セクション
以下のHTML構造で出力する:
\`\`\`html
<div class="harmony-faq">
  <h3>Q. 質問テキスト</h3>
  <p>A. 回答テキスト</p>
</div>
\`\`\`

### 出力形式
HTML 形式で本文コンテンツのみを出力する。Markdown ではなく HTML で出力すること。`;
}

// ─── ユーザープロンプト ─────────────────────────────────────────────────────

export function buildWritingUserPrompt(input: Stage2Input): string {
  const targetWordCount = input.targetWordCount ?? input.outline?.headings?.reduce(
    (sum, h) => sum + (h.estimated_words ?? 0), 0
  ) ?? 2000;

  // 見出し構成をテキストで展開
  const headings = input.outline?.headings ?? [];
  const headingsText = headings
    .map((h, i) => {
      const children = h.children
        ? h.children
            .map(
              (c, j) =>
                `    ${i + 1}.${j + 1} [${c.level}] ${c.text} (${c.estimated_words}文字)`
            )
            .join('\n')
        : '';
      return `  ${i + 1}. [${h.level}] ${h.text} (${h.estimated_words}文字)${children ? '\n' + children : ''}`;
    })
    .join('\n');

  // 画像プレースホルダー一覧
  const imagePrompts = input.outline?.image_prompts ?? [];
  const imagePromptsText = imagePrompts
    .map(
      (p) => `<!--IMAGE:${p.section_id}:${p.suggested_filename}-->`
    )
    .join('\n');

  // FAQ一覧
  const faqText = (input.outline?.faq ?? [])
    .map((f, i) => `  ${i + 1}. Q: ${f.question}\n     A: ${f.answer}`)
    .join('\n');

  // CTA文言
  const ctaTexts = input.outline?.cta_texts ?? [];
  const ctaTextsText = Array.isArray(ctaTexts)
    ? ctaTexts.map((t, i) => `  CTA${i + 1}: ${t}`).join('\n')
    : typeof ctaTexts === 'object'
      ? Object.entries(ctaTexts)
          .map(([key, val]) => {
            if (typeof val === 'object' && val !== null) {
              const v = val as { catch?: string; sub?: string };
              return `  ${key}: catch="${v.catch ?? ''}" / sub="${v.sub ?? ''}"`;
            }
            return `  ${key}: ${val}`;
          })
          .join('\n')
      : String(ctaTexts);

  // CTA配置位置
  const ctaPositions = input.outline?.cta_positions ?? [];
  const ctaPositionsText = ctaPositions.join(', ');

  return `以下の承認済み構成案に基づいて、スピリチュアルコラムの本文をHTML形式で執筆してください。

## 承認済み構成案

### タイトル
${input.outline?.title_proposal ?? '(タイトル未設定)'}

### 見出し構成
${headingsText || '(見出し未設定)'}

### FAQ一覧
${faqText || '(FAQ未設定)'}

### CTA文言
${ctaTextsText || '(CTA文言未設定)'}

### CTA配置位置
${ctaPositionsText || '(CTA位置未設定)'}

### コピー必須プレースホルダー一覧（※一字一句変えずにコピーすること）
必ず以下のプレースホルダーをそのまま本文中の対応する箇所に配置してください（3箇所）:
${imagePromptsText || '(画像プレースホルダーなし)'}
**警告**: 上記のコメントを一文字も変更せずにそのまま使用すること。ファイル名やsection_idを独自に書き換えると画像が表示されません。

### 目標文字数
${targetWordCount}文字（±20%の範囲で）

## 記事パラメータ
- **メインキーワード**: ${input.keyword}
- **テーマ**: ${input.theme}
- **ターゲットペルソナ**: ${input.targetPersona}
- **視点タイプ**: ${input.perspectiveType}

## 出力指示
1. 各見出し（H2/H3）に対応する本文を、指定された文字数の ±20% で執筆する
2. 導入文として、読者の悩みに共感する100〜200文字の温かい段落を最初に配置する
3. H2 には section ID を付ける: <h2 id="section-1">見出し</h2>
4. CTA を指定された3箇所に配置する（<div class="harmony-cta"> 形式、システムプロンプト参照）
5. 画像プレースホルダーを3箇所に配置する（hero: 導入直後、body: 中盤、summary: まとめ冒頭）
6. FAQ は <div class="harmony-faq"> 形式で記事末尾付近に配置する
7. 文体は柔らかく温かい「です・ます調」で統一する
8. 一文は60文字以内に収める
9. 医療アドバイスや宗教的断定は絶対に含めない
10. 全出力は HTML タグ（h2, h3, p, ul, ol, strong, em）を使用すること

記事本文を出力してください。`;
}

// ─── 統合プロンプト生成関数 ───────────────────────────────────────────────────

export function buildWritingPrompt(input: Stage2Input): { system: string; user: string } {
  return {
    system: buildWritingSystemPrompt(input),
    user: buildWritingUserPrompt(input),
  };
}
