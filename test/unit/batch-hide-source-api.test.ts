// ============================================================================
// test/unit/batch-hide-source-api.test.ts
// POST /api/articles/batch-hide-source の単体テスト
//
// 検証ケース (8 件):
//   1. 認証なし → 401
//   2. PUBLISH_CONTROL_V2 未設定 → 404
//   3. body.confirm が 'HIDE_ALL_SOURCE' でない → 400
//   4. dry_run=true で対象 5 件 → { hidden:0, ids:[...5件], dry_run:true } 200
//   5. dry_run=false で対象 5 件 → 全 UPDATE 成功 + softWithdraw 5 回 + publish_events 5 件
//      + ハブ再生成 → { hidden:5, ids, hub_rebuild_status:'ok' } 200
//   6. 一部失敗 (softWithdraw 1 件 throw) → 部分成功、{ hidden:4, failed:1 ... } 207
//   7. PUBLISH_CONTROL_FTP=off → softWithdraw / rebuildHub は呼ばれず、DB UPDATE のみ
//   8. articles UPDATE payload に html_body / title 等が含まれない (本文への書込み無し)
//
// 実装方針:
//   - 外部依存 (Supabase / ftp-uploader / hub-rebuild-client / logger) を vi.mock で stub
//   - production code は変更しない (テストのみ作成)
// ============================================================================

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { NextRequest } from 'next/server';

// ─── hoisted mocks ─────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  authGetUserMock: vi.fn(),
  // service-role supabase 用
  selectChainMock: vi.fn(),     // .select(...).eq(...).or(...) の最終結果を返す
  articlesUpdateMock: vi.fn(),  // .update(...).eq(...) の結果を返す
  publishEventsInsertMock: vi.fn(),
  // FTP / hub
  getFtpConfigMock: vi.fn(),
  softWithdrawFileMock: vi.fn(),
  fetchMock: vi.fn(),
  // テスト中に articles.update 呼び出し時の payload を記録
  articlesUpdatePayloads: [] as Array<Record<string, unknown>>,
  publishEventsInsertPayloads: [] as Array<Record<string, unknown>>,
}));

// ─── supabase mocks ─────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.authGetUserMock },
  })),
  createServiceRoleClient: vi.fn(async () => ({
    from: (table: string) => {
      if (table === 'articles') {
        return {
          // batch-hide.ts の select chain: .select(...).eq(...).or(...)
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => ({
              or: async (_filter: string) => mocks.selectChainMock(),
            }),
          }),
          // batch-hide.ts の update chain: .update(payload).eq('id', id)
          update: (payload: Record<string, unknown>) => {
            mocks.articlesUpdatePayloads.push(payload);
            return {
              eq: async (_col: string, id: string) =>
                mocks.articlesUpdateMock(payload, id),
            };
          },
        };
      }
      if (table === 'publish_events') {
        return {
          insert: async (payload: Record<string, unknown>) => {
            mocks.publishEventsInsertPayloads.push(payload);
            return mocks.publishEventsInsertMock(payload);
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  })),
}));

vi.mock('@/lib/deploy/ftp-uploader', () => ({
  getFtpConfig: mocks.getFtpConfigMock,
  softWithdrawFile: mocks.softWithdrawFileMock,
}));

