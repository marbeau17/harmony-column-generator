export type VisibilityState =
  | 'idle'
  | 'deploying'
  | 'live'
  | 'live_hub_stale'
  | 'unpublished'
  | 'failed';

const TRANSITIONS: Record<VisibilityState, VisibilityState[]> = {
  idle:           ['deploying'],
  deploying:      ['live', 'live_hub_stale', 'failed'],
  live:           ['deploying'],
  live_hub_stale: ['deploying'],
  unpublished:    ['deploying'],
  failed:         ['deploying', 'idle'],
};

export function canTransition(from: VisibilityState, to: VisibilityState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: VisibilityState, to: VisibilityState): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal visibility transition: ${from} → ${to}`);
  }
}

export const STALE_DEPLOYING_MS = 60_000;

export function isDanglingDeploying(state: VisibilityState, updatedAt: Date, now = new Date()): boolean {
  if (state !== 'deploying') return false;
  return now.getTime() - updatedAt.getTime() > STALE_DEPLOYING_MS;
}
