// ============================================================================
// HTML Template Validator
// 確定テンプレートとの整合性を検証し、フォーマット破損を防止する
// ============================================================================

/**
 * 記事HTMLが確定テンプレートの構造に準拠しているかチェック。
 * デプロイ前の最終ステージで必ず実行する。
 */

export interface TemplateCheckItem {
  id: string;
  label: string;
  status: 'pass' | 'fail';
  detail?: string;
}

export interface TemplateCheckResult {
  passed: boolean;
  items: TemplateCheckItem[];
}

// ─── 確定テンプレート構造定義 ─────────────────────────────────────────────

const REQUIRED_ELEMENTS = [
  { id: 'doctype', pattern: /<!DOCTYPE html>/i, label: 'DOCTYPE宣言' },
  { id: 'html_lang', pattern: /<html lang="ja">/i, label: 'html lang="ja"' },
  { id: 'charset', pattern: /<meta charset="UTF-8">/i, label: 'charset UTF-8' },
  { id: 'viewport', pattern: /<meta name="viewport"/i, label: 'viewport meta' },
  { id: 'title_tag', pattern: /<title>[^<]+<\/title>/i, label: 'titleタグ' },
  { id: 'canonical', pattern: /<link rel="canonical"/i, label: 'canonical link' },
  { id: 'og_title', pattern: /<meta property="og:title"/i, label: 'OGP title' },
  { id: 'og_description', pattern: /<meta property="og:description"/i, label: 'OGP description' },
  { id: 'og_image', pattern: /<meta property="og:image"/i, label: 'OGP image' },
  { id: 'twitter_card', pattern: /<meta name="twitter:card"/i, label: 'Twitter Card' },
  { id: 'jsonld', pattern: /<script type="application\/ld\+json">/i, label: 'JSON-LD構造化データ' },
  { id: 'ga4', pattern: /googletagmanager\.com\/gtag/i, label: 'GA4タグ' },
  { id: 'hub_css', pattern: /hub\.css/i, label: 'hub.css参照' },
  { id: 'site_header', pattern: /siteHeader/i, label: 'サイトヘッダー' },
  { id: 'breadcrumb', pattern: /breadcrumb/i, label: 'パンくずリスト' },
  { id: 'article_hero', pattern: /article-hero/i, label: 'ヒーロー画像エリア' },
  { id: 'article_body', pattern: /article-body/i, label: '記事本文エリア' },
  { id: 'article_author', pattern: /article-author/i, label: '著者プロフィール' },
  { id: 'sticky_cta', pattern: /sticky-cta-bar/i, label: 'スティッキーCTAバー' },
  { id: 'closing_html', pattern: /<\/html>\s*$/i, label: '</html>閉じタグ' },
];

const STRUCTURE_CHECKS = [
  {
    id: 'h2_count',
    label: 'H2見出し（2個以上）',
    check: (html: string) => {
      const count = (html.match(/<h2[\s>]/gi) || []).length;
      return { pass: count >= 2, detail: `${count}個` };
    },
  },
  {
    id: 'no_empty_alt',
    label: '空alt属性なし',
    check: (html: string) => {
      const count = (html.match(/alt=""/g) || []).length;
      return { pass: count === 0, detail: count > 0 ? `${count}箇所` : undefined };
    },
  },
  {
    id: 'no_old_color',
    label: '旧カラー(#b39578)なし',
    check: (html: string) => {
      const has = html.includes('#b39578');
      return { pass: !has, detail: has ? '検出' : undefined };
    },
  },
  {
    id: 'no_old_domain',
    label: '旧ドメイン(harmony-spiritual)なし',
    check: (html: string) => {
      const has = html.includes('harmony-spiritual.com');
      return { pass: !has, detail: has ? '検出' : undefined };
    },
  },
  {
    id: 'cta_structure',
    label: 'CTA構造（harmony-cta-inner）',
    check: (html: string) => {
      const ctaBlocks = (html.match(/class="harmony-cta[\s"]/g) || []).length;
      const innerBlocks = (html.match(/harmony-cta-inner/g) || []).length;
      if (ctaBlocks === 0) return { pass: true, detail: 'CTA0箇所（本文外）' };
      return { pass: innerBlocks >= ctaBlocks, detail: `CTA=${ctaBlocks}, inner=${innerBlocks}` };
    },
  },
  {
    id: 'body_length',
    label: '本文500文字以上',
    check: (html: string) => {
      const text = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      return { pass: text.length >= 500, detail: `${text.length}文字` };
    },
  },
];

// ─── メイン検証関数 ─────────────────────────────────────────────────────

/**
 * 記事HTMLが確定テンプレートに準拠しているかチェック。
 * デプロイ前の最終ゲートとして使用。
 */
export function validateArticleTemplate(html: string): TemplateCheckResult {
  const items: TemplateCheckItem[] = [];

  // 必須要素チェック
  for (const el of REQUIRED_ELEMENTS) {
    items.push({
      id: el.id,
      label: el.label,
      status: el.pattern.test(html) ? 'pass' : 'fail',
    });
  }

  // 構造チェック
  for (const check of STRUCTURE_CHECKS) {
    const result = check.check(html);
    items.push({
      id: check.id,
      label: check.label,
      status: result.pass ? 'pass' : 'fail',
      detail: result.detail,
    });
  }

  return {
    passed: items.every(i => i.status === 'pass'),
    items,
  };
}

/**
 * デプロイ前の最終テンプレート検証。
 * 失敗した場合は詳細を返す。
 */
export function runTemplateCheck(html: string): { passed: boolean; failures: string[] } {
  const result = validateArticleTemplate(html);
  const failures = result.items
    .filter(i => i.status === 'fail')
    .map(i => `${i.label}${i.detail ? ` (${i.detail})` : ''}`);
  return { passed: result.passed, failures };
}
