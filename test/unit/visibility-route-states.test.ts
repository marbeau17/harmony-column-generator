// ============================================================================
// test/unit/visibility-route-states.test.ts
// POST /api/articles/[id]/visibility の状態遷移・ULID 検証・冪等性ピン留めテスト
//
// 既存 visibility-hallucination-gate.test.ts は第4ゲートのみ対象だったため、
// 本ファイルでは下記の挙動を新規にピン留めする:
//   1. visible=true 入力 → is_hub_visible=true / visibility_state='live'
//   2. visible=false 入力 → is_hub_visible=false / visibility_state='unpublished'
//   3. requestId が 26-char Crockford ULID で無い場合は 400（P5-39 で修正）
//   4. 同じ requestId の 2 回目呼び出しは duplicate（冪等）
//
// 補助ケースも含めて 8 ケース以上を担保する。
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

// ─── モック宣言（vi.hoisted で安全に共有） ───────────────────────────────────

const mocks = vi.hoisted(() => {
  return {
    authGetUserMock: vi.fn(),
    publishEventsMaybeSingleMock: vi.fn(),
    publishEventsInsertMock: vi.fn(),
    articlesMaybeSingleMock: vi.fn(),
    articleClaimsCountMock: vi.fn(),
    // 全 update 呼び出しを順序込みで観測する
    articlesUpdateMock: vi.fn(),
  };
});

vi.mock('@/lib/supabase/server', () => {
  return {
    createServerSupabaseClient: vi.fn(async () => ({
      auth: {
        getUser: mocks.authGetUserMock,
      },
    })),
    createServiceRoleClient: vi.fn(async () => ({
      from: (table: string) => {
        if (table === 'publish_events') {
          return {
            // 冪等チェック: select(...).eq().eq().maybeSingle()
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: mocks.publishEventsMaybeSingleMock,
                }),
              }),
            }),
            insert: (...args: unknown[]) => {
              mocks.publishEventsInsertMock(...args);
              return Promise.resolve({ error: null });
            },
          };
        }
        if (table === 'articles') {
          return {
            // 記事フェッチ: select(...).eq().maybeSingle()
            select: () => ({
              eq: () => ({
                maybeSingle: mocks.articlesMaybeSingleMock,
              }),
            }),
            // 状態更新: update(payload).eq().eq() / .eq()
            update: (payload: Record<string, unknown>) => {
              mocks.articlesUpdateMock(payload);
              const chain = {
                eq: () => chain,
                then: (resolve: (v: { error: null }) => unknown) =>
                  resolve({ error: null }),
              };
              return chain;
            },
          };
        }
        if (table === 'article_claims') {
          return {
            // 第4ゲート: select('id', { count: 'exact', head: true }).eq().eq()
            select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
              const chain = {
                eq: () => chain,
                then: (resolve: (v: unknown) => unknown) =>
                  resolve(mocks.articleClaimsCountMock(opts)),
              };
              return chain;
            },
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    })),
  };
});

// 公開制御フィーチャフラグは ON 固定
vi.mock('@/lib/publish-control/feature-flag', () => ({
  isPublishControlEnabled: () => true,
  publishControlMode: () => 'on',
}));

