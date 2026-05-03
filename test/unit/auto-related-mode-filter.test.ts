// ============================================================================
// test/unit/auto-related-mode-filter.test.ts
//
// P5-59: 自動関連記事計算における generation_mode 同一フィルタの単体テスト。
//
// 検証対象: src/lib/publish/auto-related.ts の computeAndSaveRelatedArticles()
//
// 振る舞い仕様（auto-related.ts P5-59 ロジック）:
//   - 対象記事と同じ generation_mode を持つ公開済み記事だけを候補にする
//   - 自分自身を除いた同一モード候補が 3 件未満 → related_articles=[] で保存
//   - 同一モード候補が 3 件以上 → 上位 3 件を選定して保存
//   - generation_mode=null は同じく null の記事だけと組合せる（"source" にも
//     "zero" にも分類しない / 別カテゴリ扱い）
//
// テスト戦略:
//   - createServiceRoleClient を vi.mock し、from('articles') の以下 3 系統を捕捉:
//       1) .select(...).eq('id', X).single()  : 対象記事取得
//       2) .select(...).eq('status', 'published') : 公開済み一覧
//       3) .update({related_articles}).eq('id', X) : 保存
//   - update へ渡された related_articles の中身を検証する
// ============================================================================

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// ─── 型定義（ローカル fixture 用） ────────────────────────────────────────────

type Mode = 'zero' | 'source' | null;

interface FixtureArticle {
  id: string;
  slug: string;
  title: string;
  keyword: string;
  generation_mode: Mode;
}

// ─── モック宣言（vi.hoisted で共有） ────────────────────────────────────────

const mocks = vi.hoisted(() => {
  return {
    // 対象記事 1 件分 (single 用)
    targetArticle: null as FixtureArticle | null,
    // 公開済み一覧
    publishedArticles: [] as FixtureArticle[],
    // update 呼び出しキャプチャ
    updateCalls: [] as Array<{
      payload: { related_articles: Array<{ href: string; title: string }> };
      filterId: string;
    }>,
  };
});

vi.mock('@/lib/supabase/server', () => {
  return {
    createServiceRoleClient: vi.fn(async () => ({
      from: (table: string) => {
        if (table !== 'articles') {
          throw new Error(`unexpected table: ${table}`);
        }
        return {
          // SELECT 系
          select: (_cols: string) => ({
            // .eq('id', X).single()  または  .eq('status','published')
            eq: (column: string, value: unknown) => {
              if (column === 'id') {
                // 単一記事取得 (.single() 終端)
                return {
                  single: async () => {
                    const found =
                      mocks.targetArticle &&
                      mocks.targetArticle.id === value
                        ? mocks.targetArticle
                        : null;
                    if (!found) {
                      return {
                        data: null,
                        error: { message: 'not found' },
                      };
                    }
                    return { data: found, error: null };
                  },
                };
              }
              if (column === 'status' && value === 'published') {
                // 公開済み一覧 (await 直接, thenable で返却)
                return {
                  then: (
                    resolve: (v: {
                      data: FixtureArticle[];
                      error: null;
                    }) => unknown,
                  ) =>
                    resolve({
                      data: mocks.publishedArticles,
                      error: null,
                    }),
                };
              }
              throw new Error(
                `unexpected eq: column=${column} value=${String(value)}`,
              );
            },
          }),
          // UPDATE 系
          update: (payload: {
            related_articles: Array<{ href: string; title: string }>;
          }) => ({
            eq: async (column: string, value: unknown) => {
              if (column !== 'id') {
                throw new Error(
                  `unexpected update.eq column: ${column}`,
                );
              }
              mocks.updateCalls.push({
                payload,
                filterId: String(value),
              });
              return { error: null };
            },
          }),
        };
      },
    })),
  };
});

// ─── 動的 import（モック適用後） ─────────────────────────────────────────────

import { computeAndSaveRelatedArticles } from '@/lib/publish/auto-related';

// ─── ヘルパ ─────────────────────────────────────────────────────────────────

function makeArticle(
  id: string,
  mode: Mode,
  keyword = 'スピリチュアル 人生',
): FixtureArticle {
  return {
    id,
    slug: `slug-${id}`,
    title: `${id} のタイトル スピリチュアル 人生 ${mode ?? 'null'}`,
    keyword,
    generation_mode: mode,
  };
}

function getLastSavedRelated(): Array<{ href: string; title: string }> {
  expect(mocks.updateCalls.length).toBeGreaterThan(0);
  return mocks.updateCalls[mocks.updateCalls.length - 1]!.payload
    .related_articles;
}

// ─── テスト ─────────────────────────────────────────────────────────────────

