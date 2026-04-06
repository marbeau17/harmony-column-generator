// ============================================================================
// src/lib/planner/plan-generator.ts
// AIプラン生成のコアロジック
// スピリチュアルコラム向け — キーワードから最適なコンテンツプランを自動生成
// ============================================================================

import { generateJson } from '@/lib/ai/gemini-client';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { researchKeywords } from './keyword-researcher';
import type { KeywordSuggestion } from './keyword-researcher';

// ─── 型定義 ────────────────────────────────────────────────────────────────

export interface ContentPlan {
  theme: string;
  persona: string;
  keyword: string;
  subKeywords: string[];
  perspectiveType: string;
  sourceArticleIds: string[];
  sourceArticleTitles: string[];
  targetWordCount: number;
  predictedSeoScore: number;
  proposalReason: string;
}

// ─── 定数定義 ──────────────────────────────────────────────────────────────

const CTA_URL = 'https://harmony-booking.web.app/';

const THEME_DEFINITIONS: Record<string, string> = {
  soul_mission:
    '魂の使命・ライフパーパス — 魂の目的、天命、光の使者、宇宙的使命、生まれてきた意味の探求',
  relationships:
    '人間関係・恋愛・ソウルメイト — ツインレイ、パートナーシップ、親子関係、職場の人間関係、共依存、境界線',
  grief_care:
    'グリーフケア・喪失と癒し — 死別、ペットロス、看取り、悲嘆のプロセス、亡き人とのスピリチュアルなつながり',
  self_growth:
    '自己成長・変容 — 自己実現、マインドセット、ステージアップ、内面の変化、チャレンジ、目標設定',
  healing:
    'ヒーリング・エネルギーワーク — チャクラ、オーラ、レイキ、瞑想、浄化、エネルギー調整、セルフケア',
  daily_awareness:
    '日常のスピリチュアル実践 — 朝のルーティン、季節の過ごし方、マインドフルネス、感謝の習慣、波動を上げる生活',
  spiritual_intro:
    'スピリチュアル入門 — スピリチュアルとは何か、初心者向けガイド、よくある誤解、カウンセリングの選び方',
};

const PERSONA_DEFINITIONS: Record<string, string> = {
  spiritual_beginner:
    'スピリチュアル初心者 — スピリチュアルに興味を持ち始めた人。専門用語がわからず、基礎から優しく教えてほしい。20〜40代女性が中心',
  self_growth_seeker:
    '自己成長を求める人 — 自分を変えたい、もっと成長したいと感じている。自己啓発書も読むが、スピリチュアルな視点にも関心がある',
  grief_sufferer:
    '喪失・悲嘆を抱える人 — 大切な人やペットを亡くし、悲しみの中にいる。スピリチュアルな視点で癒しや意味を見出したい',
  meditation_practitioner:
    '瞑想・マインドフルネス実践者 — 瞑想やヨガを日常に取り入れている。より深い気づきやスピリチュアルな体験を求めている',
  energy_worker:
    'エネルギーワーク経験者 — レイキやチャクラワークなどを学んだことがある。実践的なテクニックや深い知識を求めている',
  life_purpose_seeker:
    '人生の目的を探す人 — 「自分は何のために生まれてきたのか」という問いを抱えている。魂の使命、天職、ライフパーパスに関心がある',
  holistic_health_seeker:
    'ホリスティックヘルスを求める人 — 心身の健康をトータルで考えたい。西洋医学だけでなくエネルギー的な視点も取り入れたい',
};

const PERSPECTIVE_DEFINITIONS: Record<string, string> = {
  experience_to_lesson:
    '体験談 → 教訓 — 個人的な体験談から読者が学べる教訓・気づきを抽出し、読者目線のコラムとして再構成する',
  personal_to_universal:
    '個人 → 普遍 — 個人的な視点を「誰もが経験しうること」として位置づけ、広いターゲットに届くように拡張する',
  concept_to_practice:
    '概念 → 実践 — 抽象的なスピリチュアル概念を「今日から実践できる具体的なアクション」に変換する',
  case_to_work:
    '事例 → ワーク — カウンセリング事例から効果的なアプローチを抽出し、読者が自分で取り組めるセルフワークに変換する',
  past_to_modern:
    '過去 → 現代 — 古い知恵や伝統的な考え方を現代のコンテキスト（SNS・リモートワーク等）で解釈し直す',
  deep_to_intro:
    '深掘り → 入門 — 専門的・深い内容を初心者でも理解できる入門コラムとして再構成する',
};

