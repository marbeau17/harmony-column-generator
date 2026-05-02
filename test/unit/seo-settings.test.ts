import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SEO_SETTINGS,
  mergeSeoSettings,
  type SeoSettings,
} from '@/lib/seo/seo-settings';
import {
  generateArticleSchema,
  generatePersonSchema,
  generateFullSchema,
} from '@/lib/seo/structured-data';
import type { Article } from '@/types/article';

const fakeArticle = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  title: 'テスト記事',
  slug: 'test-article',
  meta_description: '説明文',
  keyword: 'テスト, キーワード',
  theme: 'ヒーリングと癒し',
  target_word_count: 2000,
  created_at: '2026-05-02T00:00:00.000Z',
  updated_at: '2026-05-02T01:00:00.000Z',
  published_at: '2026-05-02T00:30:00.000Z',
  faq_data: [{ question: 'Q1', answer: 'A1' }],
  image_files: [{ url: 'https://example.com/img.jpg', alt: 'alt' }],
} as unknown as Article;

describe('mergeSeoSettings — partial を default にマージ', () => {
  it('null/undefined はデフォルトを返す', () => {
    expect(mergeSeoSettings(null)).toEqual(DEFAULT_SEO_SETTINGS);
    expect(mergeSeoSettings(undefined)).toEqual(DEFAULT_SEO_SETTINGS);
  });

  it('一部上書きでも他はデフォルト', () => {
    const got = mergeSeoSettings({ author_name: '由起子' });
    expect(got.author_name).toBe('由起子');
    expect(got.author_job_title).toBe(DEFAULT_SEO_SETTINGS.author_job_title);
    expect(got.site_url).toBe(DEFAULT_SEO_SETTINGS.site_url);
  });

  it('空文字 string はデフォルトを採用 (UI 空欄時の救済)', () => {
    const got = mergeSeoSettings({ author_name: '' });
    expect(got.author_name).toBe(DEFAULT_SEO_SETTINGS.author_name);
  });

  it('boolean false は尊重 (toggle OFF を上書きしない)', () => {
    const got = mergeSeoSettings({ enable_faq_schema: false });
    expect(got.enable_faq_schema).toBe(false);
  });

  it('配列は値を尊重 (空配列も)', () => {
    const got = mergeSeoSettings({ author_same_as: ['https://twitter.com/x'] });
    expect(got.author_same_as).toEqual(['https://twitter.com/x']);

    const empty = mergeSeoSettings({ author_same_as: [] });
    expect(empty.author_same_as).toEqual([]);
  });

  it('Array でない値が配列フィールドに来たら無視', () => {
    const got = mergeSeoSettings({
      // @ts-expect-error: 異常系の型を意図的に渡す
      author_same_as: 'not-array',
    });
    expect(got.author_same_as).toEqual(DEFAULT_SEO_SETTINGS.author_same_as);
  });

  it('未知のキーは無視 (型外プロパティ)', () => {
    const got = mergeSeoSettings({
      // @ts-expect-error: 型外プロパティ
      foo_bar: 'baz',
    });
    expect((got as unknown as Record<string, unknown>).foo_bar).toBeUndefined();
  });
});

describe('generateArticleSchema — settings が反映される', () => {
  it('settings 未指定でも DEFAULT で動く (regression 0)', () => {
    const got = generateArticleSchema(fakeArticle);
    expect((got.author as Record<string, string>).name).toBe(
      DEFAULT_SEO_SETTINGS.author_name,
    );
    expect((got.publisher as Record<string, string>).name).toBe(
      DEFAULT_SEO_SETTINGS.publisher_name,
    );
    expect(got.url).toBe(`${DEFAULT_SEO_SETTINGS.site_url}/column/test-article`);
  });

  it('settings の author_name / publisher_name が反映される', () => {
    const settings: SeoSettings = {
      ...DEFAULT_SEO_SETTINGS,
      author_name: 'カスタム著者',
      publisher_name: 'カスタム発行元',
      site_url: 'https://example.com',
    };
    const got = generateArticleSchema(fakeArticle, settings);
    expect((got.author as Record<string, string>).name).toBe('カスタム著者');
    expect((got.publisher as Record<string, string>).name).toBe('カスタム発行元');
    expect(got.url).toBe('https://example.com/column/test-article');
  });
});

