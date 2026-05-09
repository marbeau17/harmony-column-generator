// ============================================================================
// src/lib/content/checks/kishotenketsu-arc.ts
// 起承転結アーク認識性チェック (Gemini 判定、severity=warning 固定)
//
// spec: docs/specs/kishotenketsu-flow.md §8.1, §8.2
//
// 設計方針:
//   - severity = 'warning' 固定: AI 構成判定は false positive 30% 前提
//     (memory: feedback_systemic_antipatterns.md ⑤)。公開ブロックしない安全側。
//   - article.kishotenketsu が NULL の旧記事は warn でスキップ
//   - 本文 800 字未満は Gemini を呼ばず即 fail (cost 抑制 + checkContentLength と整合)
//   - try/catch で AI 失敗時は warn に落とす (silent done パターン回避;
//     status='fail' のまま握り潰すと「公開可」誤判定の温床になるため warn)
// ============================================================================

import * as cheerio from 'cheerio';

import { generateJson } from '@/lib/ai/gemini-client';
import { logger } from '@/lib/logger';
import type { KishotenketsuPlan } from '@/lib/schemas/kishotenketsu';
import type { Article } from '@/types/article';

import type { CheckItem } from '../quality-checklist';

// ─── 型定義 ───────────────────────────────────────────────────────────────────

interface KishotenketsuCheckResult {
  ki_identifiable: boolean;
  sho_identifiable: boolean;
  ten_identifiable: boolean;
  ketsu_identifiable: boolean;
  ten_pivot_explicit: boolean;
  missing: Array<'ki' | 'sho' | 'ten' | 'ketsu'>;
  reason: string;
}

// ─── プロンプト定義 (spec §8.2) ───────────────────────────────────────────────

const KISHOTENKETSU_SYSTEM_PROMPT =
  'あなたは日本語記事の構成解析器です。与えられた本文と起承転結プランを照合し、' +
  '4 段の各段が本文中で識別可能か、特に「転」での視点転換が明示されているかを厳密に判定し、' +
  'JSON のみを返します。説明や前置きは禁止です。';

function buildKishotenketsuUserPrompt(
  plan: { ki: string; sho: string; ten: string; ketsu: string },
  body: string,
): string {
  return [
    '# 起承転結プラン',
    `- 起: ${plan.ki}`,
    `- 承: ${plan.sho}`,
    `- 転: ${plan.ten}`,
    `- 結: ${plan.ketsu}`,
    '',
    '# 本文 (HTML タグ除去済み)',
    body.slice(0, 8000),
    '',
    '# 判定ルール',
    '1. 各段の趣旨が本文の異なるブロックに対応しているか (identifiable)',
    '2. 「転」では視点・立場・時間軸のいずれかが明示的に転換されているか (ten_pivot_explicit)',
    '   単なる話題の追加は転換とみなさない',
    '3. 不足している段を `missing` 配列に列挙する (ki/sho/ten/ketsu)',
    '',
    '# 出力スキーマ',
    '{',
    '  "ki_identifiable": boolean,',
    '  "sho_identifiable": boolean,',
    '  "ten_identifiable": boolean,',
    '  "ten_pivot_explicit": boolean,',
    '  "ketsu_identifiable": boolean,',
    '  "missing": ["ki" | "sho" | "ten" | "ketsu"],',
    '  "reason": "60 文字以内の判定理由"',
    '}',
  ].join('\n');
}

// ─── ヘルパー ────────────────────────────────────────────────────────────────

/**
 * Article から「判定対象本文」を選ぶ。
 * 優先順位: stage3_final_html → published_html → stage2_body_html。
 * いずれも無ければ空文字を返す。
 */
function pickBodyHtml(article: Article): string {
  return (
    article.stage3_final_html ??
    article.published_html ??
    article.stage2_body_html ??
    ''
  );
}

