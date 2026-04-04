import { describe, it, expect } from 'vitest';
import {
  createArticleSchema,
  updateArticleSchema,
  listArticlesQuerySchema,
} from '@/lib/validators/article';

describe('createArticleSchema', () => {
  const validData = {
    keyword: 'スピリチュアル 瞑想',
    theme: 'healing',
    target_persona: 'spiritual_beginner',
  };

  it('正常データが通過する', () => {
    const result = createArticleSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it('空のkeywordを拒否する', () => {
    const result = createArticleSchema.safeParse({ ...validData, keyword: '' });
    expect(result.success).toBe(false);
  });

  it('長すぎるkeywordを拒否する（256文字以上）', () => {
    const result = createArticleSchema.safeParse({
      ...validData,
      keyword: 'あ'.repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it('target_word_countのデフォルト値が2000', () => {
    const result = createArticleSchema.safeParse(validData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.target_word_count).toBe(2000);
    }
  });
});

describe('updateArticleSchema', () => {
  it('titleの更新が通過する', () => {
    const result = updateArticleSchema.safeParse({ title: '新しいタイトル' });
    expect(result.success).toBe(true);
  });

  it('空オブジェクトが通過する', () => {
    const result = updateArticleSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe('listArticlesQuerySchema', () => {
  it('デフォルトlimit=20、offset=0が設定される', () => {
    const result = listArticlesQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });

  it('limitが100を超える値を拒否する', () => {
    const result = listArticlesQuerySchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });
});