// hub-rebuild-client は route 経由では使われない (route は fetch(...) で /api/hub/deploy を叩く)
// ただし依存関係グラフに紛れ込むケースに備えて空の stub を置く
vi.mock('@/lib/deploy/hub-rebuild-client', () => ({
  rebuildHub: vi.fn(async () => ({ success: true, pages: 1, articles: 5, uploaded: 5, durationMs: 1 })),
  formatHubRebuildResult: (_r: unknown) => 'ok',
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── route import (mock 設定後) ────────────────────────────────────────────

import { POST } from '@/app/api/articles/batch-hide-source/route';

// ─── alias ─────────────────────────────────────────────────────────────────

const authGetUserMock = mocks.authGetUserMock;
const selectChainMock = mocks.selectChainMock;
const articlesUpdateMock = mocks.articlesUpdateMock;
const publishEventsInsertMock = mocks.publishEventsInsertMock;
const getFtpConfigMock = mocks.getFtpConfigMock;
const softWithdrawFileMock = mocks.softWithdrawFileMock;

// ─── fixtures ──────────────────────────────────────────────────────────────

const FIVE_TARGETS = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000001', slug: 'art-1', seo_filename: null, title: 'タイトル1', generation_mode: 'source', is_hub_visible: true },
  { id: 'aaaaaaaa-0000-0000-0000-000000000002', slug: 'art-2', seo_filename: null, title: 'タイトル2', generation_mode: 'source', is_hub_visible: true },
  { id: 'aaaaaaaa-0000-0000-0000-000000000003', slug: 'art-3', seo_filename: null, title: 'タイトル3', generation_mode: null,     is_hub_visible: true },
  { id: 'aaaaaaaa-0000-0000-0000-000000000004', slug: 'art-4', seo_filename: null, title: 'タイトル4', generation_mode: 'source', is_hub_visible: true },
  { id: 'aaaaaaaa-0000-0000-0000-000000000005', slug: 'art-5', seo_filename: null, title: 'タイトル5', generation_mode: 'source', is_hub_visible: true },
];

function buildPostRequest(body: unknown, opts: { rawJson?: string } = {}): NextRequest {
  // NextRequest は独自 RequestInit を要求するため as unknown キャストで型整合させる
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'sb-test=ok' },
    body: opts.rawJson ?? JSON.stringify(body),
  } as unknown as ConstructorParameters<typeof NextRequest>[1];
  return new NextRequest('http://localhost:3000/api/articles/batch-hide-source', init);
}

// ─── env helpers ───────────────────────────────────────────────────────────

const ENV_SNAPSHOT: Record<string, string | undefined> = {};
const TRACKED_ENV = ['PUBLISH_CONTROL_V2', 'PUBLISH_CONTROL_FTP'];