/** cheerio で HTML タグを安全に除去する。`string.replace(regex)` は antipattern。 */
function stripHtmlSafe(html: string): string {
  if (!html) return '';
  const $ = cheerio.load(html);
  return $.root().text().replace(/\s+/g, ' ').trim();
}

/** Article に kishotenketsu フィールドが付与されている場合のみ取得 (型は schema 側) */
function getKishotenketsuPlan(article: Article): KishotenketsuPlan | null {
  const v = (article as unknown as { kishotenketsu?: unknown }).kishotenketsu;
  if (!v || typeof v !== 'object') return null;
  const obj = v as Record<string, unknown>;
  if (
    typeof obj.ki === 'string' &&
    typeof obj.sho === 'string' &&
    typeof obj.ten === 'string' &&
    typeof obj.ketsu === 'string'
  ) {
    // ten_perspective_shift は判定には不要なので存在チェックは省略 (warn 安全側)
    return {
      ki: obj.ki,
      sho: obj.sho,
      ten: obj.ten,
      ketsu: obj.ketsu,
      ten_perspective_shift:
        typeof obj.ten_perspective_shift === 'string'
          ? obj.ten_perspective_shift
          : '',
    };
  }
  return null;
}

// ─── メインチェック ──────────────────────────────────────────────────────────

/**
 * 起承転結アーク認識性チェック。
 *
 * - kishotenketsu 未生成の旧記事 → warn でスキップ
 * - 本文 800 字未満 → Gemini を呼ばず fail (severity=warning なので公開はブロックしない)
 * - Gemini 判定エラー → warn に fallback (silent done 回避のため明示)
 */
export async function checkKishotenketsuArc(
  article: Article,
): Promise<CheckItem[]> {
  const plan = getKishotenketsuPlan(article);
  if (!plan) {
    return [
      {
        id: 'kishotenketsu_arc',
        category: '構成',
        label: '起承転結が認識できるか',
        status: 'warn',
        severity: 'warning',
        detail: '起承転結プラン未生成のため判定スキップ',
      },
    ];
  }

  const html = pickBodyHtml(article);
  const stripped = stripHtmlSafe(html);

  if (stripped.length < 800) {
    return [
      {
        id: 'kishotenketsu_arc',
        category: '構成',
        label: '起承転結が認識できるか',
        status: 'fail',
        severity: 'warning',
        detail: '本文が短すぎて 4 段構成を判定不能',
        value: stripped.length,
      },
    ];
  }

  try {
    const { data } = await generateJson<KishotenketsuCheckResult>(
      KISHOTENKETSU_SYSTEM_PROMPT,
      buildKishotenketsuUserPrompt(plan, stripped),
      { temperature: 0.1, maxOutputTokens: 512 },
    );

    const tenOk = data.ten_identifiable && data.ten_pivot_explicit;
    const allOk =
      data.ki_identifiable &&
      data.sho_identifiable &&
      tenOk &&
      data.ketsu_identifiable;

    const missing: string[] = [
      ...((data.missing ?? []) as string[]),
      ...(!data.ten_pivot_explicit && data.ten_identifiable
        ? ['ten(視点転換が不明瞭)']
        : []),
    ];

    return [
      {
        id: 'kishotenketsu_arc',
        category: '構成',
        label: '起承転結が認識できるか',
        status: allOk ? 'pass' : 'fail',
        severity: 'warning', // false positive 30% 前提のため warning 固定
        detail: allOk
          ? undefined
          : `不足: ${missing.join('、')} / ${data.reason ?? '理由なし'}`,
      },
    ];
  } catch (e) {
    // ai カテゴリで集約 (logger.LogCategory に 'quality' が無いため)
    logger.warn('ai', 'kishotenketsu_arc.gemini_failed', {
      article_id: article.id,
      error: String(e),
    });
    return [
      {
        id: 'kishotenketsu_arc',
        category: '構成',
        label: '起承転結が認識できるか',
        status: 'warn',
        severity: 'warning',
        detail: 'AI 判定エラー (handled, 公開はブロックしない)',
      },
    ];
  }
}