describe('generatePersonSchema — sameAs 重複除去 + image / bio 任意', () => {
  it('sameAs に profile_url を含み重複しない', () => {
    const settings: SeoSettings = {
      ...DEFAULT_SEO_SETTINGS,
      author_profile_url: 'https://example.com/profile',
      author_same_as: [
        'https://example.com/profile', // duplicate of profile_url
        'https://twitter.com/x',
      ],
    };
    const got = generatePersonSchema(settings);
    expect(got.sameAs).toEqual([
      'https://example.com/profile',
      'https://twitter.com/x',
    ]);
  });

  it('image_url / bio が空文字なら出力 schema に含まれない', () => {
    const got = generatePersonSchema(DEFAULT_SEO_SETTINGS);
    expect(got.image).toBeUndefined();
    expect(got.description).toBeUndefined();
  });

  it('image_url / bio がある場合は含まれる', () => {
    const settings: SeoSettings = {
      ...DEFAULT_SEO_SETTINGS,
      author_image_url: 'https://example.com/me.jpg',
      author_bio: 'テスト bio',
    };
    const got = generatePersonSchema(settings);
    expect(got.image).toBe('https://example.com/me.jpg');
    expect(got.description).toBe('テスト bio');
  });
});

describe('generateFullSchema — enable_* トグル', () => {
  const allOff: SeoSettings = {
    ...DEFAULT_SEO_SETTINGS,
    enable_article_schema: false,
    enable_faq_schema: false,
    enable_breadcrumb_schema: false,
    enable_person_schema: false,
  };

  it('全 OFF なら @graph が空配列', () => {
    const json = generateFullSchema(fakeArticle, allOff);
    const obj = JSON.parse(json) as { '@graph': unknown[] };
    expect(obj['@graph']).toEqual([]);
  });

  it('一部 OFF: 当該 schema が除外される', () => {
    const settings = { ...DEFAULT_SEO_SETTINGS, enable_faq_schema: false };
    const json = generateFullSchema(fakeArticle, settings);
    const obj = JSON.parse(json) as { '@graph': Array<{ '@type': string }> };
    const types = obj['@graph'].map((s) => s['@type']);
    expect(types).toContain('Article');
    expect(types).toContain('Person');
    expect(types).toContain('BreadcrumbList');
    expect(types).not.toContain('FAQPage');
  });

  it('FAQ データが空なら enable=true でも FAQPage は出ない', () => {
    const noFaq = { ...fakeArticle, faq_data: [] } as unknown as Article;
    const json = generateFullSchema(noFaq, DEFAULT_SEO_SETTINGS);
    const obj = JSON.parse(json) as { '@graph': Array<{ '@type': string }> };
    expect(obj['@graph'].map((s) => s['@type'])).not.toContain('FAQPage');
  });

  it('settings 未指定 (デフォルト) で従来通り 4 schema が出る', () => {
    const json = generateFullSchema(fakeArticle);
    const obj = JSON.parse(json) as { '@graph': Array<{ '@type': string }> };
    const types = obj['@graph'].map((s) => s['@type']);
    expect(types).toEqual(['Article', 'Person', 'BreadcrumbList', 'FAQPage']);
  });

  it('breadcrumb_section_url が絶対 URL でなければ site_url と結合', () => {
    const json = generateFullSchema(fakeArticle, {
      ...DEFAULT_SEO_SETTINGS,
      site_url: 'https://example.com',
      breadcrumb_section_url: '/my-section',
    });
    const obj = JSON.parse(json) as {
      '@graph': Array<{
        '@type': string;
        itemListElement?: Array<{ name: string; item: string }>;
      }>;
    };
    const breadcrumb = obj['@graph'].find((s) => s['@type'] === 'BreadcrumbList');
    expect(breadcrumb?.itemListElement?.[1]?.item).toBe(
      'https://example.com/my-section',
    );
  });

  it('breadcrumb_section_url が絶対 URL ならそのまま使う', () => {
    const json = generateFullSchema(fakeArticle, {
      ...DEFAULT_SEO_SETTINGS,
      breadcrumb_section_url: 'https://other-domain.com/section',
    });
    const obj = JSON.parse(json) as {
      '@graph': Array<{
        '@type': string;
        itemListElement?: Array<{ name: string; item: string }>;
      }>;
    };
    const breadcrumb = obj['@graph'].find((s) => s['@type'] === 'BreadcrumbList');
    expect(breadcrumb?.itemListElement?.[1]?.item).toBe(
      'https://other-domain.com/section',
    );
  });
});
