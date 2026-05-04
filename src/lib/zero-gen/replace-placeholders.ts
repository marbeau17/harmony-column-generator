// ============================================================================
// src/lib/zero-gen/replace-placeholders.ts
//
// P5-55+: stage2_body_html に残った IMAGE プレースホルダを <img> タグに
// 置換するピュア関数。元は run-completion.ts 内の private 関数だったが、
// 単体テスト (test/unit/replace-image-placeholders.test.ts) で「本文消失バグ」
// に対する regression を保証するため、別モジュールに切り出して export する。
//
// run-completion.ts は本モジュールから import して使用するのみで、
// 振る舞いは完全に同一に保たれる (純粋関数の場所移動 + export 追加のみ)。
//
// P5-58 (案 C): 3-tier fallback + 取りこぼし検出
//   - Phase 1 / Phase 2 の後に Phase 3「残存検出」を追加。
//   - bodyHtml 内に `IMAGE:` または `<!--<img` 等の異常パターンが残っていれば
//     `logger.warn('ai', 'placeholder_mismatch', ...)` で記録し、
//     `onMismatch` callback (optional) を発火する。
//   - 戻り値に `mismatched: number` を追加 (validateCompletion 等から検出可能に)。
// ============================================================================

import { logger } from '@/lib/logger';

export interface ImageFileRow {
  position: string;
  url: string;
  alt: string;
  filename: string;
}

/**
 * Phase 3 で検出した残存パターンの情報。
 */
export interface PlaceholderMismatchInfo {
  /** 残存していた個別の文字列スニペット (最大 8 件 / 各 120 文字 truncate 版、後方互換用) */
  residual: string[];
  /** 残存パターンの総ヒット数 */
  count: number;
  /** P5-68: 残存スニペットの **truncate しない全文** 版 (最大 8 件、closing `-->` や alt 属性を保持) */
  residualFull?: string[];
  /** P5-68: bodyHtml の FNV-1a 32-bit fingerprint (ブラウザ/Node 両対応、debug 相関用) */
  bodyHash?: string;
  /** P5-68: bodyHtml の総文字数 (debug 相関用) */
  bodyLength?: number;
}

/**
 * P5-68: bodyHtml の fingerprint を計算する。
 * 暗号用途ではないため crypto に依存せず、ブラウザ/Node 両環境で同一結果になる
 * FNV-1a 32-bit を採用 (debug ログでの記事/HTML 同一性チェック用)。
 */
