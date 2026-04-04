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
 * 画像プレースホルダーを実際のパスに置換
 */
export function replaceImagePlaceholders(
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