describe('computeAndSaveRelatedArticles — 同一 generation_mode フィルタ (P5-59)', () => {
  beforeEach(() => {
    mocks.targetArticle = null;
    mocks.publishedArticles = [];
    mocks.updateCalls = [];
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'dummy-anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'dummy-service-role';
    // 公開 URL を既定にしておく（getArticleRelativePath が
    // /spiritual/column/{slug}/index.html を返す前提でテスト）
    delete process.env.NEXT_PUBLIC_HUB_PATH;
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. zero-gen 記事は zero-gen 候補のみを使う ──────────────────────────

  it('zero-gen 対象記事は zero-gen 記事のみを候補にする (source は除外)', async () => {
    const target = makeArticle('z-target', 'zero');
    const z1 = makeArticle('z1', 'zero');
    const z2 = makeArticle('z2', 'zero');
    const z3 = makeArticle('z3', 'zero');
    const s1 = makeArticle('s1', 'source');
    const s2 = makeArticle('s2', 'source');
    const s3 = makeArticle('s3', 'source');

    mocks.targetArticle = target;
    // target も published として一覧に含める（自分自身は除外される想定）
    mocks.publishedArticles = [target, z1, z2, z3, s1, s2, s3];

    await computeAndSaveRelatedArticles(target.id);

    const saved = getLastSavedRelated();
    // 上位 3 件すべて zero 由来 (slug-z*)
    expect(saved).toHaveLength(3);
    for (const r of saved) {
      expect(r.href).toMatch(/\/slug-z\d\/index\.html$/);
      expect(r.href).not.toMatch(/\/slug-s\d\//);
    }
  });

  // ─── 2. source-gen 記事は source-gen 候補のみを使う ──────────────────────

  it('source-gen 対象記事は source-gen 記事のみを候補にする (zero は除外)', async () => {
    const target = makeArticle('s-target', 'source');
    const s1 = makeArticle('s1', 'source');
    const s2 = makeArticle('s2', 'source');
    const s3 = makeArticle('s3', 'source');
    const z1 = makeArticle('z1', 'zero');
    const z2 = makeArticle('z2', 'zero');
    const z3 = makeArticle('z3', 'zero');

    mocks.targetArticle = target;
    mocks.publishedArticles = [target, s1, s2, s3, z1, z2, z3];

    await computeAndSaveRelatedArticles(target.id);

    const saved = getLastSavedRelated();
    expect(saved).toHaveLength(3);
    for (const r of saved) {
      expect(r.href).toMatch(/\/slug-s\d\/index\.html$/);
      expect(r.href).not.toMatch(/\/slug-z\d\//);
    }
  });

  // ─── 3. 同一モード候補が 3 件以上 → 上位 3 件 ────────────────────────────

  it('同一モード候補が 3 件以上ある場合、上位 3 件が保存される', async () => {
    const target = makeArticle('z-target', 'zero');
    const z1 = makeArticle('z1', 'zero');
    const z2 = makeArticle('z2', 'zero');
    const z3 = makeArticle('z3', 'zero');
    const z4 = makeArticle('z4', 'zero');
    const z5 = makeArticle('z5', 'zero');

    mocks.targetArticle = target;
    mocks.publishedArticles = [target, z1, z2, z3, z4, z5];

    await computeAndSaveRelatedArticles(target.id);

    const saved = getLastSavedRelated();
    expect(saved).toHaveLength(3);
    // 自分自身は含まれない
    expect(
      saved.every((r) => !r.href.includes('/slug-z-target/')),
    ).toBe(true);
  });

  // ─── 4. 同一モード候補が 0 件 → 空配列 ────────────────────────────────────

  it('同一モード候補が 0 件のとき、related_articles は空配列', async () => {
    const target = makeArticle('z-only', 'zero');

    mocks.targetArticle = target;
    // target 自身しか居らず、他は全部 source
    mocks.publishedArticles = [
      target,
      makeArticle('s1', 'source'),
      makeArticle('s2', 'source'),
      makeArticle('s3', 'source'),
      makeArticle('s4', 'source'),
    ];

    await computeAndSaveRelatedArticles(target.id);

    const saved = getLastSavedRelated();
    expect(saved).toEqual([]);
  });

  // ─── 5. 同一モード候補が 1〜2 件 → 空配列 (足りない) ─────────────────────

  it('同一モード候補が 1〜2 件のとき、related_articles は空配列 (3 未満は不採用)', async () => {
    // 候補が自分以外 2 件しか居ないケース
    const target = makeArticle('z-target', 'zero');
    const z1 = makeArticle('z1', 'zero');
    const z2 = makeArticle('z2', 'zero');

    mocks.targetArticle = target;
    mocks.publishedArticles = [
      target,
      z1,
      z2,
      makeArticle('s1', 'source'),
      makeArticle('s2', 'source'),
    ];

    await computeAndSaveRelatedArticles(target.id);

    const saved = getLastSavedRelated();
    expect(saved).toEqual([]);
  });

  // ─── 6. generation_mode=null は別カテゴリ扱い ─────────────────────────────

  it('generation_mode=null の記事は同じ null 同士でのみ組合せ、source/zero に混入しない', async () => {
    // ケース A: 対象が null。null が他に 3 件以上あれば候補に入る。
    const targetNull = makeArticle('n-target', null);
    const n1 = makeArticle('n1', null);
    const n2 = makeArticle('n2', null);
    const n3 = makeArticle('n3', null);
    const s1 = makeArticle('s1', 'source');
    const s2 = makeArticle('s2', 'source');
    const z1 = makeArticle('z1', 'zero');

    mocks.targetArticle = targetNull;
    mocks.publishedArticles = [targetNull, n1, n2, n3, s1, s2, z1];

    await computeAndSaveRelatedArticles(targetNull.id);

    const savedA = getLastSavedRelated();
    // null 同士 3 件で上位 3 件選定
    expect(savedA).toHaveLength(3);
    for (const r of savedA) {
      expect(r.href).toMatch(/\/slug-n\d\/index\.html$/);
      expect(r.href).not.toMatch(/\/slug-s\d\//);
      expect(r.href).not.toMatch(/\/slug-z\d\//);
    }

    // ケース B: 対象が source の場合、null 記事は候補に入らない (新規分類しない)
    mocks.updateCalls = [];
    const targetSource = makeArticle('s-target', 'source');
    mocks.targetArticle = targetSource;
    mocks.publishedArticles = [
      targetSource,
      makeArticle('n1', null),
      makeArticle('n2', null),
      makeArticle('n3', null),
      makeArticle('n4', null),
      // source は対象以外 0 件
    ];

    await computeAndSaveRelatedArticles(targetSource.id);

    const savedB = getLastSavedRelated();
    // null は混ざらず、source 同一候補は 0 件 → 空配列
    expect(savedB).toEqual([]);
  });
});
