// ============================================================================
// test/unit/image-prompts-normalizer.test.ts
// normalizeImagePrompt(s) の動作検証 — 過去のサイレント失敗デグレ防止用
// ============================================================================

import { describe, it, expect } from 'vitest';
import {
  normalizeImagePrompt,
  normalizeImagePrompts,
} from '@/lib/content/image-prompts-normalizer';

describe('normalizeImagePrompt — image-prompt.ts 形式', () => {
  it('position + alt_text_ja を含む正常入力を canonical 形式に通す', () => {
    const got = normalizeImagePrompt({
      position: 'hero',
      prompt: '朝露に濡れた白い花',
      alt_text_ja: 'ヒーロー画像',
      caption_ja: '無視されるフィールド',
    });
    expect(got).toEqual({
      position: 'hero',
      prompt: '朝露に濡れた白い花',
      alt: 'ヒーロー画像',
    });
  });

  it('alt_text_ja が無くても OK（alt は空文字）', () => {
    const got = normalizeImagePrompt({ position: 'body', prompt: 'p' });
    expect(got.alt).toBe('');
  });
});

describe('normalizeImagePrompt — stage1-outline.ts 形式 (section_id/heading_text)', () => {
  it('section_id を position として認識', () => {
    const got = normalizeImagePrompt({
      section_id: 'hero',
      prompt: '朝の光',
      heading_text: 'まとめセクションに対応する画像',
      suggested_filename: 'hero.jpg',
    });
    expect(got.position).toBe('hero');
    expect(got.alt).toBe('まとめセクションに対応する画像');
  });

  it('section_id=summary も受け入れる', () => {
    const got = normalizeImagePrompt({ section_id: 'summary', prompt: 'p' });
    expect(got.position).toBe('summary');
  });
});

describe('normalizeImagePrompt — stage1-zero-outline.ts 形式 (slot)', () => {
  it('slot を position として認識', () => {
    const got = normalizeImagePrompt({
      slot: 'hero',
      prompt: '柔らかな朝の光に包まれる人物',
    });
    expect(got).toEqual({
      position: 'hero',
      prompt: '柔らかな朝の光に包まれる人物',
      alt: '',
    });
  });

  it('slot=body / summary も受け入れる', () => {
    expect(normalizeImagePrompt({ slot: 'body', prompt: 'p' }).position).toBe('body');
    expect(normalizeImagePrompt({ slot: 'summary', prompt: 'p' }).position).toBe('summary');
  });

  it('position が同時にある場合は position 優先', () => {
    const got = normalizeImagePrompt({
      position: 'hero',
      slot: 'body',
      prompt: 'p',
    });
    expect(got.position).toBe('hero');
  });

  it('section_id と slot が同時にある場合は section_id 優先', () => {
    const got = normalizeImagePrompt({
      section_id: 'hero',
      slot: 'body',
      prompt: 'p',
    });
    expect(got.position).toBe('hero');
  });
});

describe('normalizeImagePrompt — 不正入力で必ず throw', () => {
  it('null/undefined → throw', () => {
    expect(() => normalizeImagePrompt(null)).toThrow(/object でない/);
    expect(() => normalizeImagePrompt(undefined)).toThrow(/object でない/);
  });

  it('prompt 欠落 → throw', () => {
    expect(() => normalizeImagePrompt({ position: 'hero' })).toThrow(/prompt が空/);
  });

  it('prompt 空文字 → throw', () => {
    expect(() => normalizeImagePrompt({ position: 'hero', prompt: '' })).toThrow(/prompt が空/);
  });

  it('position/section_id/slot すべて欠落 → throw', () => {
    expect(() => normalizeImagePrompt({ prompt: 'p' })).toThrow(/position\/section_id\/slot が未指定/);
  });

  it('position が hero/body/summary 以外 → throw', () => {
    expect(() => normalizeImagePrompt({ position: 'invalid', prompt: 'p' })).toThrow(
      /position 値が不正/,
    );
  });

  it('position=数値 → throw', () => {
    expect(() => normalizeImagePrompt({ position: 123, prompt: 'p' })).toThrow(/未指定/);
  });
});

describe('normalizeImagePrompts (配列)', () => {
  it('3 件すべて image-prompt.ts 形式', () => {
    const got = normalizeImagePrompts([
      { position: 'hero', prompt: 'p1' },
      { position: 'body', prompt: 'p2' },
      { position: 'summary', prompt: 'p3' },
    ]);
    expect(got).toHaveLength(3);
    expect(got.map((g) => g.position)).toEqual(['hero', 'body', 'summary']);
  });

  it('混在形式: stage1 + image-prompt が混じっていても全件通す', () => {
    const got = normalizeImagePrompts([
      { section_id: 'hero', prompt: 'p1', heading_text: 'h1' },
      { position: 'body', prompt: 'p2', alt_text_ja: 'a2' },
    ]);
    expect(got).toEqual([
      { position: 'hero', prompt: 'p1', alt: 'h1' },
      { position: 'body', prompt: 'p2', alt: 'a2' },
    ]);
  });

  it('1 件でも不正があると全体 throw（無音スキップ禁止）', () => {
    expect(() =>
      normalizeImagePrompts([
        { position: 'hero', prompt: 'p1' },
        { position: 'invalid', prompt: 'p2' }, // ← これが不正
        { position: 'summary', prompt: 'p3' },
      ]),
    ).toThrow(/\[1\] 正規化失敗.*position 値が不正/);
  });

  it('配列でない → throw', () => {
    expect(() => normalizeImagePrompts({ not: 'an array' })).toThrow(/配列でない/);
  });
});
