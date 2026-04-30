// ============================================================================
// test/unit/visibility-hallucination-gate.test.ts
// 第4ゲート: hallucination_critical = 0 の単体テスト
//
// 検証ケース:
//   1. critical claim 0 件 → 通常通り 200
//   2. critical claim 1 件 → 422 + code 'HALLUCINATION_CRITICAL'
//   3. visible=false 時は critical があってもゲートを通過
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
    articlesMaybeSingleMock: vi.fn(),
    articleClaimsCountMock: vi.fn(),
    articlesUpdateMock: vi.fn(),
    publishEventsInsertMock: vi.fn(),
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
            // 冪等チェック: select(...).eq(...).eq(...).maybeSingle()
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
            // 記事フェッチ: select(...).eq(...).maybeSingle()
            select: () => ({
              eq: () => ({
                maybeSingle: mocks.articlesMaybeSingleMock,
              }),
            }),
            // 状態更新: update(...).eq(...) や .eq(...).eq(...)
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

const ARTICLE_ID = '00000000-0000-0000-0000-0000000000aa';
const REQUEST_ID = '01HK4ZQ5A9N8M7TEST123456XY'; // 26文字 ULID 風

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
    data: { user: { id: 'user-abc', email: 'tester@example.com' } },
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
      slug: 'test-article',
      seo_filename: 'test-article',
      title: 'テスト記事',
      is_hub_visible: opts.isHubVisible,
      visibility_state: opts.isHubVisible ? 'live' : 'idle',
      visibility_updated_at: new Date('2026-04-20T00:00:00Z').toISOString(),
    },
    error: null,
  });
}

// ─── テスト ─────────────────────────────────────────────────────────────────

describe('visibility API — 第4ゲート: hallucination_critical = 0', () => {
  beforeEach(() => {
    process.env.PUBLISH_CONTROL_V2 = 'on';
    process.env.PUBLISH_CONTROL_FTP = 'off'; // FTP / hub-rebuild の経路を抑止
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('critical claim 0 件 → 200（通常通り公開できる）', async () => {
    setupHappyPath({ isHubVisible: false });
    mocks.articleClaimsCountMock.mockReturnValue({ count: 0, error: null });

    const res = await POST(makeReq({ visible: true, requestId: REQUEST_ID }), {
      params: { id: ARTICLE_ID },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.visible).toBe(true);
    // article_claims を実際に問い合わせていること
    expect(mocks.articleClaimsCountMock).toHaveBeenCalledTimes(1);
  });

  it('critical claim 1 件 → 422 + code "HALLUCINATION_CRITICAL"', async () => {
    setupHappyPath({ isHubVisible: false });
    mocks.articleClaimsCountMock.mockReturnValue({ count: 1, error: null });

    const res = await POST(makeReq({ visible: true, requestId: REQUEST_ID }), {
      params: { id: ARTICLE_ID },
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('HALLUCINATION_CRITICAL');
    expect(body.criticalCount).toBe(1);
    // ゲートで弾かれているので状態遷移（articles UPDATE）には到達しない
    expect(mocks.articlesUpdateMock).not.toHaveBeenCalled();
    // publish_events への記録（成功 INSERT）にも到達しない
    expect(mocks.publishEventsInsertMock).not.toHaveBeenCalled();
  });

  it('visible=false（非公開化）時は critical claim があってもゲートを通る', async () => {
    setupHappyPath({ isHubVisible: true });
    // critical claim ありでもゲートに到達しない想定
    mocks.articleClaimsCountMock.mockReturnValue({ count: 5, error: null });

    const res = await POST(
      makeReq({ visible: false, requestId: REQUEST_ID }),
      { params: { id: ARTICLE_ID } },
    );

    // ゲートで弾かれていなければ非公開化フローを完了して 200 を返す
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.visible).toBe(false);
    // 第4ゲートは visible=false 時は「呼ばれない」のが要件
    expect(mocks.articleClaimsCountMock).not.toHaveBeenCalled();
  });
});
