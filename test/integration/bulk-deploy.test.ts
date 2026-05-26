// ============================================================================
// test/integration/bulk-deploy.test.ts
//
// POST /api/articles/bulk-deploy の integration test。
//
// 検証対象 (リグレッション防止):
//   - P5-85: generation_mode='zero' フィルタを Drop していないこと
//     (zero 5 + source 30 → 5 件のみアップロードされる)
//   - 全記事ループが途中終了せず最後まで回ること (5/5 アップロード)
//   - HTML と画像 (image_files) が両方アップロードされること
//   - 正しい remote path に書き出されること
//     (`${remoteBasePath}${slug}/index.html` / `${remoteBasePath}${slug}/images/${position}.jpg`)
//
// 戦略 (vi.mock):
//   - basic-ftp の Client.prototype を vi.mock で差し替え (実 FTP 接続なし)
//   - createServiceRoleClient を制御可能な fixture に差し替え (本番 DB 不使用)
//   - getFtpConfig は固定設定を返す
//   - SLEEP_BETWEEN_ARTICLES_MS の 1.5s 待ちは setTimeout を即時実行に置換
//   - hub-rebuild fetch は global.fetch スタブで吸収
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ─── basic-ftp Client モック ─────────────────────────────────────────────────
// uploadFrom 呼び出しを記録して、後段アサーションで remote path 列を検証する。

interface FtpCall {
  remotePath: string;
  byteLen: number;
}

const ftpState = vi.hoisted(() => ({
  uploads: [] as FtpCall[],
  ensureDirCalls: [] as string[],
  accessCalls: 0,
  closeCalls: 0,
  // article_id ごとに uploadFrom を強制 throw させるための injection 口
  failOnArticleSlug: null as string | null,
}));

vi.mock('basic-ftp', () => {
  class MockClient {
    public ftp = {
      verbose: false,
      log: undefined as unknown,
    };
    constructor(_timeoutMs?: number) {
      // no-op
    }
    async access(_opts: Record<string, unknown>): Promise<void> {
      ftpState.accessCalls += 1;
    }
    async ensureDir(remoteDir: string): Promise<void> {
      ftpState.ensureDirCalls.push(remoteDir);
    }
    async cd(_remote: string): Promise<void> {
      // no-op
    }
    async uploadFrom(
      source: NodeJS.ReadableStream,
      remotePath: string,
    ): Promise<void> {
      // failOnArticleSlug 指定時は対象 slug を含むパスで throw
      if (
        ftpState.failOnArticleSlug &&
        remotePath.includes(`/${ftpState.failOnArticleSlug}/`)
      ) {
        throw new Error(`mock FTP put failure for slug=${ftpState.failOnArticleSlug}`);
      }
      // stream を drain してバイト長を計測
      let byteLen = 0;
      await new Promise<void>((resolve, reject) => {
        source.on('data', (chunk: Buffer | string) => {
          byteLen +=
            typeof chunk === 'string'
              ? Buffer.byteLength(chunk)
              : chunk.length;
        });
        source.on('end', () => resolve());
        source.on('error', (e) => reject(e));
      });
      ftpState.uploads.push({ remotePath, byteLen });
    }
    close(): void {
      ftpState.closeCalls += 1;
    }
  }
  return { Client: MockClient };
});

// ─── ftp-wire-logger モック (副作用回避) ─────────────────────────────────────
vi.mock('@/lib/deploy/ftp-wire-logger', () => ({
  attachFtpWireLogger: vi.fn(),
}));

// ─── getFtpConfig モック (固定値) ────────────────────────────────────────────
vi.mock('@/lib/deploy/ftp-uploader', () => ({
  getFtpConfig: vi.fn(async () => ({
    host: 'ftp.test.local',
    user: 'tester',
    password: 'pw',
    port: 21,
    secure: false,
    remoteBasePath: '/public_html/column/columns/',
  })),
}));

// ─── article-html-builder モック (HTML 生成は別単体テストで保証) ──────────
// bulk-deploy は HTML 文字列を FTP に投げるだけ。本テストではフィクスチャ HTML を返す。
vi.mock('@/lib/deploy/article-html-builder', () => ({
  buildDeployHtml: (article: { id: string; slug?: string | null }) => ({
    html: `<!doctype html><html><body>${article.slug ?? article.id}</body></html>`,
    slug: article.slug ?? article.id,
    charsBeforeReplace: 1000,
  }),
}));

// ─── Supabase クライアントモック ─────────────────────────────────────────────
// articles SELECT に対し fixture を返す。フィルタ (.in / .eq) 呼び出しを記録して
// P5-85 (generation_mode='zero') が確実に発行されているかを別途検証する。

interface FixtureArticle {
  id: string;
  slug: string;
  title: string;
  generation_mode: 'zero' | 'source' | null;
  visibility_state: string;
  image_files: Array<{ url: string; position: string; alt?: string }> | null;
  // bulk-deploy が article をそのまま渡すため、buildDeployHtml モックが要求する最小列のみ
}

