// ============================================================================
// src/lib/hallucination/validators/attribution.ts
// 引用帰属検証器（spec §6.2）
//
// 機能:
//   - 文中から URL / 人名（「〜さん」「〜博士」など）を抽出
//   - 知識ベース（既知固有名詞 allowlist）と照合
//   - 不明な引用元は flagged として severity=high で返す
// ============================================================================

import type { ClaimResult } from '../types';

// ─── 既知固有名詞 allowlist ─────────────────────────────────────────────────
// 由起子さん本人 / 関係者 / 公式 URL のホワイトリスト。
// 実運用では DB / 設定ファイルへ移行する。

const KNOWN_PERSONS = new Set<string>([
  '小林由起子',
  '由起子',
  'Yukiko Kobayashi',
]);

const KNOWN_DOMAINS = new Set<string>([
  'harmony-mc.com',
  'harmony-booking.web.app',
  'ameblo.jp',
]);

// ─── 抽出ヘルパー ────────────────────────────────────────────────────────────

/**
 * URL 抽出（http/https）。
 */
function extractUrls(text: string): string[] {
  const re = /https?:\/\/[^\s<>"'）)]+/g;
  return Array.from(new Set(text.match(re) ?? []));
}

/**
 * 人名候補抽出。
 *   - 「〜さん」「〜先生」「〜博士」「〜氏」のような敬称付き
 *   - 漢字 2-4 + ひらがな 1-3 のパターン（簡易）
 */
function extractPersons(text: string): string[] {
  const patterns = [
    /[一-龯ァ-ヴー]{2,6}(?=さん|先生|博士|氏|教授)/g,
    /[A-Z][a-z]+ [A-Z][a-z]+/g, // 英語人名
  ];

  const found = new Set<string>();
  for (const re of patterns) {
    const matches = text.match(re);
    if (matches) for (const m of matches) found.add(m.trim());
  }
  return Array.from(found);
}

/**
 * URL がホワイトリストドメインに含まれるか判定。
 */
function isKnownUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return KNOWN_DOMAINS.has(u.hostname.replace(/^www\./, ''));
  } catch {
    return false;
  }
}

/**
 * 人名がホワイトリストに含まれるか判定。
 */
function isKnownPerson(name: string): boolean {
  return KNOWN_PERSONS.has(name);
}

// ─── メインエントリ ─────────────────────────────────────────────────────────

/**
 * 単一クレーム文の引用帰属を検証する。
 *
 * @param claim 検証対象のテキスト
 */
export async function validateAttributionClaim(
  claim: string
): Promise<ClaimResult> {
  const urls = extractUrls(claim);
  const persons = extractPersons(claim);

  if (urls.length === 0 && persons.length === 0) {
    return {
      type: 'attribution',
      claim,
      verdict: 'grounded',
      similarity: 1,
      severity: 'none',
      evidence: [],
      reason: 'URL/人名が含まれないため検証対象外',
    };
  }

  const unknownUrls = urls.filter((u) => !isKnownUrl(u));
  const unknownPersons = persons.filter((p) => !isKnownPerson(p));

  if (unknownUrls.length === 0 && unknownPersons.length === 0) {
    return {
      type: 'attribution',
      claim,
      verdict: 'grounded',
      similarity: 1,
      severity: 'none',
      evidence: [],
      reason: `URL:${urls.length}件 / 人名:${persons.length}件すべて allowlist 済み`,
    };
  }

  return {
    type: 'attribution',
    claim,
    verdict: 'flagged',
    similarity: 0,
    severity: 'high',
    evidence: [],
    reason: `不明な引用元: URL=[${unknownUrls.join(', ')}] PERSON=[${unknownPersons.join(', ')}]`,
  };
}
