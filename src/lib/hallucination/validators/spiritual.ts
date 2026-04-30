// ============================================================================
// src/lib/hallucination/validators/spiritual.ts
// スピリチュアル NG 辞書検証器（spec §6.3, §7.2）
//
// 機能:
//   - NG 辞書（forbidden-spiritual.json）と Aho-Corasick 風の完全一致探索
//   - ヒット箇所の前後 ±10 文字を文脈窓として取得
//   - 否定マーカー（「〜ない」「〜ません」等）を含む場合は除外
//   - hit があれば critical 判定
// ============================================================================

import type { ClaimResult } from '../types';
import dictionary from '../forbidden-spiritual.json';

// ─── 辞書ロード ─────────────────────────────────────────────────────────────

const FORBIDDEN_TERMS: string[] = (() => {
  const cats = (dictionary as { categories: Record<string, string[]> }).categories;
  const all: string[] = [];
  for (const list of Object.values(cats)) all.push(...list);
  // 長い語を先にマッチさせる（「過去世」を「世」で誤マッチさせない）
  return Array.from(new Set(all)).sort((a, b) => b.length - a.length);
})();

const NEGATION_MARKERS: string[] = (
  dictionary as { negationMarkers: string[] }
).negationMarkers;

// ─── 探索ヘルパー ───────────────────────────────────────────────────────────

const CONTEXT_WINDOW = 10;

interface HitInfo {
  term: string;
  index: number;
  contextBefore: string;
  contextAfter: string;
}

/**
 * 全 NG 用語について先頭から走査しヒット位置を返す。
 * 同一 term の複数出現にも対応。
 */
function findAllHits(text: string): HitInfo[] {
  const hits: HitInfo[] = [];
  for (const term of FORBIDDEN_TERMS) {
    let from = 0;
    while (from < text.length) {
      const idx = text.indexOf(term, from);
      if (idx === -1) break;
      hits.push({
        term,
        index: idx,
        contextBefore: text.slice(Math.max(0, idx - CONTEXT_WINDOW), idx),
        contextAfter: text.slice(
          idx + term.length,
          Math.min(text.length, idx + term.length + CONTEXT_WINDOW)
        ),
      });
      from = idx + term.length;
    }
  }
  return hits;
}

/**
 * 文脈窓（前後）に否定マーカーが含まれるか判定。
 * 含まれる場合は「否定文脈」として除外する。
 *
 * 文脈窓 ±10 字で見つからなかった場合は「同一文（句点までの範囲）末尾」までを
 * 拡張ウィンドウとして探索する。これは日本語の述部位置（語の登場位置から
 * 句末までが離れる傾向）への対策。
 */
function isNegated(hit: HitInfo, fullText: string): boolean {
  const localWindow = hit.contextBefore + hit.contextAfter;
  if (NEGATION_MARKERS.some((m) => localWindow.includes(m))) return true;

  // 同一文の述部まで拡張探索: 直前の句点(。/.) 〜 直後の句点まで
  const start = Math.max(
    fullText.lastIndexOf('。', hit.index - 1) + 1,
    fullText.lastIndexOf('.', hit.index - 1) + 1,
    0
  );
  const dotAfter = fullText.indexOf('。', hit.index);
  const periodAfter = fullText.indexOf('.', hit.index);
  const candidates = [dotAfter, periodAfter].filter((i) => i !== -1);
  const end = candidates.length > 0 ? Math.min(...candidates) + 1 : fullText.length;
  const sentence = fullText.slice(start, end);
  return NEGATION_MARKERS.some((m) => sentence.includes(m));
}

// ─── メインエントリ ─────────────────────────────────────────────────────────

/**
 * 単一クレーム文の NG 辞書ヒットを検証する。
 *
 * @param claim 検証対象のテキスト
 */
export async function validateSpiritualClaim(
  claim: string
): Promise<ClaimResult> {
  const allHits = findAllHits(claim);
  const activeHits = allHits.filter((h) => !isNegated(h, claim));

  if (activeHits.length === 0) {
    return {
      type: 'spiritual',
      claim,
      verdict: 'grounded',
      similarity: 1,
      severity: 'none',
      evidence: [],
      reason: allHits.length > 0
        ? `NG語ヒット ${allHits.length} 件は全て否定文脈のため除外`
        : 'NG語ヒットなし',
    };
  }

  const terms = activeHits.map((h) => h.term).join(', ');
  return {
    type: 'spiritual',
    claim,
    verdict: 'flagged',
    similarity: 0,
    severity: 'critical',
    evidence: activeHits.map((h) => ({
      id: `spiritual-${h.term}-${h.index}`,
      content: `${h.contextBefore}【${h.term}】${h.contextAfter}`,
      similarity: 0,
      source: 'forbidden-dictionary',
    })),
    reason: `NG語ヒット: ${terms}`,
  };
}

// テスト用 export
export const __test__ = {
  FORBIDDEN_TERMS,
  NEGATION_MARKERS,
  findAllHits,
  isNegated,
};
