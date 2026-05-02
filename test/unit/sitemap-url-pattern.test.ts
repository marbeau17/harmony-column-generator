/**
 * P5-44: sitemap.ts の記事 URL パターン pin テスト。
 *
 * 目的:
 *   - `src/app/sitemap.ts` が出力する記事 URL が新規約
 *     `{SITE_URL}{HUB_PATH}/{slug}` (= 既定で `https://harmony-mc.com/spiritual/column/{slug}`)
 *     になっていることを保証する。
 *   - 旧形式 `{SITE_URL}/column/{slug}` (`/spiritual` 抜け) が再発した場合に
 *     必ず失敗するよう、ホスト直後 `/column/` の混入を完全排除でアサート。
 *
 * 失敗時の合図:
 *   - sitemap.ts が `${SITE_URL}/column/${slug}` のままなら失敗 → P5-44 で修正必要。
 *   - 修正後 (getSiteUrl()/getHubPath() ベース) はパスする。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── モック宣言 (vi.hoisted で共有) ──────────────────────────────────────────

type FixtureRow = { slug: string; published_at: string; updated_at: string };

const mocks = vi.hoisted(() => {
  return {
    fixture: [] as FixtureRow[],
  };
});

// supabase service-role client の mock
//   chain: from('articles').select(...).eq('status','published').not('slug','is',null)
//          → applyPubliclyVisibleFilter() が .in('visibility_state', [...]) を呼ぶ
//          → .order('published_at', {...}) で { data, error } を返す
vi.mock('@/lib/supabase/server', () => {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    not: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.not.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.order.mockImplementation(() =>
    Promise.resolve({ data: mocks.fixture, error: null }),
  );

  return {
    createServiceRoleClient: vi.fn(async () => ({
      from: (_table: string) => builder,
    })),
  };
});

// THEME_CATEGORIES は import 時に評価されるので実装をそのまま使う。
//   公開 URL ヘルパは使わず sitemap 側のロジック (現状 SITE_URL ハードコード)
//   を素のまま検証するため、ここでは mock しない。

// ─── テスト本体 ────────────────────────────────────────────────────────────

describe('sitemap.ts 記事 URL パターン pin (P5-44)', () => {
  beforeEach(() => {
    // env をデフォルトに固定 (default = https://harmony-mc.com + /column)
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_HUB_PATH', '');
    // supabase 接続条件 (両方 set でないと sitemap.ts は静的ページのみ返す)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

    mocks.fixture = [
      {
        slug: 'test-article-one',
        published_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-04-15T00:00:00.000Z',
      },
      {
        slug: 'another-slug-2',
        published_at: '2026-04-10T00:00:00.000Z',
        updated_at: '2026-04-20T00:00:00.000Z',
      },
    ];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('case 1: 記事 entry が新形式 /column/{slug}/ を含む (canonical と同じ trailing slash)', async () => {
    const { default: sitemap } = await import('@/app/sitemap');
    const entries = await sitemap();

    const articleEntries = entries.filter((e) =>
      mocks.fixture.some((f) => e.url.endsWith(`/${f.slug}/`)),
    );
    expect(articleEntries.length).toBe(mocks.fixture.length);

    for (const f of mocks.fixture) {
      const expected = `https://harmony-mc.com/spiritual/column/${f.slug}/`;
      expect(entries.map((e) => e.url)).toContain(expected);
    }
  });

  it('case 2: 旧形式 .html 拡張子 / /columns/ 複数形バグが一切混入しない', async () => {
    const { default: sitemap } = await import('@/app/sitemap');
    const entries = await sitemap();

    for (const f of mocks.fixture) {
      const badHtml = `https://harmony-mc.com/spiritual/column/${f.slug}.html`;
      const badPlural = `https://harmony-mc.com/columns/${f.slug}/`;
      for (const entry of entries) {
        expect(entry.url).not.toBe(badHtml);
        expect(entry.url).not.toBe(badPlural);
        expect(entry.url).not.toContain('.html');
        expect(entry.url).not.toContain('/columns/');
      }
    }
  });

  it('case 3: getSiteUrl() + getHubPath() の組み合わせで URL が組まれている', async () => {
    const { default: sitemap } = await import('@/app/sitemap');
    const entries = await sitemap();

    const slug = mocks.fixture[0].slug;
    const articleEntry = entries.find((e) => e.url.includes(slug));
    expect(articleEntry).toBeDefined();
    expect(articleEntry!.url).toBe(
      `https://harmony-mc.com/spiritual/column/${slug}/`,
    );
    // .html 拡張子 / /columns/ 複数形が無いこと
    expect(articleEntry!.url).not.toContain('.html');
    expect(articleEntry!.url).not.toContain('/columns/');
  });

  it('case 4: 記事 URL すべてに `/column/` substring が含まれる', async () => {
    const { default: sitemap } = await import('@/app/sitemap');
    const entries = await sitemap();

    const articleUrls = entries
      .map((e) => e.url)
      .filter((u) =>
        mocks.fixture.some((f) => u.endsWith(`/${f.slug}/`)),
      );

    expect(articleUrls.length).toBeGreaterThan(0);
    for (const url of articleUrls) {
      expect(url).toContain('/column/');
      // 複数形 /columns/ や .html 形式に戻っていない
      expect(url).not.toContain('/columns/');
      expect(url).not.toContain('.html');
    }
  });
});
