// ============================================================================
// src/lib/zero-gen/inject-placeholders.ts
//
// P5-70: handleApplyImages の "no replacements; image_files: 3" 復旧路。
//
// 状況:
//   - zero-generation の Stage2 出力で AI が IMAGE プレースホルダを欠落させる
//     ケースが稀に発生する (P5-55/57/68 の placeholder mismatch 系再来)。
//   - その結果 replaceImagePlaceholders が phase1=0 / phase2=0 を返し、
//     画像 3 枚が孤立 (orphaned) し本文に <img> が 1 つも入らない。
//
// 解決方針 (anti-pattern 回避):
//   - HTML を `string.replace(regex)` で書き換えるな  → cheerio で AST 操作。
//   - `[\s\S]*?` 等の貪欲マッチを使うな              → DOM walk で位置決定。
//   - 注入位置は h2 の直前/直後のみ (安全位置)        → <a>/<h*> 内側に絶対入れない。
//
// 戦略:
//   1. cheerio で body をパース。
//   2. h2 一覧を取得し、
//        - HERO    → 最初の h2 の **前** (なければ <body> 先頭)
//        - BODY    → 中央付近の h2 の **直前**
//        - SUMMARY → 最後の h2 の **直前** (なければ <body> 末尾)
//      に `<!--IMAGE:hero:hero.webp-->` 形式の HTML コメントを 1 行ずつ挿入。
//   3. 既に同位置のプレースホルダ / 同 position の <img> が存在する場合は
//      その position はスキップ (idempotent / 重複注入防止)。
//   4. 注入された position の集合と更新後の HTML を返す。
//
// 戻り値の `injected` は呼び出し側が
//   - 0 件        → 安全位置が見つからなかった (h2 ゼロ等)
//   - >= 1 件     → そのまま replaceImagePlaceholders に再投入可能
// と判定するために使用する。
// ============================================================================

import * as cheerio from 'cheerio';
import type { ImageFileRow } from './replace-placeholders';

export interface InjectResult {
  /** 注入後の HTML (失敗時は入力をそのまま返す) */
  html: string;
  /** 注入できた position の配列 (順序保持) */
  injected: string[];
  /** 既に該当 position のプレースホルダ or <img> が存在しスキップした position */
  skipped: string[];
}

/**
 * placeholder のコメント表現を生成する。
 * replace-placeholders.ts の Phase 1 Pattern 2 (`<!--\s*IMAGE:pos(?::filename)?-->`)
 * にマッチする canonical 形式を採用 (空白なし、filename 付きはオプション)。
 */
function placeholderCommentFor(img: ImageFileRow): string {
  const fname = img.filename ? `:${img.filename}` : '';
  return `<!--IMAGE:${img.position}${fname}-->`;
}

/**
 * body_html に既に該当 position の placeholder / <img> が存在するか判定する。
 *
 * - placeholder: `<!--IMAGE:hero...-->` / `IMAGE:hero...` (裸も含む)
 * - <img>: alt 属性に position が含まれているもの (run-completion 由来の alt 規約)
 */
function hasExistingForPosition(
  $: cheerio.CheerioAPI,
  position: string,
): boolean {
  const html = $.html();
  // HTML コメント形式 / 裸プレースホルダの双方を検出
  // (replace-placeholders.ts Phase 1 が消費する全パターンと整合)
  const placeholderRe = new RegExp(
    `<!--\\s*IMAGE:${position}(?::[^-]*)?-->|IMAGE:${position}(?::[\\w./_-]+)?`,
    'i',
  );
  if (placeholderRe.test(html)) return true;
  // <img> タグの alt 属性に position が入っているか (run-completion の alt 規約)
  let found = false;
  $('img').each((_, el) => {
    const alt = ($(el).attr('alt') ?? '').toLowerCase();
    const src = ($(el).attr('src') ?? '').toLowerCase();
    if (alt.includes(position) || src.includes(`/${position}.`)) {
      found = true;
      return false; // break
    }
    return undefined;
  });
  return found;
}

