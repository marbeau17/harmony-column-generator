// ============================================================================
// src/lib/planner/keyword-researcher.ts
// Gemini APIを使ったキーワードリサーチ
// スピリチュアルコラム向け — 検索ボリュームが見込めるキーワードをAIが提案
// ============================================================================

import { generateJson } from '@/lib/ai/gemini-client';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { THEME_CATEGORIES } from '@/types/article';

// ─── 型定義 ────────────────────────────────────────────────────────────────

export interface KeywordSuggestion {
  keyword: string;
  theme: string;
  searchIntent: string;
  difficulty: 'low' | 'medium' | 'high';
  reasoning: string;
}

// ─── テーマ定義 ────────────────────────────────────────────────────────────

const THEME_DEFINITIONS: Record<string, string> = {
  soul_mission:
    '魂の使命・ライフパーパス — 魂の目的、天命、光の使者、生まれてきた意味、宇宙的な使命',
  relationships:
    '人間関係・恋愛・ソウルメイト — ツインレイ、パートナーシップ、親子関係、職場の人間関係、共依存、境界線',
  grief_care:
    'グリーフケア・喪失と癒し — 死別、ペットロス、看取り、悲嘆のプロセス、亡き人とのつながり',
  self_growth:
    '自己成長・変容 — 自己実現、マインドセット、ステージアップ、内面の変化、チャレンジ、目標設定',
  healing:
    'ヒーリング・エネルギーワーク — チャクラ、オーラ、レイキ、瞑想、浄化、エネルギー調整、セルフケア',
  daily_awareness:
    '日常のスピリチュアル実践 — 朝のルーティン、季節の過ごし方、マインドフルネス、感謝の習慣、波動を上げる生活',
  spiritual_intro:
    'スピリチュアル入門 — スピリチュアルとは何か、初心者向けガイド、よくある誤解、カウンセリングの選び方',
};

// ─── 既存キーワード取得 ────────────────────────────────────────────────────

/**
 * articlesテーブルから使用済みキーワードを取得する
 */
async function getUsedKeywords(): Promise<string[]> {
  const supabase = await createServiceRoleClient();

  const { data, error } = await supabase
    .from('articles')
    .select('keyword')
    .not('keyword', 'is', null);

  if (error) {
    console.error('[keyword-researcher.getUsedKeywords] failed:', error.message);
    return [];
  }

  return (data ?? [])
    .map((row: { keyword: string | null }) => row.keyword)
    .filter((k): k is string => k !== null && k !== '');
}

/**
 * テーマごとの既存記事数を取得する
 */
async function getThemeArticleCounts(): Promise<Record<string, number>> {
  const supabase = await createServiceRoleClient();

  const counts: Record<string, number> = {};

  for (const theme of THEME_CATEGORIES) {
    const { count, error } = await supabase
      .from('articles')
      .select('id', { count: 'exact', head: true })
      .eq('theme', theme);

    if (error) {
      console.error(`[keyword-researcher.getThemeArticleCounts] ${theme}:`, error.message);
      counts[theme] = 0;
    } else {
      counts[theme] = count ?? 0;
    }
  }

  return counts;
}

// ─── メイン関数 ────────────────────────────────────────────────────────────

/**
 * Gemini APIを使ってスピリチュアル系のキーワードを提案する。
 * 既に使用済みのキーワードは除外される。
 *
 * @param options.theme - 特定テーマに絞りたい場合
 * @param options.count - 取得するキーワード数（デフォルト: 15）
 * @returns キーワード提案の配列
 */
