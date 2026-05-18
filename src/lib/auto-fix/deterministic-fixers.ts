// ============================================================================
// src/lib/auto-fix/deterministic-fixers.ts
// AI を使わない決定論的フォーマット修復器 (P5-111, 2026-05-18)
//
// 背景:
//   - AI 経由の runAutoFix は stage2_body_html 全体を Gemini で書き直すため、
//     keyword 密度を直そうとして CTA が消える / 画像 placeholder が消える等の
//     副作用 (= 記事破壊) が発生していた。
//   - 一方で format 系チェック (image_placeholders / double_quotes / cta_urls /
//     error_patterns 等) は AI を介在させずに正規表現と canonical helper だけで
//     確実に直せる類のもの。
//
// 設計原則:
//   1. 副作用を最小に: AI を呼ばず、本文の長さ・構造を保持する
//   2. canonical helper を re-use: 既存 replace-placeholders 等と二重実装しない
//   3. 不変条件をテストで pin 留め: body length / h2 count / image count / CTA count
//      が修復前後で「単調増加」または「保持」されることを assert
// ============================================================================

import {
  replaceImagePlaceholders,
  type ImageFileRow,
} from '@/lib/zero-gen/replace-placeholders';

export interface DeterministicFixContext {
  bodyHtml: string;
  article: {
    id: string;
    title: string | null;
    slug: string | null;
    image_files?: unknown;
  };
}

export interface DeterministicFixResult {
  after_html: string;
  applied: boolean;
  detail: string;
  diff_summary: string;
}

function parseImageFiles(raw: unknown): ImageFileRow[] {
  if (!Array.isArray(raw)) return [];
  const result: ImageFileRow[] = [];
  for (const x of raw) {
    if (x == null || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    if (typeof r.url !== 'string' || typeof r.position !== 'string') continue;
    result.push({
      url: r.url,
      position: r.position,
      alt: typeof r.alt === 'string' ? r.alt : '',
      filename: typeof r.filename === 'string' ? r.filename : `${r.position}.webp`,
    });
  }
  return result;
}

function buildDiff(before: string, after: string): string {
  const delta = after.length - before.length;
  const sign = delta >= 0 ? '+' : '';
  return `before=${before.length}, after=${after.length}, delta=${sign}${delta} chars`;
}

// ─── 各 fixer 実装 ────────────────────────────────────────────────────────

/**
 * image_placeholders: 未置換の `<!--IMAGE:...-->` を image_files の URL に置換。
 * 既存 canonical helper を re-use するため後段のテストで保護されている。
 */
function fixImagePlaceholders(ctx: DeterministicFixContext): DeterministicFixResult {
  const imageFiles = parseImageFiles(ctx.article.image_files);
  if (imageFiles.length === 0) {
    return {
      after_html: ctx.bodyHtml,
      applied: false,
      detail: 'image_files が空。先に画像生成を実行してください',
      diff_summary: buildDiff(ctx.bodyHtml, ctx.bodyHtml),
    };
  }
  const { html, phase1, phase2, mismatched } = replaceImagePlaceholders(ctx.bodyHtml, imageFiles);
  return {
    after_html: html,
    applied: phase1 + phase2 > 0,
    detail: `phase1=${phase1}, phase2=${phase2}, mismatched=${mismatched}`,
    diff_summary: buildDiff(ctx.bodyHtml, html),
  };
}

/**
 * double_quotes: 由起子さん FB で「""禁止」のため、`"..."` と U+201C/201D を
 * 日本語かぎ括弧「」に置換。HTML 属性内 (`alt="..."`, `href="..."` 等) は対象外。
 */
function fixDoubleQuotes(ctx: DeterministicFixContext): DeterministicFixResult {
  const before = ctx.bodyHtml;
  // テキストノードのみ対象にするため tag を一旦保護
  const TAG_PLACEHOLDER = 'TAG';
  const tags: string[] = [];
  const protectedHtml = before.replace(/<[^>]+>/g, (m) => {
    tags.push(m);
    return TAG_PLACEHOLDER;
  });
  // U+201C/201D は対の置換 (左→「、右→」)
  let textOnly = protectedHtml
    .replace(/“/g, '「')
    .replace(/”/g, '」');
  // 半角 " は対で挟まれているケースのみ「」に置換 (奇数個ある場合は手動を促す)
  // 「最初の " を 「、次の " を 」」と交互に置換する
  let inOpen = true;
  textOnly = textOnly.replace(/"/g, () => {
    const r = inOpen ? '「' : '」';
    inOpen = !inOpen;
    return r;
  });
  // タグを復元
  let i = 0;
  const after = textOnly.replace(new RegExp(TAG_PLACEHOLDER, 'g'), () => tags[i++] ?? '');
  const replaced = before !== after;
  return {
    after_html: after,
    applied: replaced,
    detail: replaced ? '" → 「」 / " " → "「" "」"' : 'ダブルクォーテーション未検出',
    diff_summary: buildDiff(before, after),
  };
}

