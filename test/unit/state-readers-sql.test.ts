import { describe, it, expect, vi } from 'vitest';
import {
  applyPubliclyVisibleFilter,
  applyShadowVisibleFilter,
} from '@/lib/publish-control/state-readers-sql';

/**
 * P5-43: state-readers-sql フィルタヘルパーの単体テスト。
 * Supabase の query builder を mock し、想定どおりの呼び出しが行われるか検証。
 */

type InQueryBuilder = {
  in: (col: string, values: readonly string[]) => InQueryBuilder;
};

type OrQueryBuilder = {
  or: (filter: string) => OrQueryBuilder;
};

function createInBuilder(): InQueryBuilder & { in: ReturnType<typeof vi.fn> } {
  const builder = {
    in: vi.fn(),
  } as InQueryBuilder & { in: ReturnType<typeof vi.fn> };
  builder.in.mockReturnValue(builder);
  return builder;
}

function createOrBuilder(): OrQueryBuilder & { or: ReturnType<typeof vi.fn> } {
  const builder = {
    or: vi.fn(),
  } as OrQueryBuilder & { or: ReturnType<typeof vi.fn> };
  builder.or.mockReturnValue(builder);
  return builder;
}

describe('applyPubliclyVisibleFilter', () => {
  it('visibility_state カラムに対して .in を呼び出す', () => {
    const builder = createInBuilder();
    applyPubliclyVisibleFilter(builder);
    expect(builder.in).toHaveBeenCalledTimes(1);
    expect(builder.in.mock.calls[0][0]).toBe('visibility_state');
  });

  it('values に live と live_hub_stale を渡す', () => {
    const builder = createInBuilder();
    applyPubliclyVisibleFilter(builder);
    const values = builder.in.mock.calls[0][1] as readonly string[];
    expect(values).toEqual(['live', 'live_hub_stale']);
  });

  it('引数で渡した builder のチェーン結果を返す', () => {
    const builder = createInBuilder();
    const result = applyPubliclyVisibleFilter(builder);
    expect(result).toBe(builder);
  });
});

describe('applyShadowVisibleFilter', () => {
  it('.or を 1 度だけ呼び出す', () => {
    const builder = createOrBuilder();
    applyShadowVisibleFilter(builder);
    expect(builder.or).toHaveBeenCalledTimes(1);
  });

  it('reviewed_at.not.is.null と visibility_state.in.(...) を含む or 句を渡す', () => {
    const builder = createOrBuilder();
    applyShadowVisibleFilter(builder);
    const filter = builder.or.mock.calls[0][0] as string;
    expect(filter).toContain('reviewed_at.not.is.null');
    expect(filter).toContain('visibility_state.in.(live,live_hub_stale)');
  });

  it('or 句はカンマ区切りで両条件を結合する', () => {
    const builder = createOrBuilder();
    applyShadowVisibleFilter(builder);
    const filter = builder.or.mock.calls[0][0] as string;
    expect(filter).toBe(
      'reviewed_at.not.is.null,visibility_state.in.(live,live_hub_stale)',
    );
  });

  it('引数で渡した builder のチェーン結果を返す', () => {
    const builder = createOrBuilder();
    const result = applyShadowVisibleFilter(builder);
    expect(result).toBe(builder);
  });
});

describe('フィルタヘルパー独立性', () => {
  it('両ヘルパーは互いに独立して動作する', () => {
    const inBuilder = createInBuilder();
    const orBuilder = createOrBuilder();
    applyPubliclyVisibleFilter(inBuilder);
    applyShadowVisibleFilter(orBuilder);
    expect(inBuilder.in).toHaveBeenCalledTimes(1);
    expect(orBuilder.or).toHaveBeenCalledTimes(1);
  });
});
