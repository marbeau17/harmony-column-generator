// ============================================================================
// src/lib/ai/prompts/keyword-suggestions.ts
//
// ゼロ生成フォーム向け「キーワード候補提案」用 prompt builder。
//
// 2 系統を返す:
//   1. buildPersonaCandidates() — persona.search_patterns × theme から
//      ローカルで即時生成（Gemini コール不要、コスト 0）
//   2. buildAiSuggestionPrompt() — Gemini に渡す system/user prompt
//      (3-5 単語の長尾 KW を 10 件提案させる)
// API ルートでは両方を統合 → dedupe → スコア順に返す。
// ============================================================================

import type {
  KeywordSuggestion,
  KeywordSuggestionSource,
  ZeroGenerateIntent,
} from '@/lib/validators/zero-generate';

interface PersonaForSuggestion {
  name: string;
  age_range: string | null;
  description: string | null;
  search_patterns: string[];
  tone_guide: string | null;
}

interface ThemeForSuggestion {
  name: string;
  category: string | null;
}

const INTENT_LABEL: Record<ZeroGenerateIntent, string> = {
  info: '情報提供型（事実・知識を整理して伝える）',
  empathy: '共感型（読者の気持ちに寄り添う）',
  solve: '課題解決型（具体的な手順・ワークを示す）',
  introspect: '内省・自己探求型（読者自身の内側へ問いを向ける）',
};

/**
 * persona.search_patterns × theme + intent から、Gemini を呼ばずに作れる候補を返す。
 * 例: persona=彩花 (search_patterns=['タロット','オラクルカード']) × theme='ヒーリングと癒し'
 *     → ['タロット ヒーリングと癒し', 'オラクルカード ヒーリングと癒し',
 *        'タロット 初心者', 'オラクルカード 癒し', ...]
 *
 * 重複や空文字は呼び出し側でまとめて dedupe する。
 */
export function buildPersonaCandidates(args: {
  theme: ThemeForSuggestion;
  persona: PersonaForSuggestion;
  intent?: ZeroGenerateIntent;
}): KeywordSuggestion[] {
  const { theme, persona, intent } = args;
  const out: KeywordSuggestion[] = [];

  const themeWords = splitJaWords(theme.name);
  const themeShort = themeWords[0] ?? theme.name;

  for (const [i, pattern] of persona.search_patterns.entries()) {
    const cleanPattern = pattern.trim();
    if (!cleanPattern) continue;

    // バリエーション 1: pattern × theme 短縮形
    out.push({
      keyword: `${cleanPattern} ${themeShort}`.trim(),
      source: 'persona',
      rationale: `${persona.name}の関心 × テーマ「${themeShort}」`,
      score: 0.9 - i * 0.05,
    });

    // バリエーション 2: pattern × 「初心者」（intent が info/empathy のとき）
    if (intent === 'info' || intent === 'empathy' || intent === undefined) {
      out.push({
        keyword: `${cleanPattern} 初心者`,
        source: 'persona',
        rationale: `初心者向け検索意図（入門者の流入確保）`,
        score: 0.8 - i * 0.05,
      });
    }

    // バリエーション 3: pattern × 「やり方」（intent が solve のとき）
    if (intent === 'solve') {
      out.push({
        keyword: `${cleanPattern} やり方`,
        source: 'persona',
        rationale: `課題解決型 × ${persona.name}の関心`,
        score: 0.8 - i * 0.05,
      });
    }

    // バリエーション 4: pattern × 「とは」（intent が info のとき）
    if (intent === 'info') {
      out.push({
        keyword: `${cleanPattern} とは`,
        source: 'persona',
        rationale: `情報提供型の定番（検索意図が明確）`,
        score: 0.75 - i * 0.05,
      });
    }
  }

  // テーマ × 年齢層
  if (persona.age_range) {
    out.push({
      keyword: `${themeShort} ${persona.age_range.replace(/-\d+$/, '')}代`,
      source: 'persona',
      rationale: `${persona.age_range}代向けに絞った長尾`,
      score: 0.7,
    });
  }

  return out;
}

