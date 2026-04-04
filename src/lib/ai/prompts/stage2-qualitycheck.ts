// ============================================================================
// src/lib/ai/prompts/stage2-qualitycheck.ts
// ステージ2 サブステップC: 品質チェックプロンプト
// スピリチュアルコラム向け — 医療境界・宗教偏り・不安煽り・E-E-A-T確認
// apolloONEBlog の factcheck に相当
// ============================================================================

import type { FactcheckIssue } from '@/types/ai';

// ─── システムプロンプト ─────────────────────────────────────────────────────

export function buildQualityCheckSystemPrompt(): string {
  return `あなたはスピリチュアルコンテンツの品質管理の専門家です。

## あなたの最重要ミッション
記事が読者にとって安全で、信頼性が高く、倫理的に問題のないコンテンツであることを保証することが最優先です。

## 品質チェック項目（すべて必ず検証）

### 1. 医療アドバイス境界確認
- 「○○が治る」「○○に効果がある」等の医療効果を断定する表現がないか
- 「薬の代わりに○○」「病院に行かなくても○○」等の医療行為を代替する示唆がないか
- 心身の不調に対して「スピリチュアルな原因がある」と断定していないか
- 適切な免責表現（「医療的なお悩みは専門家にご相談ください」等）が含まれているか
- 判定: [safe] 問題なし / [warning] 表現の修正推奨 / [critical] 即修正必須

### 2. 宗教的偏り確認
- 特定の宗教・宗派を「正しい」「唯一の道」と断定していないか
- 他の信仰体系を否定・軽視する表現がないか
- 「○○を信じないと不幸になる」等の脅迫的表現がないか
- スピリチュアリティを特定宗教と混同していないか
- 判定: [safe] / [warning] / [critical]

### 3. 不安煽り表現検出
- 「このままでは大変なことに」「あなたは危険な状態」等の過度な不安喚起がないか
- 「今すぐ○○しないと」等の緊急性を不当に煽る表現がないか
- 「前世のカルマで苦しんでいる」等、読者に罪悪感を与える表現がないか
- ネガティブな状態の描写が解決策・希望のメッセージとバランスが取れているか
- 判定: [safe] / [warning] / [critical]

### 4. 差別的表現検出
- 性別、年齢、障がい、国籍、性的指向に関する差別的表現がないか
- 「スピリチュアルに目覚めていない人は○○」等のスピリチュアル的優越感の表現がないか
- 特定の属性の人を排除・否定する表現がないか
- 判定: [safe] / [warning] / [critical]

### 5. E-E-A-T シグナル確認
- Experience（体験）: 実体験に基づく語りや具体的なエピソードが含まれているか
- Expertise（専門性）: スピリチュアル分野の正確な知識が反映されているか
- Authoritativeness（権威性）: 小林由起子の専門性が読者に伝わる表現があるか
- Trustworthiness（信頼性）: 免責事項、出典への言及、誠実なトーンが保たれているか
- 判定: [strong] 十分 / [adequate] 最低限 / [weak] 改善必要

### 6. CTA文言適切性
- CTAのキャッチコピーが不安を煽っていないか（「このままでは...」等はNG）
- CTAが記事内容と自然につながっているか
- 押し売り感のない、温かく寄り添うトーンになっているか
- CTA先URL（https://harmony-booking.web.app/）が正しいか
- 3箇所のCTAが適切に配置されているか
- 判定: [appropriate] 適切 / [needs_adjustment] 調整推奨

## 出力フォーマット（必ずこの形式で出力）

\`\`\`
===QUALITY_ISSUES_START===
1. [カテゴリ] [判定] "検証した記述または該当箇所" | 備考: 詳細説明と推奨修正案
2. [カテゴリ] [判定] "検証した記述または該当箇所" | 備考: ...
===QUALITY_ISSUES_END===

===FINAL_TEXT_START===
（品質チェック済みの記事全文をここに出力。critical判定の箇所は修正済みにする）
===FINAL_TEXT_END===
\`\`\`

カテゴリは以下のいずれか:
- medical_boundary（医療境界）
- religious_bias（宗教偏り）
- fear_mongering（不安煽り）
- discrimination（差別表現）
- eeat（E-E-A-T）
- cta_quality（CTA適切性）

問題がない場合も、各カテゴリについて [safe] 判定の確認結果を記載すること。`;
}

// ─── ユーザープロンプト ─────────────────────────────────────────────────────

