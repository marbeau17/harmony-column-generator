// ============================================================================
// src/lib/ai/prompts/stage2-fidelity-check.ts
// 原文踏襲チェック — ソース記事との整合性・方向性の検証
//
// 2つの専門家視点でチェック:
//   1. スピリチュアルカウンセラー: 霊的真正性、元記事の精神的エッセンスの保持
//   2. 心理学者: 心理的安全性、読者への影響、誤解を招く表現の排除
// ============================================================================

export interface FidelityCheckResult {
  isAligned: boolean;           // 元記事の真意を踏襲しているか
  overallScore: number;         // 0-100
  spiritualReview: {
    score: number;              // 0-100
    maintained: string[];       // 保持されている要素
    lost: string[];            // 失われた要素
    contradictions: string[];   // 矛盾点
    suggestions: string[];      // 改善提案
  };
  psychologicalReview: {
    score: number;              // 0-100
    safetyIssues: string[];    // 心理的安全性の問題
    misrepresentations: string[]; // 誤解を招く表現
    positiveAspects: string[];  // 良い点
    suggestions: string[];      // 改善提案
  };
  correctedText?: string;       // 修正が必要な場合の修正テキスト
}

export function buildFidelityCheckSystemPrompt(): string {
  return `あなたは2つの専門家の視点を持つコンテンツ品質審査官です。

## 役割1: スピリチュアルカウンセラー（小林由起子）の視点
- 20年以上のスピリチュアルカウンセリング経験に基づく判断
- 元記事（アメブロ）の「魂のメッセージ」「愛と感謝」の精神が保持されているか
- スピリチュアルな概念が正しく、読者に寄り添う形で表現されているか
- 元記事の核心的なテーマや体験談のエッセンスが失われていないか

## 役割2: 心理学者の視点
- 読者の心理的安全性が確保されているか
- スピリチュアルな内容が否定的・批判的に表現されていないか
- 読者が不安や恐怖を感じる表現がないか
- 依存を促進する表現ではなく、自律を支援する表現になっているか
- 元記事の意図と逆の印象を与えていないか（例: 癒しの記事が不安を煽る内容に変わっていないか）

## 重要なチェックポイント
1. 元記事の「真意」が新しい記事でも保持されているか
2. 視点変換によって元記事の主張が歪められていないか
3. スピリチュアルを否定・批判する内容になっていないか（最重要）
4. 読者が記事を読んだ後にポジティブな気持ちになれるか
5. 元記事のキーフレーズや重要な概念が適切に活かされているか
6. カウンセリングや相談への誘導が自然で押し付けがましくないか

## 出力形式
JSON形式で出力してください。`;
}

export function buildFidelityCheckUserPrompt(
  generatedHtml: string,
  sourceContent: string,
  keyword: string,
  perspectiveType: string,
): string {
  return `以下の元記事と生成された新記事を比較し、フィデリティ（原文踏襲度）をチェックしてください。

## 視点変換タイプ
${perspectiveType}

## ターゲットキーワード
${keyword}

## 元記事（アメブロ原文）
${sourceContent.substring(0, 3000)}

## 生成された新記事（HTML）
${generatedHtml.substring(0, 5000)}

## チェック項目

### スピリチュアルカウンセラーとして
1. 元記事の核心的メッセージ（愛、感謝、魂の成長など）は保持されているか？
2. 元記事の体験談やエピソードのエッセンスが活かされているか？
3. スピリチュアルな概念が正確で、読者に寄り添う表現か？
4. 元記事が「癒し」を意図しているなら、新記事も「癒し」の方向性か？

### 心理学者として
1. 読者の心理的安全性は確保されているか？
2. 元記事の意図と逆の印象（不安、恐怖、否定）を与えていないか？
3. スピリチュアルを否定・批判する表現はないか？
4. 依存ではなく自律を支援する表現か？

## 出力JSON
{
  "isAligned": true/false,
  "overallScore": 0-100,
  "spiritualReview": {
    "score": 0-100,
    "maintained": ["保持されている要素1", ...],
    "lost": ["失われた要素1", ...],
    "contradictions": ["矛盾点1", ...],
    "suggestions": ["提案1", ...]
  },
  "psychologicalReview": {
    "score": 0-100,
    "safetyIssues": ["問題1", ...],
    "misrepresentations": ["誤表現1", ...],
    "positiveAspects": ["良い点1", ...],
    "suggestions": ["提案1", ...]
  }
}

isAligned=falseの場合、correctedTextフィールドに修正後の本文HTML全体を含めてください。`;
}
