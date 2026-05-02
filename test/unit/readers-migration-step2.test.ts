import { describe, it, expect, vi } from 'vitest';
import { applyPubliclyVisibleFilter } from '@/lib/publish-control/state-readers-sql';
import { isPubliclyVisible, isDeployable } from '@/lib/publish-control/visibility-predicate';

/**
 * Step 2 readers migration の振る舞いを担保する追加テスト。
 *
 * 対象: hub-generator / sitemap / column page / deploy gate / centroid /
 * dashboard pages の readers が visibility_state ベースに移行した後、
 * 「公開対象」「デプロイ対象」判定が一意に揃うことを検証する。
 *
 * 既存の visibility-predicate.test.ts / state-readers-sql.test.ts とは
 * 視点が異なる (Step 2 移行後の readers 一括ガード) ため別ファイルで保持する。
 */

type InQueryBuilder = {
  in: (col: string, values: readonly string[]) => InQueryBuilder;
};

function createInBuilder(): InQueryBuilder & { in: ReturnType<typeof vi.fn> } {
  const builder = {
    in: vi.fn(),
  } as InQueryBuilder & { in: ReturnType<typeof vi.fn> };
  builder.in.mockReturnValue(builder);
  return builder;
}

describe('Step 2 readers migration — applyPubliclyVisibleFilter', () => {
  it('visibility_state IN [live, live_hub_stale] で絞り込むこと', () => {
    const builder = createInBuilder();
    const result = applyPubliclyVisibleFilter(builder);

    expect(builder.in).toHaveBeenCalledTimes(1);
    expect(builder.in).toHaveBeenCalledWith('visibility_state', ['live', 'live_hub_stale']);
    // チェーンが維持されること (readers が `.eq()` 等を続けて呼ぶため)
    expect(result).toBe(builder);
  });
});

describe('Step 2 readers migration — isPubliclyVisible', () => {
  it("visibility_state='live' は公開対象", () => {
    expect(isPubliclyVisible({ visibility_state: 'live' })).toBe(true);
  });

  it("visibility_state='live_hub_stale' は公開対象 (hub 再生成待ちでも記事自体は live)", () => {
    expect(isPubliclyVisible({ visibility_state: 'live_hub_stale' })).toBe(true);
  });

  it("visibility_state='idle' は公開対象外", () => {
    expect(isPubliclyVisible({ visibility_state: 'idle' })).toBe(false);
  });

  it("visibility_state='pending_review' は公開対象外", () => {
    expect(isPubliclyVisible({ visibility_state: 'pending_review' })).toBe(false);
  });

  it("visibility_state='unpublished' は公開対象外 (ソフト撤回済み)", () => {
    expect(isPubliclyVisible({ visibility_state: 'unpublished' })).toBe(false);
  });
});

describe('Step 2 readers migration — isDeployable (deploy gate)', () => {
  it("visibility_state='idle' は deploy 可能", () => {
    expect(isDeployable({ visibility_state: 'idle' })).toBe(true);
  });

  it("visibility_state='failed' は deploy 可能 (再試行を許可)", () => {
    expect(isDeployable({ visibility_state: 'failed' })).toBe(true);
  });

  it("visibility_state='live' は deploy 不要 (既に公開済み)", () => {
    expect(isDeployable({ visibility_state: 'live' })).toBe(false);
  });

  it("visibility_state='pending_review' は deploy 不可 (review 待ち)", () => {
    expect(isDeployable({ visibility_state: 'pending_review' })).toBe(false);
  });

  it("visibility_state='deploying' は deploy 不可 (進行中)", () => {
    expect(isDeployable({ visibility_state: 'deploying' })).toBe(false);
  });

  it('visibility_state=null は deploy 不可 (未初期化レコード)', () => {
    expect(isDeployable({ visibility_state: null })).toBe(false);
  });
});