export function buildQualityCheckUserPrompt(
  proofreadHtml: string,
  theme: string,
  keyword: string
): string {
  return `以下の校閲済みスピリチュアルコラム記事を品質チェックしてください。

## 品質チェック対象の記事

${proofreadHtml}

## 記事コンテキスト
- **テーマ**: ${theme}
- **メインキーワード**: ${keyword}

## 特に注意すべき点
- 「${theme}」に関連する表現で、医療効果の断定がないか重点的に確認
- 読者の不安を煽らず、希望と安心を届けるトーンになっているか確認
- CTA（<div class="harmony-cta">）が3箇所あり、文言が適切か確認
- 画像プレースホルダー（<!--IMAGE:...-->）が3箇所（hero/body/summary）あるか確認

## 注意事項
- HTMLタグ構造は変更しない
- <!--IMAGE:...--> の画像プレースホルダーコメントは絶対に削除しない
- <div class="harmony-cta">〜</div> のCTAブロックは絶対に削除しない
- <div class="harmony-faq">〜</div> のFAQブロックは絶対に削除しない
- [critical] 判定の箇所のみ修正を行い、それ以外は元のテキストを保持する
- 修正した箇所は自然な文章として読めるようにする

指定のフォーマットで出力してください。`;
}

// ─── 統合プロンプト生成関数 ───────────────────────────────────────────────────

export function buildQualityCheckPrompt(input: {
  bodyHtml: string;
  theme?: string;
  keyword?: string;
}): { system: string; user: string } {
  return {
    system: buildQualityCheckSystemPrompt(),
    user: buildQualityCheckUserPrompt(
      input.bodyHtml,
      input.theme || 'スピリチュアル全般',
      input.keyword || ''
    ),
  };
}

// ─── 型定義 ───────────────────────────────────────────────────────────────

export type QualityCategory =
  | 'medical_boundary'
  | 'religious_bias'
  | 'fear_mongering'
  | 'discrimination'
  | 'eeat'
  | 'cta_quality';

export type QualityJudgment =
  | 'safe'
  | 'warning'
  | 'critical'
  | 'strong'
  | 'adequate'
  | 'weak'
  | 'appropriate'
  | 'needs_adjustment';

export interface QualityIssue {
  category: QualityCategory;
  judgment: QualityJudgment;
  claim: string;
  note: string;
}

// ─── パーサー ───────────────────────────────────────────────────────────────

/** 品質チェック AI レスポンスをパースする */
export function parseQualityCheckResponse(rawText: string): {
  qualityIssues: QualityIssue[];
  finalText: string;
  /** FactcheckIssue互換のリスト（既存パイプラインとの互換用） */
  factIssues: FactcheckIssue[];
} {
  const qualityIssues: QualityIssue[] = [];
  const factIssues: FactcheckIssue[] = [];
  let finalText = '';

  // Quality Issues 抽出
  const issuesMatch = rawText.match(
    /===QUALITY_ISSUES_START===([\s\S]*?)===QUALITY_ISSUES_END===/
  );
  if (issuesMatch) {
    const lines = issuesMatch[1]
      .trim()
      .split('\n')
      .filter((l) => l.trim());
    for (const line of lines) {
      // パターン: [カテゴリ] [判定] "記述" | 備考: ...
      const match = line.match(
        /\[(\w+)\]\s*\[(\w+)\]\s*"(.+?)"\s*\|\s*備考:\s*(.+)/
      );
      if (match) {
        const category = match[1] as QualityCategory;
        const judgment = match[2] as QualityJudgment;
        const claim = match[3];
        const note = match[4];

        qualityIssues.push({ category, judgment, claim, note });

        // FactcheckIssue互換に変換
        let status: 'verified' | 'needs_review' | 'corrected';
        if (
          judgment === 'safe' ||
          judgment === 'strong' ||
          judgment === 'appropriate'
        ) {
          status = 'verified';
        } else if (judgment === 'critical') {
          status = 'corrected';
        } else {
          status = 'needs_review';
        }

        factIssues.push({
          claim: `[${category}] ${claim}`,
          status,
          note,
          ...(judgment === 'critical' ? { correctedText: note } : {}),
        });
      }
    }
  }

  // 最終テキスト抽出
  const textMatch = rawText.match(
    /===FINAL_TEXT_START===([\s\S]*?)===FINAL_TEXT_END===/
  );
  if (textMatch) {
    finalText = textMatch[1].trim();
  } else {
    // フォーマットに従わなかった場合、全文をそのまま使用
    finalText = rawText
      .replace(
        /===QUALITY_ISSUES_START===[\s\S]*?===QUALITY_ISSUES_END===/,
        ''
      )
      .trim();
  }

  return { qualityIssues, finalText, factIssues };
}
