import { describe, it, expect } from 'vitest';
import {
  getLifecycleStage,
  getStageLabel,
  type LifecycleStage,
} from '../../src/lib/publish-control/lifecycle-stage';

describe('getLifecycleStage', () => {
  it('draft は authoring 段階', () => {
    expect(getLifecycleStage('draft')).toBe('authoring');
  });

  it('pending_review は authoring 段階', () => {
    expect(getLifecycleStage('pending_review')).toBe('authoring');
  });

  it('idle は publishable 段階', () => {
    expect(getLifecycleStage('idle')).toBe('publishable');
  });

  it('deploying は transitioning 段階', () => {
    expect(getLifecycleStage('deploying')).toBe('transitioning');
  });

  it('live は live 段階', () => {
    expect(getLifecycleStage('live')).toBe('live');
  });

  it('live_hub_stale は live 段階', () => {
    expect(getLifecycleStage('live_hub_stale')).toBe('live');
  });

  it('unpublished は withdrawn 段階', () => {
    expect(getLifecycleStage('unpublished')).toBe('withdrawn');
  });

  it('failed は withdrawn 段階', () => {
    expect(getLifecycleStage('failed')).toBe('withdrawn');
  });

  it('null は legacy データとして authoring 段階にフォールバック', () => {
    expect(getLifecycleStage(null)).toBe('authoring');
  });

  it('undefined は legacy データとして authoring 段階にフォールバック', () => {
    expect(getLifecycleStage(undefined)).toBe('authoring');
  });

  it('不明な値は authoring 段階にフォールバック', () => {
    expect(getLifecycleStage('some_unknown_state')).toBe('authoring');
  });

  it('空文字列も authoring 段階にフォールバック', () => {
    expect(getLifecycleStage('')).toBe('authoring');
  });
});

describe('getStageLabel', () => {
  it('authoring は「執筆中」を返す', () => {
    expect(getStageLabel('authoring')).toBe('執筆中');
  });

  it('publishable は「公開可能」を返す', () => {
    expect(getStageLabel('publishable')).toBe('公開可能');
  });

  it('transitioning は「デプロイ中」を返す', () => {
    expect(getStageLabel('transitioning')).toBe('デプロイ中');
  });

  it('live は「公開中」を返す', () => {
    expect(getStageLabel('live')).toBe('公開中');
  });

  it('withdrawn は「撤回」を返す', () => {
    expect(getStageLabel('withdrawn')).toBe('撤回');
  });

  it('全 LifecycleStage で日本語ラベルが空文字でない', () => {
    const stages: LifecycleStage[] = [
      'authoring',
      'publishable',
      'transitioning',
      'live',
      'withdrawn',
    ];
    for (const stage of stages) {
      const label = getStageLabel(stage);
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
