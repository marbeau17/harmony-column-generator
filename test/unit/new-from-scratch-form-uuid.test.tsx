// @vitest-environment jsdom
// ============================================================================
// test/unit/new-from-scratch-form-uuid.test.tsx
//
// 役割: Generator/Fixer J9 — new-from-scratch フォーム UUID 送信テスト
//
// 検証対象 (production code は触らずテストのみ):
//   src/app/(dashboard)/dashboard/articles/new-from-scratch/page.tsx
//
// 検証ケース:
//   1. mount 時に /api/themes と /api/personas が fetch される
//   2. <select id="theme"> の option value が UUID 形式 (z.string().uuid() 通る)
//   3. <select id="persona"> の option value が UUID 形式
//   4. テーマ + ペルソナ + キーワード + intent + target_length 入力後 submit
//   5. POST /api/articles/zero-generate-async の body が
//        { theme_id: <uuid>, persona_id: <uuid>, keywords: [...], intent: ...,
//          target_length: 2000 } 形式
//   6. /api/themes が 500 を返したときエラーバナー (role="alert") が表示される
//
// 方針:
//   - 重い子コンポーネント (HallucinationResultPane / RegenerationControls /
//     DiffViewer / GenerationStepper / IntentRadioCard) と外部 (next/link /
//     react-hot-toast / lucide-react) は vi.mock で軽量モック化。
//   - fetch は vi.spyOn(globalThis, 'fetch') で差し替える。
//   - form 要素・select 要素を直接操作 (fireEvent) する純-React-Testing-Library
//     アプローチ（@testing-library/user-event は不要）。
// ============================================================================

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { z } from 'zod';
import * as React from 'react';

// ─── 子コンポーネント / 外部依存のモック ────────────────────────────────────

vi.mock('next/link', () => {
  // a 要素として描画するだけのスタブ
  const LinkStub = (props: { href: string; children?: unknown } & Record<string, unknown>) => {
    const { href, children, ...rest } = props;
    return (
      // eslint-disable-next-line jsx-a11y/anchor-has-content
      <a href={href} {...(rest as Record<string, unknown>)}>{children as React.ReactNode}</a>
    );
  };
  return { __esModule: true, default: LinkStub };
});

vi.mock('react-hot-toast', () => {
  const fn = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  });
  return { __esModule: true, default: fn };
});

// lucide-react は SVG アイコン群。テストでは何でも良いので明示 named-export で
// null コンポーネントに差し替える。
//
// 注意: vi.mock factory はファイル先頭にホイストされるため、外部スコープ変数を
// 参照すると ReferenceError になる。stub は factory 内で定義する。
// 注意 2: Proxy ベースの mock は vitest の依存解析で無限ループを誘発するため使用しない。
vi.mock('lucide-react', () => {
  const NullIcon = () => null;
  return {
    __esModule: true,
    Sparkles:       NullIcon,
    X:              NullIcon,
    ArrowRight:     NullIcon,
    ShieldCheck:    NullIcon,
    Heart:          NullIcon,
    Info:           NullIcon,
    HeartHandshake: NullIcon,
    Wrench:         NullIcon,
    Eye:            NullIcon,
    Lightbulb:      NullIcon,
    Loader2:        NullIcon,
  };
});

vi.mock('@/components/articles/GenerationStepper', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@/components/articles/HallucinationResultPane', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@/components/articles/RegenerationControls', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@/components/articles/DiffViewer', () => ({
  __esModule: true,
  default: () => null,
}));

// IntentRadioCard はフォーム内で必須選択。intent 値を変更するテスト用ミニモック。
vi.mock('@/components/articles/IntentRadioCard', () => ({
  __esModule: true,
  default: ({
    onChange,
  }: {
    value: string;
    onChange: (v: 'info' | 'empathy' | 'solve' | 'introspect') => void;
    disabled?: boolean;
  }) => (
    // テストから扱いやすいよう button を 4 つ出すだけのスタブ
    <div role="radiogroup" aria-label="intent-stub">
      <button type="button" data-testid="intent-info" onClick={() => onChange('info')}>info</button>
      <button type="button" data-testid="intent-empathy" onClick={() => onChange('empathy')}>empathy</button>
      <button type="button" data-testid="intent-solve" onClick={() => onChange('solve')}>solve</button>
      <button type="button" data-testid="intent-introspect" onClick={() => onChange('introspect')}>introspect</button>
    </div>
  ),
}));

// ─── テスト本体 ─────────────────────────────────────────────────────────────

// 固定 UUID (v4 形式)
const THEME_UUID = '11111111-1111-4111-8111-111111111111';
const PERSONA_UUID = '22222222-2222-4222-8222-222222222222';

const uuidSchema = z.string().uuid();

