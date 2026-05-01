import { describe, it, expect } from 'vitest';
import { normalizeStage2Html, deriveStage2ResponseShape } from '@/lib/ai/stage2-html-normalize';

describe('normalizeStage2Html — Gemini 4 形態正規化', () => {
  it('shape=string: そのまま返す', () => {
    expect(normalizeStage2Html('<p>hello</p>')).toBe('<p>hello</p>');
  });

  it('shape=object_html: html プロパティを抽出', () => {
    expect(normalizeStage2Html({ html: '<p>hi</p>' })).toBe('<p>hi</p>');
  });

  it('shape=array_html: 改行で連結', () => {
    expect(normalizeStage2Html(['<p>a</p>', '<p>b</p>'])).toBe('<p>a</p>\n<p>b</p>');
  });

  it('shape=array_object_html: 改行で連結（バグD の主因）', () => {
    expect(
      normalizeStage2Html([{ html: '<p>a</p>' }, { html: '<p>b</p>' }]),
    ).toBe('<p>a</p>\n<p>b</p>');
  });

  it('空配列は空文字', () => {
    expect(normalizeStage2Html([])).toBe('');
  });

  it('null / undefined は空文字', () => {
    expect(normalizeStage2Html(null)).toBe('');
    expect(normalizeStage2Html(undefined)).toBe('');
  });

  it('想定外 object でも全 string value を結合（フォールバック）', () => {
    expect(normalizeStage2Html({ a: '<p>x</p>', b: '<p>y</p>' })).toBe('<p>x</p>\n<p>y</p>');
  });

  it('数値・boolean などは空文字に潰す', () => {
    expect(normalizeStage2Html(42)).toBe('');
    expect(normalizeStage2Html(true)).toBe('');
  });

  it('mix array (string と object_html 混在)', () => {
    expect(normalizeStage2Html(['<p>a</p>', { html: '<p>b</p>' }])).toBe('<p>a</p>\n<p>b</p>');
  });
});

describe('deriveStage2ResponseShape — debug 用 shape 判定', () => {
  it('string → "string"', () => {
    expect(deriveStage2ResponseShape('<p>x</p>')).toBe('string');
  });
  it('{ html } → "object_html"', () => {
    expect(deriveStage2ResponseShape({ html: '<p>x</p>' })).toBe('object_html');
  });
  it('[string] → "array_html"', () => {
    expect(deriveStage2ResponseShape(['<p>a</p>'])).toBe('array_html');
  });
  it('[{ html }] → "array_object_html"', () => {
    expect(deriveStage2ResponseShape([{ html: '<p>a</p>' }])).toBe('array_object_html');
  });
  it('空配列・null・想定外 → "unknown"', () => {
    expect(deriveStage2ResponseShape([])).toBe('unknown');
    expect(deriveStage2ResponseShape(null)).toBe('unknown');
    expect(deriveStage2ResponseShape({})).toBe('unknown');
    expect(deriveStage2ResponseShape(42)).toBe('unknown');
  });
});
