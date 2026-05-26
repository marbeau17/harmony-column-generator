// ============================================================================
// test/unit/image-url-localizer.test.ts
// #4 (拡張子/ホスト非依存の URL 統一) + #5 (画像実在ゲート) の回帰防止
// ============================================================================
import { describe, it, expect } from 'vitest';
import {
  localizeArticleImageUrls,
  checkDeployableImages,
} from '@/lib/deploy/image-url-localizer';

describe('localizeArticleImageUrls (#4)', () => {
  it('.jpg の Supabase URL を ./images/*.jpg に書換', () => {
    const html =
      '<img src="https://abc.supabase.co/storage/v1/object/public/article-images/articles/uuid-1/hero.jpg">';
    expect(localizeArticleImageUrls(html)).toBe('<img src="./images/hero.jpg">');
  });

  it('.png の Supabase URL も ./images/*.jpg に統一する (現行 Gemini は image/png を返す)', () => {
    const html =
      '<img src="https://abc.supabase.co/storage/v1/object/public/article-images/articles/uuid-1/body.png">';
    expect(localizeArticleImageUrls(html)).toBe('<img src="./images/body.jpg">');
  });

  it('.webp も統一する', () => {
    const html =
      '<img src="https://abc.supabase.co/storage/v1/object/public/article-images/articles/uuid-1/summary.webp">';
    expect(localizeArticleImageUrls(html)).toBe('<img src="./images/summary.jpg">');
  });

  it('ホスト (project ref) に依存せず書換する', () => {
    const html =
      '<img src="https://DIFFERENT_PROJECT.supabase.co/storage/v1/object/public/article-images/articles/x/hero.png">';
    expect(localizeArticleImageUrls(html)).toBe('<img src="./images/hero.jpg">');
  });

  it('hero/body/summary を一括で書換する', () => {
    const html = [
      'https://h.supabase.co/storage/v1/object/public/article-images/articles/a/hero.png',
      'https://h.supabase.co/storage/v1/object/public/article-images/articles/a/body.jpg',
      'https://h.supabase.co/storage/v1/object/public/article-images/articles/a/summary.webp',
    ].join(' ');
    expect(localizeArticleImageUrls(html)).toBe(
      './images/hero.jpg ./images/body.jpg ./images/summary.jpg',
    );
  });

  it('プロフィール画像 (article-images/profile/...) は書換しない', () => {
    const html =
      '<img src="https://h.supabase.co/storage/v1/object/public/article-images/profile/author-sketch.jpg">';
    expect(localizeArticleImageUrls(html)).toBe(html);
  });

  it('hero/body/summary 以外の position は書換しない', () => {
    const html =
      '<img src="https://h.supabase.co/storage/v1/object/public/article-images/articles/a/banner.png">';
    expect(localizeArticleImageUrls(html)).toBe(html);
  });
});

describe('checkDeployableImages (#5)', () => {
  it('hero を含む 3 枚 → ok', () => {
    const r = checkDeployableImages([
      { position: 'hero', url: 'https://x/hero.png' },
      { position: 'body', url: 'https://x/body.png' },
      { position: 'summary', url: 'https://x/summary.png' },
    ]);
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('hero 単体でも ok (body/summary は必須ではない)', () => {
    const r = checkDeployableImages([{ position: 'hero', url: 'https://x/hero.jpg' }]);
    expect(r.ok).toBe(true);
  });

  it('空配列 → hero 欠落で ng', () => {
    const r = checkDeployableImages([]);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('hero');
  });

  it('null / 非配列 → ng', () => {
    expect(checkDeployableImages(null).ok).toBe(false);
    expect(checkDeployableImages(undefined).ok).toBe(false);
    expect(checkDeployableImages('garbage').ok).toBe(false);
  });

  it('hero エントリに url が無ければ present 扱いしない', () => {
    const r = checkDeployableImages([{ position: 'hero' }, { position: 'body', url: 'https://x/body.jpg' }]);
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('hero');
    expect(r.present).toEqual(['body']);
  });
});