interface ThemesResp {
  themes: Array<{ id: string; name: string; category: string | null }>;
}
interface PersonasResp {
  personas: Array<{ id: string; name: string; age_range: string | null }>;
}

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const errJson = (status: number, body: unknown = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * fetch 計画: URL ごとに何を返すかを宣言する小さな DSL。
 * 未マッチは 500 で失敗扱い。
 */
function planFetch(
  plan: Array<{
    match: (url: string, init?: RequestInit) => boolean;
    respond: (url: string, init?: RequestInit) => Response | Promise<Response>;
  }>,
): MockInstance<typeof fetch> {
  const spy = vi.spyOn(globalThis, 'fetch');
  spy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    for (const p of plan) {
      if (p.match(url, init)) {
        return await p.respond(url, init);
      }
    }
    // eslint-disable-next-line no-console
    console.error('[planFetch] unmatched fetch:', url, init?.method);
    return errJson(500, { error: `unmatched fetch: ${url}` });
  });
  return spy;
}

// 静的 import: vi.mock はファイル先頭にホイストされるため、import 時点で
// すべてのモックは既に有効。
import NewFromScratchPage from '../../src/app/(dashboard)/dashboard/articles/new-from-scratch/page';

describe('NewFromScratchPage — UUID 送信フォーム', () => {
  beforeEach(() => {
    // window.confirm / alert を no-op に（fired-but-ignored を許容）
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('1. mount 時に /api/themes と /api/personas を GET する', async () => {
    const fetchSpy = planFetch([
      {
        match: (u, i) => u.includes('/api/themes') && (!i?.method || i.method === 'GET'),
        respond: () =>
          okJson({
            themes: [{ id: THEME_UUID, name: 'チャクラ', category: 'spiritual' }],
          } satisfies ThemesResp),
      },
      {
        match: (u, i) => u.includes('/api/personas') && (!i?.method || i.method === 'GET'),
        respond: () =>
          okJson({
            personas: [{ id: PERSONA_UUID, name: '迷えるOL', age_range: '30-40' }],
          } satisfies PersonasResp),
      },
    ]);

    await act(async () => {
      render(<NewFromScratchPage />);
    });

    // mount 後の useEffect で 2 本叩かれる
    await waitFor(() => {
      const calls = fetchSpy.mock.calls.map((c) =>
        typeof c[0] === 'string' ? c[0] : (c[0] as URL | Request).toString(),
      );
      expect(calls.some((u) => u.includes('/api/themes'))).toBe(true);
      expect(calls.some((u) => u.includes('/api/personas'))).toBe(true);
    });
  });

  it('2 & 3. select の option value は UUID 形式である', async () => {
    planFetch([
      {
        match: (u) => u.includes('/api/themes'),
        respond: () =>
          okJson({
            themes: [
              { id: THEME_UUID, name: 'チャクラ', category: null },
              { id: '33333333-3333-4333-8333-333333333333', name: '瞑想', category: null },
            ],
          } satisfies ThemesResp),
      },
      {
        match: (u) => u.includes('/api/personas'),
        respond: () =>
          okJson({
            personas: [
              { id: PERSONA_UUID, name: '迷えるOL', age_range: null },
              { id: '44444444-4444-4444-8444-444444444444', name: '主婦', age_range: null },
            ],
          } satisfies PersonasResp),
      },
    ]);

    await act(async () => {
      render(<NewFromScratchPage />);
    });

    // theme の option を取得
    const themeSelect = (await screen.findByLabelText(/テーマ/)) as HTMLSelectElement;
    const personaSelect = (await screen.findByLabelText(/ペルソナ/)) as HTMLSelectElement;

    await waitFor(() => {
      // 「選択してください」プレースホルダ + UUID オプション
      expect(themeSelect.querySelectorAll('option').length).toBeGreaterThanOrEqual(2);
      expect(personaSelect.querySelectorAll('option').length).toBeGreaterThanOrEqual(2);
    });

    const themeOptionValues = Array.from(themeSelect.querySelectorAll('option'))
      .map((o) => o.value)
      .filter((v) => v !== '');
    const personaOptionValues = Array.from(personaSelect.querySelectorAll('option'))
      .map((o) => o.value)
      .filter((v) => v !== '');

    expect(themeOptionValues.length).toBeGreaterThan(0);
    expect(personaOptionValues.length).toBeGreaterThan(0);

    for (const v of themeOptionValues) {
      expect(uuidSchema.safeParse(v).success).toBe(true);
    }
    for (const v of personaOptionValues) {
      expect(uuidSchema.safeParse(v).success).toBe(true);
    }
  });

  it('4 & 5. submit 時 POST /api/articles/zero-generate-async の body が {theme_id, persona_id, keywords, intent, target_length} 形式 (UUID)', async () => {
    let captured: { url: string; method?: string; body?: unknown } | null = null;

    planFetch([
      {
        match: (u) => u.includes('/api/themes'),
        respond: () =>
          okJson({
            themes: [{ id: THEME_UUID, name: 'チャクラ', category: null }],
          } satisfies ThemesResp),
      },
      {
        match: (u) => u.includes('/api/personas'),
        respond: () =>
          okJson({
            personas: [{ id: PERSONA_UUID, name: '迷えるOL', age_range: null }],
          } satisfies PersonasResp),
      },
      {
        match: (u, i) => u.includes('/api/articles/zero-generate-async') && i?.method === 'POST',
        respond: (u, i) => {
          captured = {
            url: u,
            method: i?.method,
            body: typeof i?.body === 'string' ? JSON.parse(i.body) : i?.body,
          };
          // P5-20: 非同期生成 — 即返で job_id を返す
          return okJson({
            job_id: '99999999-9999-4999-8999-999999999999',
            status: 'queued',
          });
        },
      },
      // 生成完了後の enrich は 200 ダミー
      {
        match: (u, i) =>
          /\/api\/articles\/[0-9a-f-]+$/i.test(u) && (!i?.method || i.method === 'GET'),
        respond: () => okJson({ id: '99999999-9999-4999-8999-999999999999' }),
      },
      {
        match: (u, i) =>
          u.includes('/hallucination-check') && i?.method === 'POST',
        respond: () => okJson({ claims: [] }),
      },
    ]);

    await act(async () => {
      render(<NewFromScratchPage />);
    });

    // テーマ選択
    const themeSelect = (await screen.findByLabelText(/テーマ/)) as HTMLSelectElement;
    await waitFor(() => {
      expect(themeSelect.querySelectorAll('option').length).toBeGreaterThanOrEqual(2);
    });
    fireEvent.change(themeSelect, { target: { value: THEME_UUID } });

    // ペルソナ選択
    const personaSelect = (await screen.findByLabelText(/ペルソナ/)) as HTMLSelectElement;
    await waitFor(() => {
      expect(personaSelect.querySelectorAll('option').length).toBeGreaterThanOrEqual(2);
    });
    fireEvent.change(personaSelect, { target: { value: PERSONA_UUID } });

    // キーワード入力 (Enter で確定)
    const kwInput = (await screen.findByLabelText(/キーワード/)) as HTMLInputElement;
    fireEvent.change(kwInput, { target: { value: 'チャクラ' } });
    fireEvent.keyDown(kwInput, { key: 'Enter', code: 'Enter' });
    fireEvent.change(kwInput, { target: { value: '瞑想' } });
    fireEvent.keyDown(kwInput, { key: 'Enter', code: 'Enter' });

    // 意図 (info) — IntentRadioCard モックの button を押す
    fireEvent.click(screen.getByTestId('intent-info'));

    // target_length デフォルトは 2000 のまま

    // submit ボタンクリック
    const submitBtn = screen.getByRole('button', { name: /生成/ });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // POST が呼ばれるまで待機
    await waitFor(() => {
      expect(captured).not.toBeNull();
    });

    expect(captured).not.toBeNull();
    expect(captured!.method).toBe('POST');
    expect(captured!.url).toContain('/api/articles/zero-generate-async');

    const body = captured!.body as Record<string, unknown>;
    expect(body).toEqual(
      expect.objectContaining({
        theme_id: THEME_UUID,
        persona_id: PERSONA_UUID,
        keywords: expect.arrayContaining(['チャクラ', '瞑想']),
        intent: 'info',
        target_length: 2000,
      }),
    );

    // theme_id / persona_id が UUID 形式であることを再確認
    expect(uuidSchema.safeParse(body.theme_id).success).toBe(true);
    expect(uuidSchema.safeParse(body.persona_id).success).toBe(true);

    // keywords は配列で 1 件以上
    expect(Array.isArray(body.keywords)).toBe(true);
    expect((body.keywords as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('6. /api/themes が 500 のときエラーバナー (role="alert") が表示される', async () => {
    planFetch([
      {
        match: (u) => u.includes('/api/themes'),
        respond: () => errJson(500, { error: 'internal error' }),
      },
      {
        match: (u) => u.includes('/api/personas'),
        respond: () =>
          okJson({
            personas: [{ id: PERSONA_UUID, name: '迷えるOL', age_range: null }],
          } satisfies PersonasResp),
      },
    ]);

    await act(async () => {
      render(<NewFromScratchPage />);
    });

    // バナーが表示されるまで待機（page.tsx の role="alert" 要素）
    const banner = await screen.findByRole('alert');
    expect(banner.textContent ?? '').toMatch(/マスタデータの取得に失敗/);
  });
});
