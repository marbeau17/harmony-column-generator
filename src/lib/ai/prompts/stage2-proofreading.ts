// ============================================================================
// src/lib/ai/prompts/stage2-proofreading.ts
// ステージ2 サブステップB: 自己校閲プロンプト
// スピリチュアルコラム向け — 文体・用語・構造の校正
// ============================================================================

import type { ProofreadCorrection } from '@/types/ai';

// ─── システムプロンプト ─────────────────────────────────────────────────────

export function buildProofreadingSystemPrompt(): string {
  return `あなたはプロの日本語校閲者です。スピリチュアル・ヒーリング分野のコンテンツに精通しています。

## あなたの役割
以下のスピリチュアルコラム記事を厳密に校閲し、品質を向上させてください。

## 校閲チェック項目（すべて必ず確認）

### 1. 誤字脱字
- 漢字の誤変換（例: 瞑想 → 迷走 は文脈次第で誤り）
- 送り仮名の誤り
- カタカナ表記の誤り（例: チャクラ、オーラ、ヒーリング等の正確な表記）
- スピリチュアル固有名詞の表記ミス

### 2. 文法・助詞
- 「は」「が」の使い分け
- 「の」の連続使用（3連続以上は修正）
- 主述の不一致
- 一文が60文字を大幅に超えている場合は分割を提案

### 3. です・ます調の一貫性
- 全文「〜です。〜ます。」の「ですます調」に統一されているか
- 「〜だ。〜である。」が混在していないか
- 体言止めが多用されすぎていないか（適度な使用はOK）

### 4. スピリチュアル用語の正確性
- チャクラ名称（第1〜第7チャクラ、ルートチャクラ〜クラウンチャクラ）の正確性
- エネルギーワーク関連用語（グラウンディング、センタリング、プロテクション等）の正しい使用
- 占術用語（タロット、西洋占星術、数秘術等）の正確な表記
- パワーストーン名称の正確性
- 用語の表記揺れがないか（例: 「オーラ」と「aura」の混在）

### 5. 読みやすさ
- 段落が長すぎないか（1段落3〜5文を推奨）
- 抽象的な概念の後に具体例やたとえ話があるか
- 読者への語りかけ（「〜ではありませんか？」等）が適度に含まれているか
- 難解なスピリチュアル用語に平易な説明が添えられているか

### 6. HTMLタグ整合性
- タグの閉じ忘れがないか
- 見出し階層（H2 → H3）の順序が正しいか
- 使用可能タグ（h2, h3, p, ul, ol, strong, em）以外が使われていないか

### 7. CTA・画像プレースホルダ保持確認
- \`<div class="harmony-cta">...</div>\` のCTAブロックが2箇所存在し、構造が破壊されていないか
- \`<!--IMAGE:body:...-->\`、\`<!--IMAGE:summary:...-->\` の本文中に2箇所（body/summary）のプレースホルダーが存在するか。hero画像はテンプレートが自動挿入
- CTA内のリンク先が \`https://harmony-booking.web.app/\` であるか
- \`<div class="harmony-faq">...</div>\` のFAQブロックが破壊されていないか

### 8. ダブルクォーテーション検出
- 文章中に""（ダブルクォーテーション）が使われている場合、「」（鍵括弧）に置き換える
- ただしHTMLタグ内の属性値は対象外

### 9. 不自然な同義語置換の検出
- 機械的な言い換え（「重要」→「肝要」、「必要」→「必須」のような日常会話では使わない同義語）がないか
- 文脈に合わない硬い言い回しがないか
- 自然に読める流れのある文章になっているか

### 10. 抽象表現への具体例付与
- 抽象的なスピリチュアル表現（「宇宙のエネルギー」「高い波動」等）の直後に具体例がない場合、具体例を追加する
- 「たとえば〜」「〜のように」で読者の日常に接続する

## 出力フォーマット（必ずこの形式で出力）

修正箇所リストと、修正済み全文の **両方** を出力してください。

\`\`\`
===CORRECTIONS_START===
1. 【修正前】誤った表現 → 【修正後】正しい表現 | 理由: 理由の説明
2. 【修正前】... → 【修正後】... | 理由: ...
===CORRECTIONS_END===

===CORRECTED_TEXT_START===
（修正済みの記事全文をここに出力）
===CORRECTED_TEXT_END===
\`\`\`

修正箇所がない場合も、===CORRECTIONS_START=== と ===CORRECTIONS_END=== の間に「修正箇所なし」と記載し、===CORRECTED_TEXT_START=== 以降に元の全文をそのまま出力してください。`;
}

// ─── ユーザープロンプト ─────────────────────────────────────────────────────

export function buildProofreadingUserPrompt(draftHtml: string): string {
  return `以下のスピリチュアルコラム記事を校閲してください。

## 校閲対象の記事本文

${draftHtml}

## 注意事項
- HTMLタグ自体は修正しない（タグの閉じ忘れ以外）
- <!--IMAGE:...--> の画像プレースホルダーコメントは絶対に削除・変更しない
- <div class="harmony-cta">〜</div> のCTAブロックは絶対に削除・変更しない
- <div class="harmony-faq">〜</div> のFAQブロックは絶対に削除・変更しない
- 校閲は「テキスト内容」に集中し、HTML構造は最小限の修正に留める
- スピリチュアル用語の表記揺れは統一方向で修正する
- 医療効果を断定する表現があれば「〜と言われています」等の柔らかい表現に修正する

指定のフォーマットで、修正箇所リストと修正済み全文を出力してください。`;
}

// ─── 統合プロンプト生成関数 ───────────────────────────────────────────────────

export function buildProofreadingPrompt(input: { bodyHtml: string }): {
  system: string;
  user: string;
} {
  return {
    system: buildProofreadingSystemPrompt(),
    user: buildProofreadingUserPrompt(input.bodyHtml),
  };
}

// ─── パーサー ───────────────────────────────────────────────────────────────

/** 校閲 AI レスポンスをパースする */
export function parseProofreadingResponse(rawText: string): {
  corrections: ProofreadCorrection[];
  correctedText: string;
} {
  const corrections: ProofreadCorrection[] = [];
  let correctedText = '';

  // 修正箇所リスト抽出
  const correctionsMatch = rawText.match(
    /===CORRECTIONS_START===([\s\S]*?)===CORRECTIONS_END===/
  );
  if (correctionsMatch) {
    const lines = correctionsMatch[1]
      .trim()
      .split('\n')
      .filter((l) => l.trim());
    for (const line of lines) {
      if (line.includes('修正箇所なし')) continue;
      const match = line.match(
        /【修正前】(.+?)→\s*【修正後】(.+?)\|\s*理由:\s*(.+)/
      );
      if (match) {
        corrections.push({
          before: match[1].trim(),
          after: match[2].trim(),
          reason: match[3].trim(),
        });
      }
    }
  }

  // 修正済み全文抽出
  const textMatch = rawText.match(
    /===CORRECTED_TEXT_START===([\s\S]*?)===CORRECTED_TEXT_END===/
  );
  if (textMatch) {
    correctedText = textMatch[1].trim();
  } else {
    // フォーマットに従わなかった場合、全文をそのまま使用
    correctedText = rawText
      .replace(/===CORRECTIONS_START===[\s\S]*?===CORRECTIONS_END===/, '')
      .trim();
  }

  return { corrections, correctedText };
}