// ─── 元記事選択 ────────────────────────────────────────────────────────────

/**
 * source_articlesから未使用かつテーマ一致の元記事を選択する。
 * キーワード関連性でソートし、最大limit件返す。
 */
export async function selectSourceArticles(
  theme: string,
  keyword: string,
  limit: number = 3,
): Promise<{ id: string; title: string }[]> {
  const supabase = await createServiceRoleClient();

  // テーマ一致の記事を取得（未使用優先、使用回数が少ない順）
  let query = supabase
    .from('source_articles')
    .select('id, title, content, themes, keywords, is_processed')
    .order('is_processed', { ascending: true })   // 未使用を優先
    .limit(50);

  // テーマでフィルタ（themesカラムにテーマを含む、またはタイトル/本文にテーマ関連語を含む）
  const themeLabel = THEME_DEFINITIONS[theme]?.split('—')[0]?.trim() ?? theme;
  query = query.or(
    `title.ilike.%${themeLabel}%,content.ilike.%${themeLabel}%`,
  );

  const { data, error } = await query;

  if (error) {
    console.error('[plan-generator.selectSourceArticles] query failed:', error.message);
    return [];
  }

  if (!data || data.length === 0) {
    // テーマフィルタで見つからなかった場合、使用回数が少ない記事から取得
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('source_articles')
      .select('id, title')
      .order('is_processed', { ascending: true })
      .limit(limit);

    if (fallbackError || !fallbackData) {
      console.warn('[plan-generator.selectSourceArticles] fallback failed:', fallbackError?.message);
      return [];
    }

    return fallbackData.map((row) => ({ id: row.id, title: row.title }));
  }

  // キーワード関連性でスコアリング
  const keywordParts = keyword.split(/[\s　]+/).filter(Boolean);

  const scored = data.map((row) => {
    let score = 0;
    const titleAndContent = `${row.title ?? ''} ${(row.content ?? '').substring(0, 1000)}`;

    // キーワードの各パーツがタイトル/本文に含まれるか
    for (const part of keywordParts) {
      if (titleAndContent.includes(part)) {
        score += 3;
      }
    }

    // テーマカテゴリがthemesに含まれるか
    if (Array.isArray(row.themes) && row.themes.includes(theme)) {
      score += 5;
    }

    // keywordsにメインキーワードが含まれるか
    if (Array.isArray(row.keywords)) {
      for (const kw of row.keywords) {
        for (const part of keywordParts) {
          if (kw.includes(part)) {
            score += 2;
          }
        }
      }
    }

    return { id: row.id, title: row.title, score };
  });

  // スコア順でソートして上位を返す
  scored.sort((a, b) => b.score - a.score);

  const selected = scored.slice(0, limit).map((row) => ({
    id: row.id,
    title: row.title,
  }));

  // 選択した元記事を is_processed = true に設定（再利用を防止）
  for (const s of selected) {
    const { error: updateError } = await supabase
      .from('source_articles')
      .update({ is_processed: true })
      .eq('id', s.id);

    if (updateError) {
      console.warn('[plan-generator] is_processed update failed for', s.id, updateError.message);
    }
  }

  return selected;
}

// ─── SEOスコア予測 ─────────────────────────────────────────────────────────

/**
 * コンテンツプランからSEOスコアを概算予測する（0〜100）。
 * 実際の記事生成前の見積もりなので、タイトル長・構成の妥当性等から概算する。
 */
export function predictSeoScore(plan: {
  keyword: string;
  subKeywords: string[];
  targetWordCount: number;
  perspectiveType: string;
  sourceArticleCount: number;
}): number {
  let score = 50; // ベーススコア

  // タイトル長（キーワード自体の長さから推定）
  const keywordLen = plan.keyword.length;
  if (keywordLen >= 5 && keywordLen <= 20) {
    score += 10; // タイトルに収まりやすい長さ
  } else if (keywordLen >= 3 && keywordLen <= 25) {
    score += 5;
  }

  // サブキーワードの充実度（H2にサブキーワードを含める前提）
  if (plan.subKeywords.length >= 3) {
    score += 10;
  } else if (plan.subKeywords.length >= 1) {
    score += 5;
  }

  // 目標文字数（2000文字前後が最適）
  if (plan.targetWordCount >= 1800 && plan.targetWordCount <= 2500) {
    score += 10;
  } else if (plan.targetWordCount >= 1500 && plan.targetWordCount <= 3000) {
    score += 5;
  }

  // 視点変換タイプが設定されている（構成の多様性）
  if (plan.perspectiveType) {
    score += 5;
  }

  // 元記事がある（オリジナリティの素材がある）
  if (plan.sourceArticleCount >= 1) {
    score += 5;
  }
  if (plan.sourceArticleCount >= 2) {
    score += 5;
  }

  // FAQ想定（2-3個のFAQを含む前提で加点）
  score += 5;

  return Math.min(100, Math.max(0, score));
}

