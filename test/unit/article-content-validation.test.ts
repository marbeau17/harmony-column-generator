/**
 * P5-32: article-content validator (Layer 4 schema 契約)
 */
import { describe, it, expect } from 'vitest';
import {
  validateStage2Body,
  validateStage3Final,
  validateArticleContentPayload,
} from '@/lib/validators/article-content';

describe('validateStage2Body', () => {
  it('空文字列は OK', () => {
    expect(validateStage2Body('').ok).toBe(true);
  });

  it('普通の本文 HTML は OK', () => {
    const html = '<p>これは本文です。</p><h2>章</h2><p>段落</p>'.repeat(20);
    expect(validateStage2Body(html).ok).toBe(true);
  });

  it('<!DOCTYPE が含まれていたら reject', () => {
    const html = '<!DOCTYPE html><html>...';
    const r = validateStage2Body(html);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes('DOCTYPE'))).toBe(true);
  });

  it('<header> が含まれていたら reject', () => {
    const html = '<header>サイト</header><p>本文</p>';
    const r = validateStage2Body(html);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes('<header'))).toBe(true);
  });

  it('<footer> が含まれていたら reject', () => {
    const html = '<p>本文</p><footer>Copyright</footer>';
    const r = validateStage2Body(html);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes('<footer'))).toBe(true);
  });

  it('Copyright テキストが含まれていたら reject', () => {
    const html = '<p>本文</p>Copyright © スピリチュアルハーモニー All Rights';
    const r = validateStage2Body(html);
    expect(r.ok).toBe(false);
  });

  it('50K 超は reject', () => {
    const html = '<p>'.padEnd(50_001, 'a') + '</p>';
    const r = validateStage2Body(html);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes('長い'))).toBe(true);
  });
});

describe('validateStage3Final', () => {
  it('空は OK (未生成)', () => {
    expect(validateStage3Final('').ok).toBe(true);
  });

  it('完全 HTML は OK', () => {
    const html =
      '<!DOCTYPE html><html><head><title>x</title></head><body>' +
      '<p>長い本文段落</p>'.repeat(200) +
      '</body></html>';
    expect(validateStage3Final(html).ok).toBe(true);
  });

  it('DOCTYPE が無いと reject', () => {
    const html = '<html><body>' + '<p>'.repeat(200) + '</body></html>';
    const r = validateStage3Final(html);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes('DOCTYPE'))).toBe(true);
  });

  it('1K 未満は reject', () => {
    const html = '<!DOCTYPE html><html><body><p>短い</p></body></html>';
    const r = validateStage3Final(html);
    expect(r.ok).toBe(false);
  });
});

describe('validateArticleContentPayload', () => {
  it('safe なフィールドのみは OK', () => {
    const r = validateArticleContentPayload({
      title: 'タイトル',
      stage2_body_html: '<p>本文</p>'.repeat(50),
    });
    expect(r.ok).toBe(true);
  });

  it('stage2 に template が混入していたら reject', () => {
    const r = validateArticleContentPayload({
      stage2_body_html: '<header>サイト</header><p>本文</p>',
    });
    expect(r.ok).toBe(false);
  });

  it('published_html が body のみで stage3 marker を含まないのは OK', () => {
    const r = validateArticleContentPayload({
      published_html: '<p>本文だけ</p>'.repeat(20),
    });
    expect(r.ok).toBe(true);
  });

  it('published_html に template 混入は reject', () => {
    const r = validateArticleContentPayload({
      published_html: '<!DOCTYPE html><p>x</p>',
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes('published_html'))).toBe(true);
  });

  it('stage3 が body のみ (DOCTYPE 無し) は reject', () => {
    const r = validateArticleContentPayload({
      stage3_final_html: '<p>'.padEnd(2_000, 'a'),
    });
    expect(r.ok).toBe(false);
  });
});
