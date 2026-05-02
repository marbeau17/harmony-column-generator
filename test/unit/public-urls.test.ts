import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getArticleRelativePath,
  getArticleUrl,
  getHubPath,
  getHubUrl,
  getOgImageUrl,
  getSiteUrl,
} from '@/lib/config/public-urls';

/**
 * P5-44: public-urls ヘルパーの単体テスト。
 * env 駆動の URL 生成が default / カスタム双方で正しく動作し、
 * trailing slash 等のノーマライズが効くことを検証する。
 */
describe('public-urls helper', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // --- getSiteUrl --------------------------------------------------------
  describe('getSiteUrl', () => {
    it('env 未設定なら default ホストを返す', () => {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
      expect(getSiteUrl()).toBe('https://harmony-mc.com');
    });

    it('カスタム env をそのまま返す', () => {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://staging.example.com');
      expect(getSiteUrl()).toBe('https://staging.example.com');
    });

    it('末尾スラッシュは正規化される', () => {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://harmony-mc.com///');
      expect(getSiteUrl()).toBe('https://harmony-mc.com');
    });
  });

  // --- getHubPath --------------------------------------------------------
  describe('getHubPath', () => {
    it('env 未設定なら default パスを返す', () => {
      vi.stubEnv('NEXT_PUBLIC_HUB_PATH', '');
      expect(getHubPath()).toBe('/column');
    });

    it('先頭スラッシュ無しでも自動付与される', () => {
      vi.stubEnv('NEXT_PUBLIC_HUB_PATH', 'blog/articles');
      expect(getHubPath()).toBe('/blog/articles');
    });

    it('末尾スラッシュは正規化される', () => {
      vi.stubEnv('NEXT_PUBLIC_HUB_PATH', '/blog/articles///');
      expect(getHubPath()).toBe('/blog/articles');
    });
  });

  // --- getHubUrl ---------------------------------------------------------
  describe('getHubUrl', () => {
    it('default 値で page 1 のハブ URL を返す', () => {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
      vi.stubEnv('NEXT_PUBLIC_HUB_PATH', '');
      expect(getHubUrl()).toBe('https://harmony-mc.com/column/');
    });

    it('page 2 以降は /page/{N}/ が付く', () => {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
      vi.stubEnv('NEXT_PUBLIC_HUB_PATH', '');
      expect(getHubUrl(2)).toBe('https://harmony-mc.com/column/page/2/');
      expect(getHubUrl(7)).toBe('https://harmony-mc.com/column/page/7/');
    });

    it('カスタム env でも組み立てが正しい', () => {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://staging.example.com');
      vi.stubEnv('NEXT_PUBLIC_HUB_PATH', '/blog');
      expect(getHubUrl(1)).toBe('https://staging.example.com/blog/');
      expect(getHubUrl(3)).toBe('https://staging.example.com/blog/page/3/');
    });
  });

  // --- getArticleUrl -----------------------------------------------------
  describe('getArticleUrl', () => {
    it('default 値で記事 canonical を返す', () => {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
      vi.stubEnv('NEXT_PUBLIC_HUB_PATH', '');
      expect(getArticleUrl('hello-world')).toBe(
        'https://harmony-mc.com/column/hello-world/'
      );
    });

    it('カスタム env でも記事 canonical が組み立たる', () => {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://staging.example.com');
      vi.stubEnv('NEXT_PUBLIC_HUB_PATH', '/blog');
      expect(getArticleUrl('my-slug')).toBe('https://staging.example.com/blog/my-slug/');
    });
  });

  // --- getOgImageUrl -----------------------------------------------------
  describe('getOgImageUrl', () => {
    it('default position は hero', () => {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
      vi.stubEnv('NEXT_PUBLIC_HUB_PATH', '');
      expect(getOgImageUrl('hello-world')).toBe(
        'https://harmony-mc.com/column/hello-world/images/hero.jpg'
      );
    });

    it('position を明示するとそのファイル名を組み立てる', () => {
      vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
      vi.stubEnv('NEXT_PUBLIC_HUB_PATH', '');
      expect(getOgImageUrl('hello-world', 'body')).toBe(
        'https://harmony-mc.com/column/hello-world/images/body.jpg'
      );
      expect(getOgImageUrl('hello-world', 'summary')).toBe(
        'https://harmony-mc.com/column/hello-world/images/summary.jpg'
      );
    });
  });

  // --- getArticleRelativePath -------------------------------------------
  describe('getArticleRelativePath', () => {
    it('default ハブパスを使った相対パスを返す', () => {
      vi.stubEnv('NEXT_PUBLIC_HUB_PATH', '');
      expect(getArticleRelativePath('hello-world')).toBe('/column/hello-world/');
    });

    it('カスタムハブパスでも相対パスが組み立たる', () => {
      vi.stubEnv('NEXT_PUBLIC_HUB_PATH', '/blog/articles');
      expect(getArticleRelativePath('my-slug')).toBe('/blog/articles/my-slug/');
    });
  });
});