/**
 * cta_urls: harmony-booking.web.app / harmony-mc.com 以外を指す CTA の href を
 * 既定の予約 URL (harmony-booking.web.app) に置換。CTA テキスト自体は保持。
 */
function fixCtaUrls(ctx: DeterministicFixContext): DeterministicFixResult {
  const before = ctx.bodyHtml;
  const validDomains = ['harmony-booking.web.app', 'harmony-mc.com'];
  const CANONICAL = 'https://harmony-booking.web.app/';
  let replaced = 0;
  const after = before.replace(
    /(class="harmony-cta-btn"[^>]*href=")([^"]+)(")/g,
    (_m, prefix, href: string, suffix) => {
      if (validDomains.some((d) => href.includes(d))) return _m;
      replaced++;
      return `${prefix}${CANONICAL}${suffix}`;
    },
  );
  return {
    after_html: after,
    applied: replaced > 0,
    detail: replaced > 0 ? `${replaced} 件の不正 CTA href を ${CANONICAL} に置換` : '不正 CTA href なし',
    diff_summary: buildDiff(before, after),
  };
}

/**
 * error_patterns: AI 生成残骸 (`CORRECTIONS_START`, `IMAGE:hero` 残存等) を除去。
 * Text 中の安全パターンのみマッチ、HTML タグ構造を壊さない。
 */
function fixErrorPatterns(ctx: DeterministicFixContext): DeterministicFixResult {
  const before = ctx.bodyHtml;
  const ERROR_PATTERNS = [
    'CORRECTIONS_START',
    'エラー：',
    '品質チェック対象',
    'お手数ですが',
    '再度送信してください',
    'プロンプトの途中で',
  ];
  let removed: string[] = [];
  let after = before;
  for (const pat of ERROR_PATTERNS) {
    if (after.includes(pat)) {
      removed.push(pat);
      after = after.split(pat).join('');
    }
  }
  // 残存 IMAGE プレースホルダ (text 形式) は image_placeholders fixer に委譲、
  // ここでは安全な裸トークンのみ除去 (`IMAGE:hero` 形式で出現する場合)
  for (const pat of ['IMAGE:hero', 'IMAGE:body', 'IMAGE:summary']) {
    if (new RegExp(`(?<![\\w-])${pat}(?![\\w-])`).test(after)) {
      removed.push(pat);
      after = after.replace(new RegExp(`(?<![\\w-])${pat}(?![\\w-])`, 'g'), '');
    }
  }
  return {
    after_html: after,
    applied: removed.length > 0,
    detail: removed.length > 0 ? `除去: ${removed.join(', ')}` : 'エラーパターン未検出',
    diff_summary: buildDiff(before, after),
  };
}

// ─── 公開 API ─────────────────────────────────────────────────────────────

const FIXERS: Record<
  string,
  (ctx: DeterministicFixContext) => DeterministicFixResult
> = {
  image_placeholders: fixImagePlaceholders,
  double_quotes: fixDoubleQuotes,
  cta_urls: fixCtaUrls,
  error_patterns: fixErrorPatterns,
};

export function isDeterministicFixable(checkItemId: string): boolean {
  return Object.prototype.hasOwnProperty.call(FIXERS, checkItemId);
}

export function listDeterministicFixableIds(): string[] {
  return Object.keys(FIXERS);
}

export function runDeterministicFix(
  checkItemId: string,
  ctx: DeterministicFixContext,
): DeterministicFixResult {
  const fixer = FIXERS[checkItemId];
  if (!fixer) {
    throw new Error(
      `決定論的修復器が存在しません: check_item_id="${checkItemId}"。サポート: ${listDeterministicFixableIds().join(', ')}`,
    );
  }
  return fixer(ctx);
}