const supaState = vi.hoisted(() => ({
  fixtures: [] as FixtureArticle[],
  appliedFilters: [] as Array<{ method: 'in' | 'eq'; col: string; val: unknown }>,
  selectError: null as { message: string } | null,
  authUser: { id: 'user-test-1' } as { id: string } | null,
}));

vi.mock('@/lib/supabase/server', () => {
  function articlesSelectChain() {
    // route 側は: select('*').in('visibility_state', [...]).eq('generation_mode', 'zero').order(...)
    const chain: Record<string, unknown> = {};
    chain.in = vi.fn((col: string, val: unknown) => {
      supaState.appliedFilters.push({ method: 'in', col, val });
      return chain;
    });
    chain.eq = vi.fn((col: string, val: unknown) => {
      supaState.appliedFilters.push({ method: 'eq', col, val });
      return chain;
    });
    chain.order = vi.fn(async () => {
      if (supaState.selectError) {
        return { data: null, error: supaState.selectError };
      }
      // フィルタを fixture に適用 (P5-85 確認のため実際にフィルタする)
      let rows = supaState.fixtures.slice();
      for (const f of supaState.appliedFilters) {
        if (f.method === 'in' && Array.isArray(f.val)) {
          const list = f.val as unknown[];
          rows = rows.filter((r) =>
            list.includes((r as unknown as Record<string, unknown>)[f.col]),
          );
        } else if (f.method === 'eq') {
          rows = rows.filter(
            (r) => (r as unknown as Record<string, unknown>)[f.col] === f.val,
          );
        }
      }
      return { data: rows, error: null };
    });
    return chain;
  }

  function buildClient() {
    return {
      auth: {
        getUser: async () => ({
          data: { user: supaState.authUser },
          error: null,
        }),
      },
      from(table: string) {
        if (table !== 'articles') {
          throw new Error(`bulk-deploy test: unexpected table "${table}"`);
        }
        return {
          select: () => articlesSelectChain(),
        };
      },
    };
  }
  return {
    createServerSupabaseClient: vi.fn(async () => buildClient()),
    createServiceRoleClient: vi.fn(async () => buildClient()),
  };
});

// ─── route import (モック後) ────────────────────────────────────────────────
import { POST } from '@/app/api/articles/bulk-deploy/route';

// ─── ヘルパ ─────────────────────────────────────────────────────────────────

function makeReq(): NextRequest {
  return new NextRequest(
    new Request('http://localhost/api/articles/bulk-deploy', {
      method: 'POST',
    }),
  );
}

function makeArticle(
  i: number,
  mode: 'zero' | 'source',
  imageCount: number | null,
): FixtureArticle {
  const id = `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`;
  const slug = `article-${mode}-${i}`;
  let image_files: FixtureArticle['image_files'] = null;
  if (imageCount !== null) {
    const positions = ['hero', 'body', 'summary'];
    image_files = [];
    for (let k = 0; k < imageCount; k++) {
      image_files.push({
        url: `https://stub.test/img-${slug}-${positions[k]}.jpg`,
        position: positions[k],
      });
    }
  }
  return {
    id,
    slug,
    title: `タイトル ${i}`,
    generation_mode: mode,
    visibility_state: 'live',
    image_files,
  };
}

// ─── テスト本体 ─────────────────────────────────────────────────────────────

