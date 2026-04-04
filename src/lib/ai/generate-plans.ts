// ============================================================================
// src/lib/ai/generate-plans.ts
// AI によるコンテンツプラン一括生成
// ============================================================================

import { generateJson } from '@/lib/ai/gemini-client';
import { logger } from '@/lib/logger';

export interface GeneratedPlan {
  keyword: string;
  theme: string;
  persona: string;
  perspective_type: string;
  target_word_count: number;
}

interface GeneratePlansResult {
  plans: GeneratedPlan[];
}

function buildSystemPrompt(): string {
  return `あなたはスピリチュアルコラムのコンテンツ戦略プランナーです。

## あなたの役割
SEOに強いスピリチュアルコラム記事のコンテンツプランを複数提案してください。

## 出力ルール
- 各プランには以下を含めること:
  - keyword: 検索ボリュームが期待できるメインキーワード（日本語）
  - theme: テーマカテゴリ（soul_mission, relationships, grief_care, self_growth, healing, daily のいずれか）
  - persona: ターゲット読者像（例: spiritual_beginner, mindfulness_seeker, grief_support 等）
  - perspective_type: 記事の視点タイプ（concept_to_practice, experience_sharing, guide, analysis のいずれか）
  - target_word_count: 推奨文字数（1500〜5000の範囲）
- キーワードは重複しないこと
- 検索意図を意識し、読者の悩みや疑問に応えるキーワードを選ぶこと
- 季節性やトレンドも考慮すること

## 出力 JSON スキーマ
{
  "plans": [
    {
      "keyword": "チャクラ 初心者",
      "theme": "healing",
      "persona": "spiritual_beginner",
      "perspective_type": "guide",
      "target_word_count": 2500
    }
  ]
}`;
}

function buildUserPrompt(count: number): string {
  return `スピリチュアルコラムのコンテンツプランを ${count} 件提案してください。

それぞれ異なるテーマ・キーワードで、SEO効果が高く、読者の悩みに寄り添った記事プランをJSON形式で出力してください。`;
}

/**
 * AI を使ってコンテンツプランを一括生成する。
 */
export async function generateContentPlans(
  count: number,
): Promise<GeneratedPlan[]> {
  logger.info('ai', 'generateContentPlans.start', { count });

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(count);

  const { data } = await generateJson<GeneratePlansResult>(
    systemPrompt,
    userPrompt,
    {
      temperature: 0.9,
      maxOutputTokens: 8192,
      timeoutMs: 60_000,
    },
  );

  if (!data.plans || !Array.isArray(data.plans)) {
    throw new Error('AIがプランを返しませんでした。再試行してください。');
  }

  // バリデーション: 必須フィールドの存在チェック
  const validPlans = data.plans.filter(
    (p) => p.keyword && p.theme && p.persona && p.perspective_type,
  );

  if (validPlans.length === 0) {
    throw new Error('AIが有効なプランを返しませんでした。再試行してください。');
  }

  logger.info('ai', 'generateContentPlans.complete', {
    requested: count,
    generated: validPlans.length,
  });

  return validPlans.map((p) => ({
    keyword: p.keyword,
    theme: p.theme,
    persona: p.persona,
    perspective_type: p.perspective_type,
    target_word_count: p.target_word_count || 2000,
  }));
}