function snapshotEnv(): void {
  for (const k of TRACKED_ENV) ENV_SNAPSHOT[k] = process.env[k];
}
function restoreEnv(): void {
  for (const k of TRACKED_ENV) {
    const v = ENV_SNAPSHOT[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// ─── helpers to seed mocks ─────────────────────────────────────────────────

function seedAuth(authed: boolean): void {
  authGetUserMock.mockResolvedValue(
    authed
      ? { data: { user: { id: 'user-1', email: 'test@example.com' } } }
      : { data: { user: null } },
  );
}

function seedSelectRows(rows: typeof FIVE_TARGETS | []): void {
  selectChainMock.mockResolvedValue({ data: rows, error: null });
}

function seedUpdateOk(): void {
  articlesUpdateMock.mockResolvedValue({ error: null });
}

function seedInsertOk(): void {
  publishEventsInsertMock.mockResolvedValue({ error: null });
}

function seedFtpConfig(): void {
  getFtpConfigMock.mockResolvedValue({
    host: 'ftp.example.com',
    user: 'u',
    password: 'p',
    secure: false,
    remoteRoot: '/htdocs/column',
  });
}

function seedSoftWithdrawAllOk(): void {
  softWithdrawFileMock.mockResolvedValue({ success: true, errors: [] });
}

// ─── tests ─────────────────────────────────────────────────────────────────

describe('POST /api/articles/batch-hide-source', () => {
  beforeEach(() => {
    snapshotEnv();
    // 既定: PUBLISH_CONTROL_V2=on (404 抑制)
    process.env.PUBLISH_CONTROL_V2 = 'on';
    process.env.PUBLISH_CONTROL_FTP = 'on';

    // 各 mock をクリア
    authGetUserMock.mockReset();
    selectChainMock.mockReset();
    articlesUpdateMock.mockReset();
    publishEventsInsertMock.mockReset();
    getFtpConfigMock.mockReset();
    softWithdrawFileMock.mockReset();
    mocks.fetchMock.mockReset();
    mocks.articlesUpdatePayloads.length = 0;
    mocks.publishEventsInsertPayloads.length = 0;

    // route 内の hub-rebuild は fetch(`${origin}/api/hub/deploy`) で発火する
    // 既定では ok レスポンスを返す
    mocks.fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', mocks.fetchMock);
  });

  afterEach(() => {
    restoreEnv();
    vi.unstubAllGlobals();
  });

  // ─── Case 1: 認証なし → 401 ────────────────────────────────────────────
  it('1) 認証なしの場合は 401 を返す', async () => {
    seedAuth(false);
    const res = await POST(buildPostRequest({ confirm: 'HIDE_ALL_SOURCE' }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('unauthorized');
  });

  // ─── Case 2: PUBLISH_CONTROL_V2 未設定 → 404 ───────────────────────────
  it('2) PUBLISH_CONTROL_V2 が on でない場合は 404 を返す', async () => {
    delete process.env.PUBLISH_CONTROL_V2;
    seedAuth(true);
    const res = await POST(buildPostRequest({ confirm: 'HIDE_ALL_SOURCE' }));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('not found');
    // 404 は機能フラグで先に弾かれるので auth 取得は行われていない
    expect(authGetUserMock).not.toHaveBeenCalled();
  });

  // ─── Case 3: confirm 不正 → 400 ────────────────────────────────────────
  it("3) body.confirm が 'HIDE_ALL_SOURCE' でない場合は 400 を返す", async () => {
    seedAuth(true);
    const res = await POST(buildPostRequest({ confirm: 'NOPE' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid body');
    // バリデ失敗時は select も update も呼ばれない
    expect(selectChainMock).not.toHaveBeenCalled();
    expect(articlesUpdateMock).not.toHaveBeenCalled();
  });

  // ─── Case 4: dry_run=true → 200 + ids 5 件 ────────────────────────────
  it('4) dry_run=true で対象 5 件の場合 hidden:0, ids:[...5件], dry_run:true を返す', async () => {
    seedAuth(true);
    seedSelectRows(FIVE_TARGETS);

    const res = await POST(buildPostRequest({ confirm: 'HIDE_ALL_SOURCE', dry_run: true }));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.dry_run).toBe(true);
    expect(json.candidates).toBe(5);
    expect(json.hidden).toBe(0);
    expect(Array.isArray(json.ids)).toBe(true);
    expect(json.ids).toHaveLength(5);
    expect(json.ids).toEqual(FIVE_TARGETS.map((r) => r.id));
    expect(json.hub_rebuild_status).toBe('skipped');

    // dry_run なので update / softWithdraw / publish_events / fetch は呼ばれない
    expect(articlesUpdateMock).not.toHaveBeenCalled();
    expect(softWithdrawFileMock).not.toHaveBeenCalled();
    expect(publishEventsInsertMock).not.toHaveBeenCalled();
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  // ─── Case 5: dry_run=false 全件成功 → 200 + hub ok ─────────────────────
  it('5) dry_run=false で対象 5 件すべて成功した場合、UPDATE×5 + softWithdraw×5 + publish_events×5 + hub再生成 ok', async () => {
    seedAuth(true);
    seedSelectRows(FIVE_TARGETS);
    seedUpdateOk();
    seedInsertOk();
    seedFtpConfig();
    seedSoftWithdrawAllOk();

    const res = await POST(buildPostRequest({ confirm: 'HIDE_ALL_SOURCE' }));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.dry_run).toBe(false);
    expect(json.candidates).toBe(5);
    expect(json.hidden).toBe(5);
    expect(json.ids).toHaveLength(5);
    expect(json.succeeded_ids).toHaveLength(5);
    expect(json.failures).toEqual([]);
    expect(json.hub_rebuild_status).toBe('ok');

    expect(articlesUpdateMock).toHaveBeenCalledTimes(5);
    expect(softWithdrawFileMock).toHaveBeenCalledTimes(5);
    expect(publishEventsInsertMock).toHaveBeenCalledTimes(5);
    // ハブ再生成は origin/api/hub/deploy を 1 回叩く
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    const fetchUrl = mocks.fetchMock.mock.calls[0][0] as string;
    expect(fetchUrl).toMatch(/\/api\/hub\/deploy$/);

    // publish_events の payload に reason='batch-hide-source' / action='unpublish' が含まれる
    for (const evt of mocks.publishEventsInsertPayloads) {
      expect(evt.action).toBe('unpublish');
      expect(evt.reason).toBe('batch-hide-source');
      expect(evt.actor_email).toBe('test@example.com');
    }
  });

  // ─── Case 6: softWithdraw 1 件 throw → 207 部分成功 ────────────────────
  it('6) softWithdraw が 1 件で throw した場合、部分成功で 207 を返す', async () => {
    seedAuth(true);
    seedSelectRows(FIVE_TARGETS);
    seedUpdateOk();
    seedInsertOk();
    seedFtpConfig();

    // 3 件目だけ throw、他は success
    softWithdrawFileMock.mockImplementation(async (_cfg: unknown, remotePath: string, _html: string) => {
      if (remotePath.startsWith('art-3/')) {
        throw new Error('ftp connection lost');
      }
      return { success: true, errors: [] };
    });

    const res = await POST(buildPostRequest({ confirm: 'HIDE_ALL_SOURCE' }));
    expect(res.status).toBe(207);
    const json = await res.json();

    expect(json.dry_run).toBe(false);
    expect(json.candidates).toBe(5);
    // FTP 失敗でも DB UPDATE と publish_events は成功している → succeededIds=5
    // ただし failures に 1 件記録される
    expect(json.hidden).toBe(5);
    expect(json.failures).toHaveLength(1);
    expect(json.failures[0].id).toBe(FIVE_TARGETS[2].id);
    expect(json.failures[0].stage).toBe('ftp-soft-withdraw');
    expect(String(json.failures[0].message)).toMatch(/ftp connection lost/);

    // failed:1 相当のフィールドを stage から検証
    const failedCount = (json.failures as Array<{ stage: string }>).filter(
      (f) => f.stage === 'ftp-soft-withdraw',
    ).length;
    expect(failedCount).toBe(1);

    // softWithdraw は 5 回呼ばれている (throw した 1 件を含む)
    expect(softWithdrawFileMock).toHaveBeenCalledTimes(5);
    // DB UPDATE / publish_events は全件
    expect(articlesUpdateMock).toHaveBeenCalledTimes(5);
    expect(publishEventsInsertMock).toHaveBeenCalledTimes(5);
  });

  // ─── Case 7: PUBLISH_CONTROL_FTP=off → DB UPDATE のみ ─────────────────
  it('7) PUBLISH_CONTROL_FTP=off の場合、softWithdraw / hub再生成は呼ばれず DB UPDATE のみ', async () => {
    process.env.PUBLISH_CONTROL_FTP = 'off';
    seedAuth(true);
    seedSelectRows(FIVE_TARGETS);
    seedUpdateOk();
    seedInsertOk();

    const res = await POST(buildPostRequest({ confirm: 'HIDE_ALL_SOURCE' }));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.dry_run).toBe(false);
    expect(json.candidates).toBe(5);
    expect(json.hidden).toBe(5);
    expect(json.hub_rebuild_status).toBe('skipped');

    // FTP off なので getFtpConfig / softWithdraw / fetch(/api/hub/deploy) は呼ばれない
    expect(getFtpConfigMock).not.toHaveBeenCalled();
    expect(softWithdrawFileMock).not.toHaveBeenCalled();
    expect(mocks.fetchMock).not.toHaveBeenCalled();
    // DB UPDATE / publish_events は通常通り発火
    expect(articlesUpdateMock).toHaveBeenCalledTimes(5);
    expect(publishEventsInsertMock).toHaveBeenCalledTimes(5);
  });

  // ─── Case 8: UPDATE payload に本文フィールドが含まれない ──────────────
  it('8) articles UPDATE payload には html_body / title / stage3_final_html 等の本文系列が含まれない (visibility 系列のみ)', async () => {
    seedAuth(true);
    seedSelectRows(FIVE_TARGETS);
    seedUpdateOk();
    seedInsertOk();
    seedFtpConfig();
    seedSoftWithdrawAllOk();

    const res = await POST(buildPostRequest({ confirm: 'HIDE_ALL_SOURCE' }));
    expect(res.status).toBe(200);

    expect(mocks.articlesUpdatePayloads).toHaveLength(5);

    // 本文への書込みが絶対に発生しないことを保証する禁止カラム一覧
    const FORBIDDEN_FIELDS = [
      'html_body',
      'title',
      'content',
      'body',
      'stage3_final_html',
      'stage2_writing_json',
      'stage1_outline_json',
      'keyword',
      'meta_description',
      'summary',
      'excerpt',
      'tags',
    ];

    // 許可カラム (visibility 系列) — payload はこの集合の部分集合であるべき
    const ALLOWED_FIELDS = new Set([
      'is_hub_visible',
      'visibility_state',
      'visibility_updated_at',
      'reviewed_at',
      'reviewed_by',
    ]);

    for (const payload of mocks.articlesUpdatePayloads) {
      const keys = Object.keys(payload);
      // 1) 禁止フィールドが 1 件も含まれない
      for (const forbidden of FORBIDDEN_FIELDS) {
        expect(keys).not.toContain(forbidden);
      }
      // 2) すべてのキーが許可セット内
      for (const k of keys) {
        expect(ALLOWED_FIELDS.has(k)).toBe(true);
      }
      // 3) 必須キーは確実に含まれる
      expect(payload.is_hub_visible).toBe(false);
      expect(payload.visibility_state).toBe('unpublished');
      expect(typeof payload.visibility_updated_at).toBe('string');
    }
  });
});
