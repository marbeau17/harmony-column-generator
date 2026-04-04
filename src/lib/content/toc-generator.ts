// =============================================================================
// TOC（目次）自動生成エンジン
// H2/H3 タグから目次を生成し、記事HTMLに挿入する
// =============================================================================

import * as cheerio from 'cheerio';

// ─── 型定義 ──────────────────────────────────────────────────────────────────

interface TocEntry {
  level: 2 | 3;
  text: string;
  id: string;
}

// ─── H2/H3 抽出 + id 付与 ───────────────────────────────────────────────────

function extractHeadings($: cheerio.CheerioAPI): TocEntry[] {
  const entries: TocEntry[] = [];
  let h2Index = 0;
  let h3Index = 0;

  $('h2, h3').each((_, el) => {
    const tag = (el as unknown as { tagName: string }).tagName?.toLowerCase();
    const text = $(el).text().trim();
    if (!text) return;

    if (tag === 'h2') {
      h2Index++;
      h3Index = 0;
      const id = `section-${h2Index}`;
      entries.push({ level: 2, text, id });
    } else if (tag === 'h3') {
      h3Index++;
      const id = `section-${h2Index}-${h3Index}`;
      entries.push({ level: 3, text, id });
    }
  });

  return entries;
}

// ─── TOC HTML 生成 ──────────────────────────────────────────────────────────

function buildTocHtml(entries: TocEntry[]): string {
  let html = '<nav class="article-toc">\n';
  html += '  <details open>\n';
  html += '    <summary class="article-toc-title">この記事の目次</summary>\n';
  html += '  <ol class="article-toc-list">\n';

  let inH3List = false;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const next = entries[i + 1];

    if (entry.level === 2) {
      html += `    <li><a href="#${entry.id}">${escapeHtml(entry.text)}</a>`;

      // 次がH3なら子リストを開始
      if (next && next.level === 3) {
        html += '\n      <ol>\n';
        inH3List = true;
      } else {
        html += '</li>\n';
      }
    } else if (entry.level === 3) {
      html += `        <li><a href="#${entry.id}">${escapeHtml(entry.text)}</a></li>\n`;

      // 次がH2 or 末尾なら子リストを閉じる
      if (!next || next.level === 2) {
        html += '      </ol>\n';
        html += '    </li>\n';
        inH3List = false;
      }
    }
  }

  // 万が一閉じ忘れ対策
  if (inH3List) {
    html += '      </ol>\n';
    html += '    </li>\n';
  }

  html += '  </ol>\n';
  html += '  </details>\n';
  html += '</nav>';

  return html;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * bodyHtml から H2/H3 タグを抽出して目次 HTML を生成する。
 * H2/H3 が 2 個以下の場合は空文字を返す（短い記事には目次不要）。
 */
export function generateTocHtml(bodyHtml: string): string {
  const $ = cheerio.load(bodyHtml);
  const entries = extractHeadings($);

  // H2 + H3 合計が 2 個以下なら生成しない
  if (entries.length <= 2) {
    return '';
  }

  return buildTocHtml(entries);
}

/**
 * bodyHtml の各 H2/H3 に id 属性を付与し、最初の H2 の直前に TOC を挿入する。
 * 既に `.article-toc` がある場合は何もしない。
 * H2/H3 が 2 個以下の場合も何もしない。
 */
export function insertTocIntoHtml(bodyHtml: string): string {
  const $ = cheerio.load(bodyHtml);

  // 既に TOC がある場合はスキップ
  if ($('.article-toc').length > 0) {
    return $('body').html() ?? bodyHtml;
  }

  const entries = extractHeadings($);

  // H2 + H3 合計が 2 個以下なら挿入しない
  if (entries.length <= 2) {
    return $('body').html() ?? bodyHtml;
  }

  // H2/H3 に id 属性を付与
  let h2Idx = 0;
  let h3Idx = 0;
  $('h2, h3').each((_, el) => {
    const tag = (el as unknown as { tagName: string }).tagName?.toLowerCase();
    const text = $(el).text().trim();
    if (!text) return;

    if (tag === 'h2') {
      h2Idx++;
      h3Idx = 0;
      $(el).attr('id', `section-${h2Idx}`);
    } else if (tag === 'h3') {
      h3Idx++;
      $(el).attr('id', `section-${h2Idx}-${h3Idx}`);
    }
  });

  // TOC HTML を生成
  const tocHtml = buildTocHtml(entries);

  // 最初の H2 の直前に挿入
  const firstH2 = $('h2').first();
  if (firstH2.length > 0) {
    firstH2.before(tocHtml);
  }

  return $('body').html() ?? bodyHtml;
}

// ─── ユーティリティ ─────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