/**
 * 安全な注入アンカーを決定する。
 *
 * - hero    : 最初の h2 の前。h2 が無ければ body の先頭。
 * - body    : 全 h2 のうち中央 (Math.floor(n/2)) の前。h2 が 1 つしか無ければ
 *             その h2 の直後 (= 同じ h2 を hero と共有しないため). h2 が 0 個
 *             なら body 末尾。
 * - summary : 最後の h2 の前。h2 が無ければ body 末尾。
 *
 * いずれも cheerio の before()/after()/append()/prepend() を使い、
 * <a>/<h*>/<p> 等のインライン要素の **内側** には絶対入れない。
 */
function injectAt(
  $: cheerio.CheerioAPI,
  position: 'hero' | 'body' | 'summary',
  comment: string,
): boolean {
  // ルートに対して h2 を全列挙 (cheerio.load の自動 wrap で <html><body> が
  // 付与されるため、document 全体を対象に走査して問題ない)。
  const h2s = $('h2').toArray();

  // body 要素 (cheerio が自動生成する) を取得。fragment モードでは <body> が
  // 無いため root を使うが、TypeScript の型上は Cheerio<Document> と
  // Cheerio<Element> が結合できないので prepend/append を使うラッパーを定義する。
  const $body = $('body');
  const prepend = (s: string): void => {
    if ($body.length > 0) $body.prepend(s);
    else $.root().prepend(s);
  };
  const append = (s: string): void => {
    if ($body.length > 0) $body.append(s);
    else $.root().append(s);
  };

  if (position === 'hero') {
    if (h2s.length > 0) {
      $(h2s[0]).before(`${comment}\n`);
    } else {
      prepend(`${comment}\n`);
    }
    return true;
  }
  if (position === 'summary') {
    if (h2s.length > 0) {
      $(h2s[h2s.length - 1]).before(`${comment}\n`);
    } else {
      append(`\n${comment}`);
    }
    return true;
  }
  // 'body' (中央)
  if (h2s.length === 0) {
    append(`\n${comment}`);
    return true;
  }
  if (h2s.length === 1) {
    // 唯一の h2 を hero と共有しないよう **直後** に挿入。
    $(h2s[0]).after(`\n${comment}`);
    return true;
  }
  const midIdx = Math.floor(h2s.length / 2);
  $(h2s[midIdx]).before(`${comment}\n`);
  return true;
}

/**
 * body_html に IMAGE プレースホルダコメントを安全に注入する。
 *
 * @param bodyHtml   現在の本文 HTML (空文字 / null 安全)
 * @param imageFiles position 付きの画像ファイル配列
 * @returns          注入後 HTML, 注入された position 配列, スキップ position 配列
 */
export function injectImagePlaceholders(
  bodyHtml: string,
  imageFiles: ImageFileRow[],
): InjectResult {
  if (!bodyHtml || imageFiles.length === 0) {
    return { html: bodyHtml ?? '', injected: [], skipped: [] };
  }

  // cheerio.load: `null` 第二引数 + false で fragment モード相当。
  // ただし fragment モードだと <body> wrap が省かれて prepend/append が
  // 取れないため、デフォルト (document) モードのまま走査し、最後に
  // body 内部の HTML を取り出す。
  const $ = cheerio.load(bodyHtml, null, false);

  const injected: string[] = [];
  const skipped: string[] = [];

  for (const img of imageFiles) {
    const pos = img.position;
    if (pos !== 'hero' && pos !== 'body' && pos !== 'summary') {
      // 不明な position は注入対象外 (orphan の可能性あり)。
      skipped.push(pos);
      continue;
    }
    if (hasExistingForPosition($, pos)) {
      skipped.push(pos);
      continue;
    }
    const comment = placeholderCommentFor(img);
    const ok = injectAt($, pos, comment);
    if (ok) injected.push(pos);
    else skipped.push(pos);
  }

  // fragment モードを使っていないため $.html() は <html><body> wrap を含む
  // 場合がある。元の入力が断片だったかを判定し、断片だったなら body の
  // innerHTML を返す。
  const wasFullDocument = /<html[\s>]/i.test(bodyHtml) || /<!doctype/i.test(bodyHtml);
  const out = wasFullDocument ? $.html() : ($('body').html() ?? $.html());

  return { html: out, injected, skipped };
}