// ─── メイン関数 ────────────────────────────────────────────────────────────

/**
 * AIコンテンツプランを生成する。
 *
 * Step1: researchKeywords() でキーワード取得
 * Step2: Gemini API で各キーワードに最適なプラン（テーマ、ペルソナ、視点変換タイプ）を提案
 * Step3: 各プランに最適な元記事を自動選択
 * Step4: SEOスコアを予測
 *
 * @param count - 生成するプラン数（デフォルト: 5）
 * @returns コンテンツプランの配列
 */
export async function generateContentPlans(
  count: number = 5,
): Promise<ContentPlan[]> {
  console.info('[plan-generator.generateContentPlans] start', { count });

  // ── Step1: キーワードリサーチ ──
  const keywordCount = Math.max(count * 2, 10); // 余裕を持って多めに取得
  const keywords = await researchKeywords({ count: keywordCount });

  if (keywords.length === 0) {
    console.warn('[plan-generator.generateContentPlans] no keywords found');
    return [];
  }

  console.info('[plan-generator.generateContentPlans] keywords obtained', {
    count: keywords.length,
  });

  // 必要数に絞る（多めに取得した中から上位を使用）
  const targetKeywords = keywords.slice(0, Math.max(count + 2, 7));

  // ── Step2: Gemini APIでプラン提案 ──
  const plans = await generatePlansFromKeywords(targetKeywords);

  if (plans.length === 0) {
    console.warn('[plan-generator.generateContentPlans] no plans generated');
    return [];
  }

  // ── Step3: 各プランに元記事を自動選択 ──
  const plansWithSources = await Promise.all(
    plans.map(async (plan) => {
      const sources = await selectSourceArticles(plan.theme, plan.keyword, 3);
      return {
        ...plan,
        sourceArticleIds: sources.map((s) => s.id),
        sourceArticleTitles: sources.map((s) => s.title),
      };
    }),
  );

  // ── Step4: SEOスコア予測 ──
  const plansWithScores = plansWithSources.map((plan) => ({
    ...plan,
    predictedSeoScore: predictSeoScore({
      keyword: plan.keyword,
      subKeywords: plan.subKeywords,
      targetWordCount: plan.targetWordCount,
      perspectiveType: plan.perspectiveType,
      sourceArticleCount: plan.sourceArticleIds.length,
    }),
  }));

  // スコア順でソートして必要数に絞る
  plansWithScores.sort((a, b) => b.predictedSeoScore - a.predictedSeoScore);
  const result = plansWithScores.slice(0, count);

  console.info('[plan-generator.generateContentPlans] done', {
    totalPlans: result.length,
    avgScore: Math.round(
      result.reduce((sum, p) => sum + p.predictedSeoScore, 0) / result.length,
    ),
  });

  return result;
}

// ─── Step2: キーワードからプラン生成 ───────────────────────────────────────

/**
 * キーワード一覧からGemini APIで最適なコンテンツプランを提案させる
 */