function computeBodyFingerprint(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * stage2_body_html に残った IMAGE プレースホルダを <img> タグに置換する。
 * edit/page.tsx の handleApplyImages と同じ多段階パターンを採用。
 *
 * Phase 1: 位置名付き (IMAGE:hero / IMAGE:body / IMAGE:summary)
 * Phase 2: 位置情報なし (順序割当 fallback)
 * Phase 3: 残存検出 (ログ + callback、置換は行わない)
 *
 * **重要な regression 防止条件 (P5-55):**
 *   - 平文 (HTML タグや HTML コメントで囲まれていない) の `IMAGE:` 表現
 *     は決して削除しない。本文中に偶然「IMAGE: hero」のような自然文が
 *     含まれていても保持される。
 *   - Phase 2 fallback は HTML コメント / <p> ラップに限定し、後続文字数も
 *     30 文字以下に制限する。
 *
 * @param onMismatch Phase 3 で残存を検出した際に呼ばれる optional callback
 */
export function replaceImagePlaceholders(
  bodyHtml: string,
  imageFiles: ImageFileRow[],
  onMismatch?: (info: PlaceholderMismatchInfo) => void,
): { html: string; phase1: number; phase2: number; mismatched: number } {
  if (!bodyHtml || imageFiles.length === 0) {
    return { html: bodyHtml, phase1: 0, phase2: 0, mismatched: 0 };
  }
  const imgTagFor = (img: ImageFileRow) =>
    `<img src="${img.url}" alt="${img.alt || ''}" style="max-width:100%;border-radius:8px;margin:1em 0" />`;

  let html = bodyHtml;
  // Phase 1
  // P5-57 (2026-05-03): Pattern 順序を「コメント→div→<p>→裸」に変更し、
  //   裸プレースホルダ regex の `[^\\s<]*` が `>` を除外していなかったため
  //   `<!--IMAGE:body:body.webp-->` の closing `-->` まで貪欲に消費してしまい、
  //   結果 `<!--<img...>` という閉じない不正コメントが残るバグを修正。
  //   修正: コメント / div ラップ形式を **先に** マッチさせ、それから裸形式を試す。
  //   さらに裸形式の filename 部分は `[\\w./_-]*` (安全文字のみ) に制限。
  const matched = new Set<string>();
  let phase1Count = 0;
  for (const img of imageFiles) {
    const tag = imgTagFor(img);
    const patterns = [
      // 1. div でラップされた HTML コメント (最も具体的)
      new RegExp(`<div[^>]*>\\s*<!--\\s*IMAGE:${img.position}(?::[^-]*)?-->\\s*</div>`, 'g'),
      // 2. HTML コメント (filename の有無問わず)
      new RegExp(`<!--\\s*IMAGE:${img.position}(?::[^-]*)?-->`, 'g'),
      // 3. <p> タグでラップ
      new RegExp(`<p>\\s*IMAGE:${img.position}[^<]*<\\/p>`, 'g'),
      // 4. 裸プレースホルダ (filename は安全文字のみ、`>` を含まない)
      new RegExp(`IMAGE:${img.position}(?::[\\w./_-]+)?`, 'g'),
    ];
    for (const p of patterns) {
      const before = html;
      html = html.replace(p, tag);
      if (before !== html) {
        matched.add(img.position);
        phase1Count += (before.match(p) || []).length;
      }
    }
  }

  // Phase 2: position 情報なしの残骸を順序で割当
  const orderedPositions = ['hero', 'body', 'summary'];
  const unmatched = orderedPositions.filter((p) => !matched.has(p));
  const imageByPos = new Map(imageFiles.map((f) => [f.position, f]));
  let phase2Count = 0;
  if (unmatched.length > 0) {
    // P5-55: 旧 fallback `/(?<![A-Za-z_])IMAGE[：:]\s*[^\n<]{1,200}/g` は
    //   本文中の「IMAGE: 」表現にマッチして後続 200 文字までを削除してしまう
    //   危険なバグだったため撤去。代わりに HTML コメント / <p> タグでラップ
    //   された IMAGE: 形式のみを対象とし、平文の IMAGE: は無視する。
    //   さらに後続文字数も <p> ラップ時 30 文字以下に制限し、誤マッチによる
    //   本文消失を防ぐ。
    const fallbackPatterns: RegExp[] = [
      /(?:<!--\s*)?IMAGE[：:]\s*[^<>\n]*?-->/g,
      /<p[^>]*>\s*IMAGE[：:]\s*[^<]{0,30}<\/p>/g,
    ];
    let unmatchedIdx = 0;
    for (const fp of fallbackPatterns) {
      if (unmatchedIdx >= unmatched.length) break;
      html = html.replace(fp, (match) => {
        if (unmatchedIdx >= unmatched.length) return match;
        const pos = unmatched[unmatchedIdx];
        const img = imageByPos.get(pos);
        unmatchedIdx++;
        phase2Count++;
        return img ? imgTagFor(img) : match;
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Phase 3: 残存検出 (置換は行わず、ログ + callback のみ)
  //   検出対象:
  //     a) `<!--<img ...` — Phase 1 旧バグで生成され得た不正コメント断片
  //     b) `<!--IMAGE:` ... `-->` 形式の取りこぼしコメント placeholder
  //     c) `<p>IMAGE:` ... `</p>` 形式の取りこぼし <p> placeholder
  //   平文中の「IMAGE:」(自然文) はマッチしない (P5-55 の本文消失防止のため)。
  // ────────────────────────────────────────────────────────────────────────────
  const residualPatterns: RegExp[] = [
    /<!--\s*<img[^>]*>/g, // a) 不正コメント開始 + img タグ
    /<!--\s*IMAGE[：:][^>]*-->/g, // b) コメント形式の取りこぼし
    /<p[^>]*>\s*IMAGE[：:][^<]*<\/p>/g, // c) <p> 形式の取りこぼし
  ];
  // P5-68: residual は後方互換のため 120 char truncate 版を維持しつつ、
  //   residualFull で全文版も別フィールドに格納。`-->` 終端や alt 属性が
  //   消えると debug 困難になるため (count:2 なのに closing がどこにも無い等)。
  const residualSnippets: string[] = [];
  const residualFullSnippets: string[] = [];
  let mismatched = 0;
  for (const rp of residualPatterns) {
    const hits = html.match(rp);
    if (hits && hits.length > 0) {
      mismatched += hits.length;
      for (const h of hits) {
        if (residualSnippets.length >= 8) break;
        residualSnippets.push(h.slice(0, 120));
        residualFullSnippets.push(h);
      }
    }
  }
  if (mismatched > 0) {
    const bodyHash = computeBodyFingerprint(html);
    const bodyLength = html.length;
    logger.warn('ai', 'placeholder_mismatch', {
      residual: residualSnippets,
      residualFull: residualFullSnippets,
      bodyHash,
      bodyLength,
      count: mismatched,
    });
    onMismatch?.({
      residual: residualSnippets,
      residualFull: residualFullSnippets,
      bodyHash,
      bodyLength,
      count: mismatched,
    });
  }

  return { html, phase1: phase1Count, phase2: phase2Count, mismatched };
}