// FTP / Slack / logger は副作用を抑止
vi.mock('@/lib/deploy/ftp-uploader', () => ({
  getFtpConfig: vi.fn(async () => ({})),
  softWithdrawFile: vi.fn(async () => ({ success: true, errors: [] })),
}));
vi.mock('@/lib/notify/slack', () => ({
  sendSlackNotification: vi.fn(async () => undefined),
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── 動的 import（モック適用後） ────────────────────────────────────────────

import { POST } from '@/app/api/articles/[id]/visibility/route';

// ─── ヘルパ ─────────────────────────────────────────────────────────────────

const ARTICLE_ID = '00000000-0000-0000-0000-0000000000bb';
// 26 文字、Crockford base32 のみ（I/L/O/U 不使用）
const VALID_REQUEST_ID = '01HK4ZQ5A9N8M7TEST123456XY';
const VALID_REQUEST_ID_2 = '01HK4ZQ5A9N8M7TESTABCDEFGH';

function makeReq(body: unknown): NextRequest {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
  return new NextRequest(
    new Request(`http://localhost/api/articles/${ARTICLE_ID}/visibility`, init),
  );
}

function setupHappyPath(opts: { isHubVisible: boolean }) {
  // 認証 OK
  mocks.authGetUserMock.mockResolvedValue({
    data: { user: { id: 'user-xyz', email: 'tester@example.com' } },
  });
  // 冪等チェック: 既存 publish_event なし
  mocks.publishEventsMaybeSingleMock.mockResolvedValue({ data: null });
  // 記事フェッチ
  mocks.articlesMaybeSingleMock.mockResolvedValue({
    data: {
      id: ARTICLE_ID,
      status: 'published',
      stage3_final_html: '<html>ok</html>',
      stage2_body_html: '<p>body</p>',
      slug: 'state-pin-article',
      seo_filename: 'state-pin-article',
      title: '状態ピン留めテスト記事',
      is_hub_visible: opts.isHubVisible,
      visibility_state: opts.isHubVisible ? 'live' : 'idle',
      visibility_updated_at: new Date('2026-04-20T00:00:00Z').toISOString(),
    },
    error: null,
  });
  // 第4ゲートは clean
  mocks.articleClaimsCountMock.mockReturnValue({ count: 0, error: null });
}

/**
 * articlesUpdateMock の呼び出し履歴から、
 * 「最終 visibility_state 反映 update（is_hub_visible キーを含む payload）」を
 * 取り出すためのヘルパ。
 *
 * route.ts は次の順で update を発行する:
 *   1. visibility_state='deploying' に locking
 *   2. is_hub_visible / visibility_state を最終値に反映 ← これを取りたい
 *   3. （hubWarning がある場合のみ）live_hub_stale 反映
 */
function findFlipPayload(): Record<string, unknown> | null {
  const calls = mocks.articlesUpdateMock.mock.calls as unknown as Array<
    [Record<string, unknown>]
  >;
  for (const [payload] of calls) {
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'is_hub_visible')) {
      return payload;
    }
  }
  return null;
}

// ─── テスト ─────────────────────────────────────────────────────────────────

describe('visibility API — 状態遷移・ULID 検証・冪等性のピン留め', () => {
  beforeEach(() => {
    process.env.PUBLISH_CONTROL_V2 = 'on';
    process.env.PUBLISH_CONTROL_FTP = 'off'; // FTP / hub-rebuild の経路を抑止
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── 1) visible=true → is_hub_visible=true / visibility_state='live' ──
  describe('visible=true の状態反映', () => {
    it('is_hub_visible=true / visibility_state="live" を articles に書く', async () => {
      setupHappyPath({ isHubVisible: false });

      const res = await POST(
        makeReq({ visible: true, requestId: VALID_REQUEST_ID }),
        { params: { id: ARTICLE_ID } },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.visible).toBe(true);

      const flip = findFlipPayload();
      expect(flip).not.toBeNull();
      expect(flip!.is_hub_visible).toBe(true);
      expect(flip!.visibility_state).toBe('live');
      // reviewed_at もミラー反映される（SPEC §3.2）
      expect(flip!.reviewed_at).toBeTruthy();
      expect(flip!.reviewed_by).toBe('tester@example.com');
    });

    it('publish_events に action="publish" で INSERT される', async () => {
      setupHappyPath({ isHubVisible: false });

      await POST(
        makeReq({ visible: true, requestId: VALID_REQUEST_ID }),
        { params: { id: ARTICLE_ID } },
      );

      expect(mocks.publishEventsInsertMock).toHaveBeenCalledTimes(1);
      const arg = mocks.publishEventsInsertMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(arg.action).toBe('publish');
      expect(arg.request_id).toBe(VALID_REQUEST_ID);
      expect(arg.article_id).toBe(ARTICLE_ID);
    });
  });

  // ── 2) visible=false → is_hub_visible=false / visibility_state='unpublished' ──
  describe('visible=false の状態反映', () => {
    it('is_hub_visible=false / visibility_state="unpublished" を articles に書く', async () => {
      setupHappyPath({ isHubVisible: true });

      const res = await POST(
        makeReq({ visible: false, requestId: VALID_REQUEST_ID }),
        { params: { id: ARTICLE_ID } },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.visible).toBe(false);

      const flip = findFlipPayload();
      expect(flip).not.toBeNull();
      expect(flip!.is_hub_visible).toBe(false);
      expect(flip!.visibility_state).toBe('unpublished');
      // 非公開化時は reviewed_at / reviewed_by を null にクリア
      expect(flip!.reviewed_at).toBeNull();
      expect(flip!.reviewed_by).toBeNull();
    });

    it('publish_events に action="unpublish" で INSERT される', async () => {
      setupHappyPath({ isHubVisible: true });

      await POST(
        makeReq({ visible: false, requestId: VALID_REQUEST_ID }),
        { params: { id: ARTICLE_ID } },
      );

      expect(mocks.publishEventsInsertMock).toHaveBeenCalledTimes(1);
      const arg = mocks.publishEventsInsertMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(arg.action).toBe('unpublish');
      expect(arg.request_id).toBe(VALID_REQUEST_ID);
    });
  });

  // ── 3) requestId 検証（P5-39 で 26-char Crockford ULID 必須に修正） ──
  describe('requestId バリデーション（26-char Crockford ULID）', () => {
    it('短すぎる requestId（25 文字）は 400 を返す', async () => {
      setupHappyPath({ isHubVisible: false });

      const res = await POST(
        makeReq({ visible: true, requestId: '01HK4ZQ5A9N8M7TEST123456X' /* 25 chars */ }),
        { params: { id: ARTICLE_ID } },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/requestId/);
      // バリデーション段階で弾かれるので state 遷移にも publish_events INSERT にも到達しない
      expect(mocks.articlesUpdateMock).not.toHaveBeenCalled();
      expect(mocks.publishEventsInsertMock).not.toHaveBeenCalled();
    });

    it('長すぎる requestId（27 文字）は 400 を返す', async () => {
      setupHappyPath({ isHubVisible: false });

      const res = await POST(
        makeReq({ visible: true, requestId: '01HK4ZQ5A9N8M7TEST123456XYZ' /* 27 chars */ }),
        { params: { id: ARTICLE_ID } },
      );

      expect(res.status).toBe(400);
      expect(mocks.articlesUpdateMock).not.toHaveBeenCalled();
    });

    it('Crockford 禁止文字（I/L/O/U）を含む requestId は 400 を返す', async () => {
      setupHappyPath({ isHubVisible: false });

      // 26 文字だが末尾が 'I'（Crockford 除外文字）
      const res = await POST(
        makeReq({ visible: true, requestId: '01HK4ZQ5A9N8M7TEST123456XI' }),
        { params: { id: ARTICLE_ID } },
      );

      expect(res.status).toBe(400);
      expect(mocks.articlesUpdateMock).not.toHaveBeenCalled();
    });

    it('ハイフン入り UUID 形式の requestId は 400 を返す（P5-39 修正点）', async () => {
      setupHappyPath({ isHubVisible: false });

      // P5-39 以前は緩く受け入れていた疑似 UUID 形式を明示的に拒否する
      const res = await POST(
        makeReq({
          visible: true,
          requestId: '01HK4ZQ5-A9N8-M7TE-ST12-3456XY',
        }),
        { params: { id: ARTICLE_ID } },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/ULID/);
    });

    it('requestId が undefined の場合は 400 を返す', async () => {
      setupHappyPath({ isHubVisible: false });

      const res = await POST(
        makeReq({ visible: true /* requestId 欠落 */ }),
        { params: { id: ARTICLE_ID } },
      );

      expect(res.status).toBe(400);
      expect(mocks.articlesUpdateMock).not.toHaveBeenCalled();
    });
  });

  // ── 4) 冪等性: 同じ requestId の 2 回目呼び出しは duplicate ──
  describe('冪等性（idempotency）', () => {
    it('同じ requestId で 2 回呼ぶと、2 回目は status="duplicate" を返す', async () => {
      // 1 回目: 既存 publish_event なし → 通常公開フロー
      setupHappyPath({ isHubVisible: false });

      const first = await POST(
        makeReq({ visible: true, requestId: VALID_REQUEST_ID_2 }),
        { params: { id: ARTICLE_ID } },
      );
      expect(first.status).toBe(200);
      const firstBody = await first.json();
      expect(firstBody.status).toBe('ok');

      // 2 回目: 同じ requestId の publish_event が既に存在
      vi.clearAllMocks();
      mocks.authGetUserMock.mockResolvedValue({
        data: { user: { id: 'user-xyz', email: 'tester@example.com' } },
      });
      mocks.publishEventsMaybeSingleMock.mockResolvedValue({
        data: { id: 'evt-existing-001', hub_deploy_status: 'success' },
      });

      const second = await POST(
        makeReq({ visible: true, requestId: VALID_REQUEST_ID_2 }),
        { params: { id: ARTICLE_ID } },
      );

      expect(second.status).toBe(200);
      const secondBody = await second.json();
      expect(secondBody.status).toBe('duplicate');
      expect(secondBody.eventId).toBe('evt-existing-001');

      // 2 回目は冪等ショートサーキットなので、状態遷移にも追加 INSERT にも到達しない
      expect(mocks.articlesUpdateMock).not.toHaveBeenCalled();
      expect(mocks.publishEventsInsertMock).not.toHaveBeenCalled();
      // 記事の再フェッチも発生しない
      expect(mocks.articlesMaybeSingleMock).not.toHaveBeenCalled();
    });
  });
});
