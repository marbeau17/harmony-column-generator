import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AC-P1-1〜AC-P1-3: transitionArticleStatus() の新公開列書込挙動を検証する。
 *
 * step7（Publish Control V2）で legacy 公開経路と visibility API のスキーマ差を埋め、
 * step8 の RLS 切替時にサイレント非公開化が起きないことを保証する。
 *
 * Supabase クライアントと session-guard をモックし、`update()` に渡された payload を
 * 直接アサートする戦略を取る（DB 接続なし）。
 */

// ── モック対象を最初に宣言する（vi.mock は hoist される） ──

vi.mock('@/lib/publish-control/session-guard', () => ({
  assertArticleWriteAllowed: vi.fn(),
  assertArticleDeleteAllowed: vi.fn(),
}));

// `update()` に渡される payload を捕捉するための holder
const updateCapture: { payload: Record<string, unknown> | null } = { payload: null };

vi.mock('@/lib/supabase/server', () => {
  // articles テーブルを模した最小モック。
  // .from('articles').update(payload).eq(...).select('*').single()
  // または .from('articles').select('*').eq('id', x).maybeSingle() を呼ばれることを想定。
  const fromMock = vi.fn();
  return {
    createServiceRoleClient: vi.fn(async () => ({
      from: fromMock,
    })),
    // 後でテスト内から fromMock を差し込めるように export
    __fromMock: fromMock,
  };
});

// 動的 import で実物を取得（モック適用後）
import { transitionArticleStatus } from '@/lib/db/articles';
// fromMock を取得するため
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as supabaseServerMock from '@/lib/supabase/server';

// 元記事の状態（getArticleById が返す値）
type FakeArticleRow = {
  id: string;
  status: string;
  is_hub_visible?: boolean;
  visibility_state?: string;
  visibility_updated_at?: string | null;
  published_at?: string | null;
  title?: string | null;
};

interface CallContext {
  current: FakeArticleRow;
  updateReturns?: FakeArticleRow;
}

function setupSupabaseMock(ctx: CallContext): void {
  updateCapture.payload = null;

  // 各 from() 呼び出しに対し、用途別の chain オブジェクトを返す。
  // 1 回目: getArticleById（select → eq → maybeSingle）
  // 2 回目: update（update → eq → select → single）
  const selectChain = {
    eq: vi.fn(() => ({
      maybeSingle: vi.fn(async () => ({ data: ctx.current, error: null })),
    })),
  };

  const updateChain = (payload: Record<string, unknown>) => {
    updateCapture.payload = payload;
    return {
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: {
              ...ctx.current,
              ...payload,
              ...(ctx.updateReturns ?? {}),
            },
            error: null,
          })),
        })),
      })),
    };
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromMock = (supabaseServerMock as any).__fromMock as ReturnType<typeof vi.fn>;
  fromMock.mockReset();
  fromMock.mockImplementation(() => ({
    select: vi.fn(() => selectChain),
    update: vi.fn(updateChain),
  }));
}

describe('transitionArticleStatus — step7 新公開列書込', () => {
  const ARTICLE_ID = '00000000-0000-0000-0000-0000000000aa';

  beforeEach(() => {
    updateCapture.payload = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // AC-P1-1: editing → published で新列が自動書込される
  it('AC-P1-1: editing → published 遷移で is_hub_visible/visibility_state/visibility_updated_at/published_at を書く', async () => {
    setupSupabaseMock({
      current: {
        id: ARTICLE_ID,
        status: 'editing',
        is_hub_visible: false,
        visibility_state: 'idle',
        visibility_updated_at: null,
        published_at: null,
      },
    });

    const result = await transitionArticleStatus(ARTICLE_ID, 'published');

    // update payload に新列が含まれること
    const payload = updateCapture.payload!;
    expect(payload).toBeTruthy();
    expect(payload.status).toBe('published');
    expect(payload.is_hub_visible).toBe(true);
    expect(payload.visibility_state).toBe('live');
    expect(typeof payload.visibility_updated_at).toBe('string');
    expect(typeof payload.published_at).toBe('string');
    // ISO8601 形式
    expect(() => new Date(payload.published_at as string).toISOString()).not.toThrow();
    expect(() => new Date(payload.visibility_updated_at as string).toISOString()).not.toThrow();

    // 戻り値も新列を含むこと
    expect(result.status).toBe('published');
    expect(result.is_hub_visible).toBe(true);
    expect(result.visibility_state).toBe('live');
    expect(typeof result.published_at).toBe('string');
    expect(typeof result.visibility_updated_at).toBe('string');
  });

  // AC-P1-2: extraFields の上書きが効く（呼び出し元優先）
  it('AC-P1-2: extraFields で is_hub_visible:false を渡すと呼び出し元の指定を優先する', async () => {
    setupSupabaseMock({
      current: {
        id: ARTICLE_ID,
        status: 'editing',
        is_hub_visible: false,
        visibility_state: 'idle',
        visibility_updated_at: null,
        published_at: null,
      },
    });

    // extraFields で明示的に false / 'idle' を指定
    const result = await transitionArticleStatus(ARTICLE_ID, 'published', {
      is_hub_visible: false,
      visibility_state: 'idle',
    });

    const payload = updateCapture.payload!;
    expect(payload.is_hub_visible).toBe(false);
    expect(payload.visibility_state).toBe('idle');
    // published_at と visibility_updated_at は extraFields に無いので自動設定が残る
    expect(typeof payload.published_at).toBe('string');
    expect(typeof payload.visibility_updated_at).toBe('string');

    expect(result.is_hub_visible).toBe(false);
    expect(result.visibility_state).toBe('idle');
  });

  // AC-P1-3: published 以外への遷移では新列を変更しない
  it('AC-P1-3: outline_pending → draft 遷移では is_hub_visible/visibility_state を payload に書かない', async () => {
    setupSupabaseMock({
      current: {
        id: ARTICLE_ID,
        status: 'outline_pending',
        is_hub_visible: true, // 既存値が保持されることを期待
        visibility_state: 'live',
        visibility_updated_at: '2026-04-20T00:00:00.000Z',
        published_at: '2026-04-20T00:00:00.000Z',
      },
    });

    await transitionArticleStatus(ARTICLE_ID, 'draft');

    const payload = updateCapture.payload!;
    expect(payload.status).toBe('draft');
    // 新列キーが update payload に含まれていないこと（DB 既存値が保持される）
    expect('is_hub_visible' in payload).toBe(false);
    expect('visibility_state' in payload).toBe(false);
    expect('visibility_updated_at' in payload).toBe(false);
    expect('published_at' in payload).toBe(false);
  });
});