describe('POST /api/articles/bulk-deploy (integration)', () => {
  beforeEach(() => {
    // FTP モック state リセット
    ftpState.uploads = [];
    ftpState.ensureDirCalls = [];
    ftpState.accessCalls = 0;
    ftpState.closeCalls = 0;
    ftpState.failOnArticleSlug = null;

    // supabase モック state リセット
    supaState.fixtures = [];
    supaState.appliedFilters = [];
    supaState.selectError = null;
    supaState.authUser = { id: 'user-test-1' };

    // sleep (setTimeout) を即時実行に置換 (1.5s × 5 = 7.5s 短縮)
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: TimerHandler) => {
      if (typeof fn === 'function') fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    // global.fetch スタブ:
    //   - 画像 URL: 32 byte の Buffer を返す
    //   - hub-rebuild URL: ok レスポンス
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/api/hub/deploy')) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        // 画像 stub: 32 byte
        return new Response(new Uint8Array(32), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.BULK_DEPLOY_ZERO_ONLY;
  });

  // ─── TC1: 5 zero-mode → 全 5 件アップロード ──────────────────────────────
  it('TC1: 5 zero-mode 記事すべてアップロード成功 (success=5, errors=[])', async () => {
    for (let i = 1; i <= 5; i++) {
      supaState.fixtures.push(makeArticle(i, 'zero', 3));
    }

    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.total).toBe(5);
    expect(body.success).toBe(5);
    expect(body.failed).toBe(0);
    expect(body.errors).toEqual([]);
    // HTML 5 + 画像 5×3 = 20 ファイル
    expect(body.uploaded_files).toBe(20);

    // 全 5 記事の HTML/images が正しい remote path にアップロードされたか
    const html = ftpState.uploads.filter((u) => u.remotePath.endsWith('/index.html'));
    expect(html).toHaveLength(5);
    for (let i = 1; i <= 5; i++) {
      const slug = `article-zero-${i}`;
      expect(
        ftpState.uploads.some(
          (u) => u.remotePath === `/public_html/column/columns/${slug}/index.html`,
        ),
      ).toBe(true);
      for (const pos of ['hero', 'body', 'summary']) {
        expect(
          ftpState.uploads.some(
            (u) =>
              u.remotePath ===
              `/public_html/column/columns/${slug}/images/${pos}.jpg`,
          ),
        ).toBe(true);
      }
    }
    // 各記事ごとに fresh client を開いている (5 access / 5 close)
    expect(ftpState.accessCalls).toBe(5);
    expect(ftpState.closeCalls).toBe(5);
  });

  // ─── TC2: P5-85/P5-108 フィルタ検証 ──────────────────────────────────────
  // P5-108 (2026-05-17): 既定は全 mode 対象に変更され、zero-only は
  // BULK_DEPLOY_ZERO_ONLY=on で明示選択する方式に。本テストは「zero-only を
  // 要求したとき確実に source-mode を除外する」guard を維持する。
  it('TC2: BULK_DEPLOY_ZERO_ONLY=on で zero 5 + source 30 → zero の 5 件のみ (P5-85 リグレッション防止)', async () => {
    process.env.BULK_DEPLOY_ZERO_ONLY = 'on';
    for (let i = 1; i <= 5; i++) {
      supaState.fixtures.push(makeArticle(i, 'zero', 3));
    }
    for (let i = 100; i < 130; i++) {
      supaState.fixtures.push(makeArticle(i, 'source', 3));
    }

    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.total).toBe(5);
    expect(body.success).toBe(5);
    expect(body.failed).toBe(0);
    expect(body.uploaded_files).toBe(20);

    // route が generation_mode='zero' フィルタを発行しているか
    const eqGen = supaState.appliedFilters.find(
      (f) => f.method === 'eq' && f.col === 'generation_mode',
    );
    expect(eqGen).toBeTruthy();
    expect(eqGen!.val).toBe('zero');

    // visibility_state フィルタも live / live_hub_stale 限定
    const inVis = supaState.appliedFilters.find(
      (f) => f.method === 'in' && f.col === 'visibility_state',
    );
    expect(inVis).toBeTruthy();
    expect(inVis!.val).toEqual(['live', 'live_hub_stale']);

    // FTP に source-mode 記事が一切上がっていない
    const sourceUpload = ftpState.uploads.find((u) =>
      u.remotePath.includes('/article-source-'),
    );
    expect(sourceUpload).toBeUndefined();
  });

  // ─── TC3: image_files === null → HTML のみアップロード ─────────────────
  it('TC3: image_files === null の 1 記事 → HTML のみ uploaded、エラーなし', async () => {
    supaState.fixtures.push(makeArticle(1, 'zero', null));

    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.total).toBe(1);
    expect(body.success).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.errors).toEqual([]);
    expect(body.uploaded_files).toBe(1); // HTML のみ

    // index.html が 1 件、images が 0 件
    const htmlUploads = ftpState.uploads.filter((u) => u.remotePath.endsWith('/index.html'));
    const imgUploads = ftpState.uploads.filter((u) => u.remotePath.includes('/images/'));
    expect(htmlUploads).toHaveLength(1);
    expect(imgUploads).toHaveLength(0);
    expect(htmlUploads[0].remotePath).toBe(
      '/public_html/column/columns/article-zero-1/index.html',
    );
  });

  // ─── TC4: FTP put が 1 件 throw → failed=1 / errors[0] populated ───────
  it('TC4: 1 記事の uploadFrom が throw → failed=1, errors[0] が記録される (ループは継続)', async () => {
    for (let i = 1; i <= 3; i++) {
      supaState.fixtures.push(makeArticle(i, 'zero', 3));
    }
    // 2 番目の記事の uploadFrom を強制失敗させる
    ftpState.failOnArticleSlug = 'article-zero-2';

    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.total).toBe(3);
    // 失敗記事: index.html / 画像 3 枚すべて throw → 1 件 failed
    expect(body.failed).toBe(1);
    expect(body.success).toBe(2);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatchObject({
      slug: 'article-zero-2',
    });
    expect(typeof body.errors[0].message).toBe('string');
    expect(body.errors[0].message.length).toBeGreaterThan(0);

    // 残り 2 件は正常: HTML 2 + 画像 6 = 8 ファイル
    expect(body.uploaded_files).toBe(8);
    // ループが途中で止まっていない (3 記事すべて access が呼ばれている)
    expect(ftpState.accessCalls).toBe(3);
    expect(ftpState.closeCalls).toBe(3);
  });
});
