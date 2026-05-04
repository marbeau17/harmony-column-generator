// ============================================================================
// src/lib/html/template-engine.ts
// HTMLテンプレートエンジン — 中央エクスポートモジュール
//
// html-generator, parser, related-articles を統合するファサード。
// API ルートや deploy ロジックからはこのモジュールを通してHTML操作を行う。
// ============================================================================

// ── 生成 ──────────────────────────────────────────────────────────────────
export {
  generateArticleHtml,
  type HtmlGeneratorInput,
} from '@/lib/generators/html-generator';

// ── パース ────────────────────────────────────────────────────────────────
export {
  parseArticleHtml,
  extractBodyHtml,
  sectionsToHtml,
  type ParsedArticle,
  type BodySection,
  type TocItem,
  type RelatedArticleRef,
  type ImageRef,
} from '@/lib/html/parser';

// ── 関連記事 ──────────────────────────────────────────────────────────────
export {
  selectRelatedArticles,
} from '@/lib/generators/related-articles';

// ─── ユーティリティ ─────────────────────────────────────────────────────────

/**
 * HTMLをサニタイズして安全なテキストに変換
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

/**
 * HTMLからプレーンテキスト抽出 (meta description 生成用)
 */
export function extractPlainText(html: string, maxLength = 160): string {
  const text = stripHtml(html)
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? text.slice(0, maxLength - 3) + '...' : text;
}

/**
 * 見出し (h2/h3) を抽出して構造化データに変換
 */
export function extractHeadings(html: string): { id: string; text: string; level: number }[] {
  const headings: { id: string; text: string; level: number }[] = [];
  const regex = /<h([23])\s*(?:id="([^"]*)")?\s*>([^<]*)<\/h[23]>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const level = parseInt(match[1], 10);
    const id = match[2] || `heading-${headings.length + 1}`;
    const text = match[3].trim();
    if (text) headings.push({ id, text, level });
  }

  return headings;
}

/**
 * P5-68 E3: 旧 `replaceImagePlaceholders` をリネーム。
 *
 * **これは canonical な `src/lib/zero-gen/replace-placeholders.ts` の
 * `replaceImagePlaceholders` とは別目的の関数である。**
 *
 * canonical: 本文 HTML 内の `<!--IMAGE:hero:hero.webp-->` 等のプレースホルダコメントを
 *            `<img src="...">` タグに置換 (Phase 1/2/3 + 安全な regex + mismatched 検出)。
 *
 * こちら (mapImageUrlsForTemplate): FTP デプロイ時のテンプレート置換ヘルパ。
 *   引数で渡された任意の placeholder 文字列を `placeholders/${filename}` という
 *   相対パスに単純置換するだけで、IMAGE:position 形式は扱わない。
 *
 * 関数名衝突を避けるために `mapImageUrlsForTemplate` にリネーム。
 * 現状 caller は存在しないが、export を残すのは将来の FTP テンプレート差し替えで
 * 利用される可能性があるため (削除すると挙動が壊れる外部 caller を想定して保守的に保持)。
 */
export function mapImageUrlsForTemplate(
  html: string,
  ftpDirectory: string,
  imageMap: Record<string, string>,
): string {
  let result = html;
  for (const [placeholder, filename] of Object.entries(imageMap)) {
    const remotePath = `placeholders/${filename}`;
    result = result.replace(
      new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      remotePath,
    );
  }
  return result;
}
