// ============================================================================
// src/lib/schemas/kishotenketsu.ts
// 起承転結 (kishotenketsu) ナラティブ構造の zod schema 定義。
//
// spec: docs/specs/kishotenketsu-flow.md §3.1
// 由起子さんのコラムは日本古来の「起承転結」に従って物語を描く。narrative_arc
// が感情曲線 (内的動き) を担うのに対し、kishotenketsu は「論の骨格」(視点の動
// き) を担う。両 schema は並列で生成され、Stage1 outline で必須出力される。
//
// 設計方針:
//   - 4 phase それぞれを 50〜150 字に強制する。50 字未満は中身が空疎になり、
//     150 字超は「だらだら長い」由起子さん FB の禁忌に触れる。
//   - ten_perspective_shift は転 (ten) が承 (sho) の言い換え・深掘りに堕する
//     ことを防ぐ自己診断フィールド。20〜120 字で「視点の角度がどう変わった
//     か」を簡潔に説明させる。
//   - 共通 schema として独立ファイルに切り出し、Stage1 prompt / Stage2 prompt
//     / quality_check / UI コンポーネントから参照する。重複定義を避けるため。
// ============================================================================

import { z } from 'zod';

/**
 * 起承転結各 phase の文字列スキーマ。50〜150 字で強制する。
 *
 * - 50 字未満: 視点の中身を伝えるのに不十分 (「テーマを優しく差し出す」が
 *   一言で終わってしまう)
 * - 150 字超: 由起子さん FB「1 記事 1 視点」原則に反し、phase が肥大化する
 */
export const kishotenketsuPhaseSchema = z
  .string()
  .min(50, '各 phase は 50 字以上')
  .max(150, '各 phase は 150 字以内');

/**
 * 起承転結プラン全体のスキーマ。
 *
 * フィールド:
 *   - ki    : テーマ提示・読者の現在地の言語化
 *   - sho   : 起の深掘り・読者の感情への寄り添い
 *   - ten   : 視点転換 (Yukiko signature)。承と逆方向の気づきを必須
 *   - ketsu : 転を踏まえた受容と小さな行動提案
 *   - ten_perspective_shift: 承から転への視点角度差の自己説明 (20〜120 字)
 */
export const kishotenketsuSchema = z.object({
  ki: kishotenketsuPhaseSchema,
  sho: kishotenketsuPhaseSchema,
  ten: kishotenketsuPhaseSchema,
  ketsu: kishotenketsuPhaseSchema,
  ten_perspective_shift: z
    .string()
    .min(20, 'ten_perspective_shift は 20 字以上')
    .max(120, 'ten_perspective_shift は 120 字以内'),
});

/** 起承転結 phase の literal union 型 (h2_chapters[].kishotenketsu_phase 用) */
export type KishotenketsuPhase = 'ki' | 'sho' | 'ten' | 'ketsu';

/** 起承転結プランの TypeScript 型 (z.infer から派生) */
export type KishotenketsuPlan = z.infer<typeof kishotenketsuSchema>;
