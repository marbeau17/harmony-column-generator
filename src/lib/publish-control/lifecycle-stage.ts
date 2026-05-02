import type { VisibilityState } from './state-machine';

/**
 * P5-43: state machine ノードを「ライフサイクル段階」にマップする糖衣。
 * UI や監査ログで「どの段階にあるか」を分類するため。
 */

export type LifecycleStage =
  | 'authoring'     // draft / pending_review (執筆 / レビュー中)
  | 'publishable'   // idle (承認済み未公開)
  | 'transitioning' // deploying (進行中)
  | 'live'          // live, live_hub_stale (公開中)
  | 'withdrawn'     // unpublished, failed (撤回 / 失敗)
  ;

export function getLifecycleStage(state: VisibilityState | string | null | undefined): LifecycleStage {
  switch (state) {
    case 'draft':
    case 'pending_review':
      return 'authoring';
    case 'idle':
      return 'publishable';
    case 'deploying':
      return 'transitioning';
    case 'live':
    case 'live_hub_stale':
      return 'live';
    case 'unpublished':
    case 'failed':
      return 'withdrawn';
    default:
      return 'authoring'; // null / undefined は authoring (= legacy データ)
  }
}

export function getStageLabel(stage: LifecycleStage): string {
  return {
    authoring: '執筆中',
    publishable: '公開可能',
    transitioning: 'デプロイ中',
    live: '公開中',
    withdrawn: '撤回',
  }[stage];
}