export async function researchKeywords(
  options?: { theme?: string; count?: number },
): Promise<KeywordSuggestion[]> {
  const targetCount = options?.count ?? 15;
  const targetTheme = options?.theme;

  // 既存キーワードとテーマ別記事数を並行取得
  const [usedKeywords, themeCounts] = await Promise.all([
    getUsedKeywords(),
    getThemeArticleCounts(),
  ]);

  const themeCountsText = Object.entries(themeCounts)
    .map(([theme, count]) => `  - ${theme} (${THEME_DEFINITIONS[theme] ?? theme}): ${count}記事`)
    .join('\n');

  const usedKeywordsText =
    usedKeywords.length > 0
      ? usedKeywords.join('、')
      : 'なし（まだ記事が存在しません）';

  const themeFilter = targetTheme
    ? `\n\n## 指定テーマ\n「${targetTheme}」に関連するキーワードのみ提案してください。`
    : '';

  // ── システムプロンプト ──
  const systemPrompt = `あなたはスピリチュアル系SEOコンテンツのキーワードリサーチ専門家です。

## あなたの役割
- スピリチュアル・ヒーリング・自己成長分野で、検索ボリュームが見込めるキーワードを提案する
- 読者の検索意図を深く理解し、コンテンツ化した際にアクセスを集められるキーワードを選定する
- 競合が少なく、上位表示しやすいロングテールキーワードを重視する

## 7つのテーマカテゴリ
${themeCountsText}

## 出力ルール
1. レスポンスは **JSON のみ** で返してください
2. 各キーワードに theme, searchIntent, difficulty, reasoning を付与
3. keywordは日本語で、実際にユーザーが検索しそうな自然な言い回し
4. themeは上記7テーマのいずれかの英語キー名を使用
5. searchIntentは「知りたい」「やり方を学びたい」「悩みを解決したい」等、ユーザーの検索意図を記載
6. difficultyは競合の強さに基づく概算（low / medium / high）
7. reasoningはそのキーワードを推奨する理由を30〜60文字で記載
8. 記事数が少ないテーマを優先的に提案（コンテンツの偏りを防ぐ）

## 出力JSONスキーマ
\`\`\`json
{
  "keywords": [
    {
      "keyword": "チャクラ 開き方 初心者",
      "theme": "healing",
      "searchIntent": "チャクラの開き方を初心者向けに知りたい",
      "difficulty": "low",
      "reasoning": "初心者向けのロングテールで競合が少なく上位表示しやすい"
    }
  ]
}
\`\`\``;

  // ── ユーザープロンプト ──
  const userPrompt = `スピリチュアル系ブログで検索流入を狙えるキーワードを **${targetCount}〜${targetCount + 5}個** 提案してください。

## 現在の記事数（テーマ別）
${themeCountsText}

## 既に使用済みのキーワード（これらは除外してください）
${usedKeywordsText}

## キーワード選定のポイント
- 月間検索ボリュームが100〜1,000程度のロングテールを狙う
- 「○○ やり方」「○○ 意味」「○○ 効果」「○○ 初心者」などのパターンを活用
- 悩み系キーワード（「○○ つらい」「○○ わからない」）も含める
- 季節やトレンドに左右されにくい普遍的なキーワードを優先
- 記事数が少ないテーマのキーワードを多めに提案する
- 使用済みキーワードと重複しないこと（類似表現もできるだけ避ける）
${themeFilter}

上記を踏まえて、キーワード提案をJSON形式で出力してください。`;

  console.info('[keyword-researcher.researchKeywords] start', {
    targetCount,
    targetTheme: targetTheme ?? 'all',
    usedKeywordsCount: usedKeywords.length,
  });

  const { data } = await generateJson<{ keywords: KeywordSuggestion[] }>(
    systemPrompt,
    userPrompt,
    {
      temperature: 0.9,
      maxOutputTokens: 8192,
    },
  );

  // キーワードの配列を取得
  const suggestions = data.keywords ?? [];

  // 使用済みキーワードを再度フィルタリング（AIが見落とす可能性があるため）
  // 個別語の70%以上が重複する場合もフィルタ（「セルフレイキ やり方 初心者」と「セルフレイキ やり方」の重複を検出）
  const filtered = suggestions.filter((s) => {
    const newWords = new Set(s.keyword.split(/[\s　]+/).filter(Boolean));
    return !usedKeywords.some((used) => {
      // 完全一致
      if (used === s.keyword) return true;
      // 包含チェック
      if (used.includes(s.keyword) || s.keyword.includes(used)) return true;
      // 個別語の重複率チェック
      const usedWords = new Set(used.split(/[\s　]+/).filter(Boolean));
      const overlap = [...newWords].filter(w => usedWords.has(w)).length;
      const overlapRatio = overlap / Math.min(newWords.size, usedWords.size);
      return overlapRatio >= 0.7; // 70%以上の語が重複したら除外
    });
  });

  console.info('[keyword-researcher.researchKeywords] done', {
    rawCount: suggestions.length,
    filteredCount: filtered.length,
  });

  return filtered;
}
