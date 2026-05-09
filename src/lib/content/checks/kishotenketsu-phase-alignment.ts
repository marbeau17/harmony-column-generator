// ============================================================================
// src/lib/content/checks/kishotenketsu-phase-alignment.ts
// 各 H2 が起承転結プランの 4 段と対応しているかを cheerio で検証する補助チェック。
//
// spec: docs/specs/kishotenketsu-flow.md §8.3
//
// 設計方針:
//   - sync 関数 (cheerio 解析のみ、AI 呼ばない)
//   - severity = 'warning' 固定 (AI 不在のためトークン未消費だが、
//     phase の語彙一致は単純判定で false positive 起こりやすい)
//   - 各 phase の summary 文字列から長さ 2 以上のトークンを 2-3 個拾い、
//     いずれかの h2 テキストに含まれるかを判定
//   - kishotenketsu 未生成 / body_html 不在 → 空配列を返す (チェック自体省略)
// ============================================================================

import * as cheerio from 'cheerio';

import type { KishotenketsuPlan } from '@/lib/schemas/kishotenketsu';
import type { Article } from '@/types/article';

import type { CheckItem } from '../quality-checklist';

type PhaseKey = 'ki' | 'sho' | 'ten' | 'ketsu';

/** 判定対象本文を選ぶ (deploy 後 → published → stage2 の優先順) */
function pickBodyHtml(article: Article): string {
  return (
    article.stage3_final_html ??
    article.published_html ??
    article.stage2_body_html ??
    ''
  );
}

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

/**
 * 起承転結 phase と本文の H2 とのマッピングを検証する (sync, AI 不使用)。
 *
 * - article.kishotenketsu 未生成 / body_html 空 → 空配列 (省略)
 * - 各 phase の summary から 2 文字以上のトークン上位 3 つを抽出
 * - 上記トークンのいずれかが 1 つ以上の h2 テキストに含まれていれば「整合」
 * - 全 phase で整合していれば pass、欠けがあれば warn
 */
export function checkKishotenketsuPhaseAlignment(
  article: Article,
): CheckItem[] {
  const plan = getKishotenketsuPlan(article);
  const html = pickBodyHtml(article);
  if (!plan || !html) return [];

  const $ = cheerio.load(html);
  const h2s = $('h2')
    .toArray()
    .map((el) => $(el).text().trim());

  const phases: Array<[PhaseKey, string]> = [
    ['ki', plan.ki],
    ['sho', plan.sho],
    ['ten', plan.ten],
    ['ketsu', plan.ketsu],
  ];

  const unaligned = phases.filter(([, summary]) => {
    const tokens = summary
      .split(/[、。\s]/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2)
      .slice(0, 3);
    if (tokens.length === 0) return true; // 取り出せるトークン無し → 非整合扱い
    return !h2s.some((h) => tokens.some((t) => h.includes(t)));
  });

  return [
    {
      id: 'kishotenketsu_phase_alignment',
      category: '構成',
      label: '各 H2 が起承転結プランと対応しているか',
      status: unaligned.length === 0 ? 'pass' : 'warn',
      severity: 'warning',
      detail:
        unaligned.length > 0
          ? `H2 と非整合: ${unaligned.map(([k]) => k).join('、')}`
          : undefined,
      value: unaligned.length,
    },
  ];
}
