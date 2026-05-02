// ============================================================================
// src/lib/auto-fix/prompts/index.ts
// 6 種の auto-fix プロンプトビルダ (P5-19)
//
// すべて { system, user } を返す純粋関数。Gemini への入力は本ファイル経由で
// 統一し、orchestrator が dispatch する。
//
// 全プロンプト共通契約:
//   - 出力 JSON: { "html": "..." } のみ
//   - bodyHtml の構造（H2/H3/段落数）を維持
//   - 既存の data-claim-idx 等の属性は temper しない
// ============================================================================

import type { AutoFixParams } from '@/lib/auto-fix/types';

const COMMON_SYSTEM = [
  'あなたはスピリチュアルカウンセラー小林由起子のトーンを忠実に再現する編集者です。',
  '出力は JSON: {"html": "書換後の本文HTML全文"} のみ。説明・前置き禁止。',
  '元 HTML の H2/H3/段落構造、画像、CTA、data-claim-idx 等の属性は維持する。',
  '断定的なスピリチュアル表現や医療的な効果を保証する表現は使用禁止。',
].join('\n');

// ─── 1. suffix: 語尾不足 ──────────────────────────────────────────────────

export function buildSuffixFixPrompt(args: {
  bodyHtml: string;
  current: number;   // 現在の比率 (0.08 等)
  target: number;    // 目標比率 (0.15 等)
}): { system: string; user: string } {
  const system = [
    COMMON_SYSTEM,
    '指示: 文末の語りかけ語尾 (ですよね / ですね / なんです / かもしれません 等) の使用比率を上げる。',
    '元の意味は保持しつつ、文末だけを書き換える。',
    '禁止: 段落・見出しの追加削除。',
  ].join('\n');
  const user = [
    `# 目標`,
    `現在の語りかけ語尾比率: ${(args.current * 100).toFixed(1)}%`,
    `目標: ${(args.target * 100).toFixed(0)}% 以上`,
    `→ 元 HTML の文末から、断定で終わっているものを語りかけ調に書き換えてください。`,
    `押し付けがましくならないよう、自然な範囲で。`,
    ``,
    `# 本文HTML`,
    args.bodyHtml,
  ].join('\n');
  return { system, user };
}

// ─── 2. keyword: キーワード未出現 ─────────────────────────────────────────

export function buildKeywordFixPrompt(args: {
  bodyHtml: string;
  keywords: string[];
}): { system: string; user: string } {
  const system = [
    COMMON_SYSTEM,
    '指示: 指定キーワードを各 3 回以上、自然な文脈で本文に挿入する。',
    '禁止: 強引な挿入、不自然な羅列、見出しへのキーワード乱挿入。',
    '推奨: 既存の段落の流れを尊重し、関連する文脈の中で言及する。',
  ].join('\n');
  const user = [
    `# 挿入すべきキーワード`,
    args.keywords.map((k, i) => `${i + 1}. ${k}`).join('\n'),
    ``,
    `# 要件`,
    `- 各キーワードを最低 3 回ずつ自然に登場させる`,
    `- 既存 H2/H3 構造は維持`,
    `- 「キーワード」「SEO」のようなメタ言及は禁止`,
    ``,
    `# 本文HTML`,
    args.bodyHtml,
  ].join('\n');
  return { system, user };
}

// ─── 3. abstract: 抽象表現に具体例追加 ─────────────────────────────────

export function buildAbstractFixPrompt(args: {
  bodyHtml: string;
  detected_phrase: string;
}): { system: string; user: string } {
  const system = [
    COMMON_SYSTEM,
    '指示: 検出された抽象スピリチュアル表現の直後に「具体例」を 1 文追加する。',
    '具体例: 日常で読者がイメージできる風景・体験・感覚に置き換えた表現。',
    '禁止: 効能保証、医療効果、宗教的断定。',
  ].join('\n');
  const user = [
    `# 検出された抽象表現`,
    `"${args.detected_phrase}"`,
    ``,
    `# 要件`,
    `- 上記表現が現れる箇所の **直後** に、具体例を 1 文だけ追加`,
    `- 例: 「引き寄せの法則」→「たとえば、朝の散歩で気持ちのよい風を感じたとき、その日の予定がスムーズに進む — そんな小さな循環のことです」`,
    `- 既存の文章は変更しない（追加のみ）`,
    ``,
    `# 本文HTML`,
    args.bodyHtml,
  ].join('\n');
  return { system, user };
}

// ─── 4. length: 文字数追記 ────────────────────────────────────────────

