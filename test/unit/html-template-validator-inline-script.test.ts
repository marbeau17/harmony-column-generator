/**
 * validateInlineScripts() / validateArticleTemplate() inline script syntax pin
 *
 * 背景:
 *   2026-05-24 本番事故 — Vercel env var `NEXT_PUBLIC_GA_ID` が末尾改行付きで
 *   設定されており、hub-generator/article-html-generator の inline script
 *   テンプレートリテラル `gtag('config', '${GA4_ID}')` に生 \n が混入。
 *   本番ハブで Uncaught SyntaxError: Invalid or unexpected token を発生。
 *
 *   runTemplateCheck は <script> タグの「存在」しか検証していなかったため
 *   通り抜けた。本テストは `validateInlineScripts` が
 *   (1) 正常な inline JS を pass
 *   (2) 改行混入による文字列リテラル破損を fail
 *   (3) src=外部読み込みはスキップ
 *   (4) JSON-LD を JSON.parse で別経路検証
 *   することを pin する。
 */
import { describe, expect, it } from 'vitest';
import {
  validateInlineScripts,
  validateArticleTemplate,
} from '@/lib/content/html-template-validator';

describe('validateInlineScripts', () => {
  it('正常な inline JS は pass', () => {
    const html = `<html><body>
      <script>window.dataLayer = window.dataLayer || [];gtag('config', 'G-ABCD1234');</script>
    </body></html>`;
    const r = validateInlineScripts(html);
    expect(r.passed).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('文字列リテラル内の生改行 (今回の GA バグ) を fail として検出', () => {
    // GA_ID 末尾改行で `'G-X...\n'` のように展開された状態を再現
    const html = `<html><body>
      <script>gtag('config', 'G-TH2XJ24V3T
');</script>
    </body></html>`;
    const r = validateInlineScripts(html);
    expect(r.passed).toBe(false);
    expect(r.failures.length).toBe(1);
    expect(r.failures[0]).toMatch(/構文エラー/);
  });

  it('外部 src 読み込み <script src="..."> は中身チェックをスキップ', () => {
    const html = `<html><body>
      <script async src="https://example.com/x.js"></script>
    </body></html>`;
    const r = validateInlineScripts(html);
    expect(r.passed).toBe(true);
  });

  it('空の <script></script> は対象外', () => {
    const html = `<html><body><script></script></body></html>`;
    const r = validateInlineScripts(html);
    expect(r.passed).toBe(true);
  });

  it('複数 script があり 1 つ壊れていれば fail', () => {
    const html = `<html><body>
      <script>const a = 1;</script>
      <script>const broken = 'oops
';</script>
      <script>const b = 2;</script>
    </body></html>`;
    const r = validateInlineScripts(html);
    expect(r.passed).toBe(false);
    expect(r.failures.length).toBe(1);
    // 2 つ目 (index=2) で fail することを確認
    expect(r.failures[0]).toMatch(/script#2/);
  });

  it('JSON-LD は JSON.parse で検証', () => {
    const okHtml = `<html><head>
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article"}</script>
    </head></html>`;
    expect(validateInlineScripts(okHtml).passed).toBe(true);

    const ngHtml = `<html><head>
      <script type="application/ld+json">{"@context": "https://schema.org",}</script>
    </head></html>`;
    expect(validateInlineScripts(ngHtml).passed).toBe(false);
  });
});

describe('validateArticleTemplate inline_script_syntax integration', () => {
  it('壊れた inline script が混入すると items に inline_script_syntax: fail が現れる', () => {
    // テンプレート要素は最小限で OK、ここで見たいのは inline_script_syntax のみ
    const html = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="x"><title>x</title>
<link rel="canonical" href="x"><meta property="og:title" content="x"><meta property="og:description" content="x">
<meta property="og:image" content="x"><meta name="twitter:card" content="x">
<script type="application/ld+json">{"@context":"https://schema.org"}</script>
<script>gtag('config', 'G-X
');</script>
</head>
<body>
<div id="siteHeader"><nav class="breadcrumb"></nav></div>
<div class="article-hero"><img alt="x" src="x"></div>
<article class="article-body"><h2>a</h2><h2>b</h2>${'本文'.repeat(200)}</article>
<div class="article-author"></div>
<div class="sticky-cta-bar"></div>
<script>window.gtag=function(){};</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=x"></script>
<link rel="stylesheet" href="hub.css">
</body></html>`;
    const result = validateArticleTemplate(html);
    const inline = result.items.find((i) => i.id === 'inline_script_syntax');
    expect(inline).toBeDefined();
    expect(inline?.status).toBe('fail');
    expect(result.passed).toBe(false);
  });
});
