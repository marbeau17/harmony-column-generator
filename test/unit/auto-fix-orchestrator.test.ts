import { describe, it, expect, vi, beforeEach } from 'vitest';

// Gemini を mock する (orchestrator が generateJson を呼ぶ)
const generateJsonMock = vi.fn();
vi.mock('@/lib/ai/gemini-client', () => ({
  generateJson: (...args: unknown[]) => generateJsonMock(...args),
}));

// supabase server も mock
const updateMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: async () => ({
    from: () => ({
      update: (...args: unknown[]) => updateMock(...args),
    }),
  }),
}));

import { runAutoFix, appendQualityOverride, buildDiffSummary } from '@/lib/auto-fix/orchestrator';

beforeEach(() => {
  generateJsonMock.mockReset();
  updateMock.mockReset();
});

describe('runAutoFix', () => {
  it('成功時に after_html と cost_estimate を返す', async () => {
    const after = '<h2 id="x">章</h2><p>修復された本文ですよね。</p>'.repeat(10);
    generateJsonMock.mockResolvedValue({ data: { html: after }, response: { text: '' } });

    const got = await runAutoFix({
      bodyHtml: '<h2>章</h2><p>本文。</p>',
      params: { fix_type: 'suffix', current_value: 0.08, target_value: 0.15 },
    });
    expect(got.after_html).toBe(after);
    expect(got.cost_estimate).toBeGreaterThan(0);
  });

  it('空 HTML 返却時はエラー', async () => {
    generateJsonMock.mockResolvedValue({ data: { html: '' }, response: { text: '' } });
    await expect(
      runAutoFix({
        bodyHtml: '<p>x</p>',
        params: { fix_type: 'suffix', current_value: 0.08, target_value: 0.15 },
      }),
    ).rejects.toThrow(/empty\/too short/);
  });

  it('短すぎる HTML (100 字未満) でもエラー', async () => {
    generateJsonMock.mockResolvedValue({
      data: { html: '<p>短い</p>' },
      response: { text: '' },
    });
    await expect(
      runAutoFix({
        bodyHtml: '<p>x</p>',
        params: { fix_type: 'tone', current_value: 0.5 },
      }),
    ).rejects.toThrow(/empty\/too short/);
  });

  it('array_html 形式の Gemini レスポンスも吸収する (バグD 対応)', async () => {
    const longChunks = ['<p>' + 'a'.repeat(80) + '</p>', '<p>' + 'b'.repeat(80) + '</p>'];
    generateJsonMock.mockResolvedValue({ data: longChunks, response: { text: '' } });
    const got = await runAutoFix({
      bodyHtml: '<p>orig</p>',
      params: { fix_type: 'tone', current_value: 0.5 },
    });
    expect(got.after_html).toContain('a');
    expect(got.after_html).toContain('b');
  });

  it('keyword 戦略のコストは ~$0.005', async () => {
    const after = '<p>' + 'a'.repeat(150) + '</p>';
    generateJsonMock.mockResolvedValue({ data: { html: after }, response: { text: '' } });
    const got = await runAutoFix({
      bodyHtml: '<p>x</p>',
      params: { fix_type: 'keyword', keywords: ['ヒーリング'] },
    });
    expect(got.cost_estimate).toBe(0.005);
  });

  it('tone 戦略のコストはやや高め', async () => {
    const after = '<p>' + 'a'.repeat(150) + '</p>';
    generateJsonMock.mockResolvedValue({ data: { html: after }, response: { text: '' } });
    const got = await runAutoFix({
      bodyHtml: '<p>x</p>',
      params: { fix_type: 'tone' },
    });
    expect(got.cost_estimate).toBe(0.015);
  });
});

describe('appendQualityOverride', () => {
  it('既存 override を保ちつつ新規を追加', async () => {
    updateMock.mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
    const fakeSupabase = {
      from: () => ({
        update: (data: unknown) => {
          updateMock(data);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      }),
    } as never;
    const existing = [
      {
        check_item_id: 'other_warn',
        ignored_at: '2026-05-01T00:00:00Z',
        reason: '前回',
        ignored_by: null,
      },
    ];
    const got = await appendQualityOverride({
      supabase: fakeSupabase,
      articleId: 'aaaa',
      checkItemId: 'soft_ending_ratio',
      ignoreParams: { reason: '誤検出のため' },
      userId: 'u1',
      existingOverrides: existing,
    });
    expect(got.overrides).toHaveLength(2);
    expect(got.overrides.find((o) => o.check_item_id === 'soft_ending_ratio')?.reason).toBe(
      '誤検出のため',
    );
  });

  it('同 check_item_id の override は新しいものに置換', async () => {
    const fakeSupabase = {
      from: () => ({
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    } as never;
    const existing = [
      {
        check_item_id: 'soft_ending_ratio',
        ignored_at: '2026-04-01T00:00:00Z',
        reason: '古い',
        ignored_by: null,
      },
    ];
    const got = await appendQualityOverride({
      supabase: fakeSupabase,
      articleId: 'aaaa',
      checkItemId: 'soft_ending_ratio',
      ignoreParams: { reason: '新しい' },
      userId: 'u1',
      existingOverrides: existing,
    });
    expect(got.overrides).toHaveLength(1);
    expect(got.overrides[0].reason).toBe('新しい');
  });

  it('DB error が throw される', async () => {
    const fakeSupabase = {
      from: () => ({
        update: () => ({
          eq: () => Promise.resolve({ error: { message: 'permission denied' } }),
        }),
      }),
    } as never;
    await expect(
      appendQualityOverride({
        supabase: fakeSupabase,
        articleId: 'aaaa',
        checkItemId: 'x',
        ignoreParams: { reason: 'r' },
        userId: 'u1',
        existingOverrides: [],
      }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('buildDiffSummary', () => {
  it('文字数の delta を符号付で返す', () => {
    expect(buildDiffSummary('aaaa', 'aaaaaa')).toBe('before=4, after=6, delta=+2 chars');
    expect(buildDiffSummary('aaaaaa', 'aa')).toBe('before=6, after=2, delta=-4 chars');
    expect(buildDiffSummary('aaa', 'aaa')).toBe('before=3, after=3, delta=+0 chars');
  });
});
