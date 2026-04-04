import { describe, it, expect } from 'vitest';
import {
  classifyTheme,
  extractKeywords,
} from '@/lib/content/source-analyzer';

describe('classifyTheme', () => {
  it('「チャクラの開き方」はhealing系テーマに分類される', () => {
    const theme = classifyTheme(
      'チャクラの開き方',
      'チャクラを開くためのヒーリングと瞑想の方法を解説します。エネルギーの流れを整えましょう。',
    );
    expect(theme).toBe('healing');
  });

  it('「ツインレイとの出会い」はrelationships系テーマに分類される', () => {
    const theme = classifyTheme(
      'ツインレイとの出会い',
      'ツインレイとの出会いは魂の縁によるものです。ソウルメイトとの関係性について解説します。',
    );
    expect(theme).toBe('relationships');
  });
});

describe('extractKeywords', () => {
  it('テキストからキーワード配列が返る', () => {
    const text =
      'チャクラの開き方について解説します。チャクラはエネルギーの中心であり、' +
      '瞑想やヒーリングによってチャクラを活性化することができます。' +
      'エネルギーワークを通じてチャクラのバランスを整えましょう。';
    const keywords = extractKeywords(text);
    expect(Array.isArray(keywords)).toBe(true);
    expect(keywords.length).toBeGreaterThan(0);
  });
});