export async function generatePlansFromKeywords(
  keywords: KeywordSuggestion[],
): Promise<Omit<ContentPlan, 'sourceArticleIds' | 'sourceArticleTitles' | 'predictedSeoScore'>[]> {
  const themeDefinitionsText = Object.entries(THEME_DEFINITIONS)
    .map(([key, desc]) => `  - ${key}: ${desc}`)
    .join('\n');

  const personaDefinitionsText = Object.entries(PERSONA_DEFINITIONS)
    .map(([key, desc]) => `  - ${key}: ${desc}`)
    .join('\n');

  const perspectiveDefinitionsText = Object.entries(PERSPECTIVE_DEFINITIONS)
    .map(([key, desc]) => `  - ${key}: ${desc}`)
    .join('\n');

  const keywordsText = keywords
    .map((k, i) => `  ${i + 1}. "${k.keyword}" (テーマ: ${k.theme}, 検索意図: ${k.searchIntent})`)
    .join('\n');

  // ── システムプロンプト ──
  const systemPrompt = `あなたはスピリチュアル系SEOコンテンツのプランニング専門家です。

## あなたの役割
- 与えられたキーワードに対して、最適なコンテンツプラン（テーマ、ペルソナ、視点変換タイプ、サブキーワード等）を設計する
- SEO100点を目指す記事が書けるプランを提案する
- 読者の検索意図を満たしつつ、CTA（${CTA_URL}）への自然な導線を設計する

## 7テーマの定義
${themeDefinitionsText}

## 7ペルソナの定義
${personaDefinitionsText}

## 6視点変換タイプの説明
${perspectiveDefinitionsText}

## SEO100点の条件
- タイトル: 28〜35文字、メインキーワードを自然に含む
- メタディスクリプション: 80〜120文字、検索意図に応える要約
- H2見出し: 3〜4個、サブキーワードを含む
- H3見出し: 各H2の下に1〜3個
- FAQ: 2〜3個（構造化データ対応）
- 目標文字数: 1800〜2500文字（読了時間4〜6分）
- 内部リンク: 関連記事への導線
- CTA: 3箇所（導入直後、本文中盤、まとめ直前）
- CTA先: ${CTA_URL}

## 出力ルール
1. レスポンスは **JSON のみ** で返してください
2. 各プランにはそのキーワードに最適なテーマ・ペルソナ・視点変換タイプを選択
3. subKeywordsはH2見出しに使えるサブキーワードを3〜5個提案
4. targetWordCountは1800〜2500の範囲で最適な値を提案
5. proposalReasonはそのプランを推奨する理由を50〜100文字で記載

## 出力JSONスキーマ
\`\`\`json
{
  "plans": [
    {
      "keyword": "元のキーワード",
      "theme": "7テーマのいずれかの英語キー名",
      "persona": "7ペルソナのいずれかの英語キー名",
      "subKeywords": ["サブKW1", "サブKW2", "サブKW3"],
      "perspectiveType": "6視点変換タイプのいずれかの英語キー名",
      "targetWordCount": 2000,
      "proposalReason": "このキーワードを推奨する理由"
    }
  ]
}
\`\`\``;

  // ── ユーザープロンプト ──
  const userPrompt = `以下のキーワードリストに対して、それぞれ最適なコンテンツプランを設計してください。

## キーワードリスト
${keywordsText}

## プラン設計のポイント
- 各キーワードの検索意図に最もマッチするテーマ・ペルソナ・視点変換タイプを選ぶ
- サブキーワードはH2見出しに自然に組み込める関連語にする
- 視点変換タイプは元記事の内容に応じて最適なものを選ぶ（元記事がない場合も想定して選択）
- 同じテーマ・ペルソナ・視点変換タイプに偏らないようバランスを取る
- proposalReasonは「なぜこのキーワード×テーマ×ペルソナの組み合わせが効果的か」を簡潔に

全キーワードに対するプランをJSON形式で出力してください。`;

  console.info('[plan-generator.generatePlansFromKeywords] calling Gemini', {
    keywordCount: keywords.length,
  });

  const { data } = await generateJson<{
    plans: {
      keyword: string;
      theme: string;
      persona: string;
      subKeywords: string[];
      perspectiveType: string;
      targetWordCount: number;
      proposalReason: string;
    }[];
  }>(systemPrompt, userPrompt, {
    temperature: 0.8,
    maxOutputTokens: 8192,
  });

  const rawPlans = data.plans ?? [];

  // バリデーション：必須フィールドの存在チェック
  const validPlans = rawPlans
    .filter((p) => p.keyword && p.theme && p.persona && p.perspectiveType)
    .map((p) => ({
      keyword: p.keyword,
      theme: p.theme,
      persona: p.persona,
      subKeywords: Array.isArray(p.subKeywords) ? p.subKeywords : [],
      perspectiveType: p.perspectiveType,
      targetWordCount: p.targetWordCount ?? 2000,
      proposalReason: p.proposalReason ?? '',
    }));

  console.info('[plan-generator.generatePlansFromKeywords] done', {
    rawCount: rawPlans.length,
    validCount: validPlans.length,
  });

  return validPlans;
}
