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

// ─── インライン <script> 構文検証 ─────────────────────────────────────────
// 背景: 2026-05-24 に NEXT_PUBLIC_GA_ID env var の末尾改行が
//   gtag('config', 'G-TH2X...\n') として inline script に展開され、
//   本番ハブで Uncaught SyntaxError: Invalid or unexpected token を発生させた。
//   既存の runTemplateCheck は <script> タグの「存在」だけ見て中身を構文検証して
//   いなかった。Node 組込みの `new Function(body)` はコード本体をコンパイルだけ
//   して実行はしないため、SyntaxError を確実に捕捉できる (依存追加不要)。
//
// 仕様:
//   - <script src="..."> は外部読み込みなのでスキップ (中身が無い / 別経路で検証)
//   - <script type="application/ld+json"> は JSON 構造化データなので JSON.parse で検証
//   - 上記以外 (= 実行される inline JS) は new Function('"use strict";' + body) で検証
//   - 1 つでも構文エラーがあれば全体を fail とし、行頭 80 字までを detail に出す

const SCRIPT_TAG_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const SRC_ATTR_RE = /\bsrc\s*=\s*["'][^"']+["']/i;
const TYPE_JSONLD_RE = /\btype\s*=\s*["']application\/ld\+json["']/i;

interface InlineScript {
  index: number; // ファイル中の出現順 (1-based)
  kind: 'js' | 'jsonld';
  attrs: string;
  body: string;
}

function extractInlineScripts(html: string): InlineScript[] {
  const out: InlineScript[] = [];
  let m: RegExpExecArray | null;
  let idx = 0;
  SCRIPT_TAG_RE.lastIndex = 0;
  while ((m = SCRIPT_TAG_RE.exec(html)) !== null) {
    idx++;
    const attrs = m[1] ?? '';
    const body = m[2] ?? '';
    if (SRC_ATTR_RE.test(attrs)) continue; // 外部 src は中身なし
    if (!body.trim()) continue; // 空 body は検証対象外
    const kind: InlineScript['kind'] = TYPE_JSONLD_RE.test(attrs) ? 'jsonld' : 'js';
    out.push({ index: idx, kind, attrs: attrs.trim(), body });
  }
  return out;
}

interface ScriptCheckResult {
  passed: boolean;
  failures: string[];
}

export function validateInlineScripts(html: string): ScriptCheckResult {
  const failures: string[] = [];
  const scripts = extractInlineScripts(html);
  for (const s of scripts) {
    if (s.kind === 'jsonld') {
      try {
        JSON.parse(s.body);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failures.push(`script#${s.index} (JSON-LD) parse 失敗: ${msg.slice(0, 80)}`);
      }
      continue;
    }
    // 実行される inline JS の構文検証。実行はしない (コンパイルのみ)。
    try {
      // eslint-disable-next-line no-new-func -- syntax validation only; the function is never invoked
      new Function('"use strict";' + s.body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 改行や生制御文字を含む body は head の先頭 60 字を併記して特定しやすくする
      const head = s.body.replace(/\s+/g, ' ').trim().slice(0, 60);
      failures.push(`script#${s.index} 構文エラー: ${msg.slice(0, 80)} | head=${head}`);
    }
  }
  return { passed: failures.length === 0, failures };
}

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

  // インライン <script> 構文検証 (P5: GA env 改行型バグ予防)
  const scriptCheck = validateInlineScripts(html);
  items.push({
    id: 'inline_script_syntax',
    label: 'inline <script> 構文エラー 0',
    status: scriptCheck.passed ? 'pass' : 'fail',
    detail: scriptCheck.passed ? undefined : scriptCheck.failures.slice(0, 3).join(' / '),
  });

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