export function buildLengthFixPrompt(args: {
  bodyHtml: string;
  current: number;   // 現在文字数
  target: number;    // 目標文字数
}): { system: string; user: string } {
  const gap = args.target - args.current;
  const perChapter = Math.max(80, Math.ceil(gap / 4));
  const system = [
    COMMON_SYSTEM,
    '指示: 各 H2 章の本文に追記して目標文字数まで増やす。',
    '禁止: 新しい H2 章の追加、内容の重複、冗長な言い換え。',
    '推奨: 読者の体験への共感、優しい語りかけの 1-2 文を各章に。',
  ].join('\n');
  const user = [
    `# 文字数情報`,
    `現在: ${args.current} 字`,
    `目標: ${args.target} 字`,
    `不足: ${gap} 字 → 各章に 約 ${perChapter} 字 追記`,
    ``,
    `# 要件`,
    `- 各 H2 章の末尾近くに自然な追記を行う`,
    `- 章のテーマから逸脱しない`,
    `- 既存の段落・H3 構造は維持`,
    ``,
    `# 本文HTML`,
    args.bodyHtml,
  ].join('\n');
  return { system, user };
}

// ─── 5. claim: ハルシネーション疑いの claim を言い換え ─────────────────

export function buildClaimFixPrompt(args: {
  bodyHtml: string;
  claim_idx: number;
}): { system: string; user: string } {
  const system = [
    COMMON_SYSTEM,
    '指示: 指定された data-claim-idx の文だけを、ハルシネーション (事実誤認・偽引用・断定) を含まない言い回しに置換する。',
    '禁止: 他の文の改変、属性の削除。',
    '推奨: 体験的・主観的な表現にトーンダウン (「〜と感じます」「〜のように思えます」等)。',
  ].join('\n');
  const user = [
    `# 書換対象`,
    `<span data-claim-idx="${args.claim_idx}">...</span> の文 1 つだけ`,
    ``,
    `# 要件`,
    `- 該当 span の **テキスト内容** だけを書き換え (span 自体と data-claim-idx 属性は保持)`,
    `- 事実断定・偽引用を排除`,
    `- 自然な日本語、由起子トーンで`,
    ``,
    `# 本文HTML`,
    args.bodyHtml,
  ].join('\n');
  return { system, user };
}

// ─── 6. tone: 全体トーンを由起子流にリライト ──────────────────────────

export function buildToneFixPrompt(args: {
  bodyHtml: string;
  toneTotal?: number;
  blockers?: string[];
}): { system: string; user: string } {
  const system = [
    COMMON_SYSTEM,
    '指示: 本文全体のトーンを「由起子流」(語りかけ + 比喩 + 優しさ + 具体例) に書き換える。',
    '禁止: 構成の変更、章の追加削除、CTA / 画像位置の変更。',
    '推奨: 文末を語りかけに、抽象表現には比喩を、断定は柔らかく。',
  ].join('\n');
  const user = [
    `# 現状`,
    args.toneTotal !== undefined
      ? `現在のトーン総合点: ${args.toneTotal.toFixed(2)} (目標 0.80+)`
      : `トーンが基準を下回っています`,
    args.blockers && args.blockers.length > 0
      ? `\n# 強い不合格項目\n${args.blockers.map((b) => `- ${b}`).join('\n')}`
      : '',
    ``,
    `# 要件`,
    `- 構造（H2/H3/画像/CTA/段落数）は完全に保持`,
    `- 文単位で書換可能だが、意味は保持`,
    `- 由起子流の温かさ・寄り添い・比喩を増やす`,
    ``,
    `# 本文HTML`,
    args.bodyHtml,
  ]
    .filter(Boolean)
    .join('\n');
  return { system, user };
}

// ─── ディスパッチャ ───────────────────────────────────────────────────

export function buildAutoFixPrompt(
  bodyHtml: string,
  params: AutoFixParams,
): { system: string; user: string } {
  switch (params.fix_type) {
    case 'suffix':
      return buildSuffixFixPrompt({
        bodyHtml,
        current: params.current_value ?? 0.08,
        target: params.target_value ?? 0.15,
      });
    case 'keyword':
      return buildKeywordFixPrompt({
        bodyHtml,
        keywords: params.keywords ?? [],
      });
    case 'abstract':
      return buildAbstractFixPrompt({
        bodyHtml,
        detected_phrase: params.detected_phrase ?? '',
      });
    case 'length':
      return buildLengthFixPrompt({
        bodyHtml,
        current: params.current_value ?? 0,
        target: params.target_value ?? 2000,
      });
    case 'claim':
      return buildClaimFixPrompt({
        bodyHtml,
        claim_idx: params.claim_idx ?? 0,
      });
    case 'tone':
      return buildToneFixPrompt({
        bodyHtml,
        toneTotal: params.current_value,
      });
    default: {
      // exhaustive check
      const _exhaust: never = params.fix_type;
      throw new Error(`unknown fix_type: ${_exhaust}`);
    }
  }
}