/** 簡易な日本語語分割（中黒・空白・「と」「・」で割る）。形態素解析は使わない。 */
function splitJaWords(s: string): string[] {
  return s
    .split(/[\s・と、]/u)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

/**
 * Gemini に渡す system + user prompt を返す。
 * Gemini からの出力は `{ candidates: [{keyword, rationale}] }` を期待。
 */
export function buildAiSuggestionPrompt(args: {
  theme: ThemeForSuggestion;
  persona: PersonaForSuggestion;
  intent?: ZeroGenerateIntent;
  exclude: string[];
}): { system: string; user: string } {
  const { theme, persona, intent, exclude } = args;

  const system = [
    'あなたは日本語コンテンツSEOの専門家です。',
    'スピリチュアルカウンセラー小林由起子さんのコラムサイト (https://harmony-mc.com/column/) 向けに、',
    '検索ボリュームを取りやすい長尾キーワードを提案します。',
    '',
    '## ルール',
    '- 3〜5 単語の長尾キーワード（半角スペース区切り）',
    '- 検索意図が明確になる修飾語を組み込む（「やり方」「とは」「比較」「効果」「初心者」「習慣」等）',
    '- スピリチュアル/癒し/カウンセリング領域の自然な日本語',
    '- 大手メディアと真っ向勝負しないニッチを狙う（個人ブログでも上位を取りやすい狭い意図）',
    '- 提案毎に rationale（なぜ取れるか）を 30 字以内で',
    '- 必ず JSON のみで返答（前置き・後書き禁止）',
  ].join('\n');

  const intentLabel = intent ? INTENT_LABEL[intent] : '未指定';
  const excludeLine = exclude.length > 0 ? exclude.join(', ') : '（なし）';

  const user = [
    '# 想定読者ペルソナ',
    `- 名前: ${persona.name}`,
    `- 年齢層: ${persona.age_range ?? '未設定'}`,
    persona.description ? `- 説明: ${persona.description}` : null,
    persona.search_patterns.length > 0
      ? `- このペルソナがよく検索する語: ${persona.search_patterns.join(', ')}`
      : null,
    persona.tone_guide ? `- 望ましい語り口: ${persona.tone_guide}` : null,
    '',
    '# テーマ',
    `${theme.name}${theme.category ? ` (category: ${theme.category})` : ''}`,
    '',
    '# 記事の意図',
    intentLabel,
    '',
    '# 既に追加済キーワード（重複禁止）',
    excludeLine,
    '',
    '# 出力',
    '以下の JSON 形式で 10 個提案してください。1 個ごとに rationale を 30 字以内で添える。',
    '',
    '```json',
    '{',
    '  "candidates": [',
    '    { "keyword": "瞑想 初心者 効果", "rationale": "..." }',
    '  ]',
    '}',
    '```',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  return { system, user };
}

/**
 * Gemini レスポンスを KeywordSuggestion[] に正規化する。
 * 配列 / object / 部分破損のいずれでも安全にスキップ。
 */
export function normalizeAiCandidates(
  raw: unknown,
  baseScore = 0.6,
): KeywordSuggestion[] {
  const out: KeywordSuggestion[] = [];
  const tryPushItem = (item: unknown, idx: number) => {
    if (!item || typeof item !== 'object') return;
    const o = item as Record<string, unknown>;
    const kw =
      typeof o.keyword === 'string'
        ? o.keyword.trim()
        : typeof o.kw === 'string'
          ? (o.kw as string).trim()
          : '';
    if (!kw) return;
    const rationale = typeof o.rationale === 'string' ? o.rationale : '';
    out.push({
      keyword: kw,
      source: 'ai' as KeywordSuggestionSource,
      rationale: rationale || 'AI 提案',
      score: Math.max(0.05, baseScore - idx * 0.02),
    });
  };

  // { candidates: [...] }
  if (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).candidates)) {
    ((raw as Record<string, unknown>).candidates as unknown[]).forEach(tryPushItem);
    return out;
  }
  // 直配列
  if (Array.isArray(raw)) {
    raw.forEach(tryPushItem);
    return out;
  }
  return out;
}
