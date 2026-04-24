import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface GuardConfig {
  blockArticleWrites: boolean;
  allowedIds: string[];
}

let cached: GuardConfig | null | undefined;

function load(): GuardConfig | null {
  if (cached !== undefined) return cached;
  // MONKEY_TEST bypass: shadow Supabase + FTP_DRY_RUN-gated context is already safe.
  if (process.env.MONKEY_TEST === 'true') return (cached = null);
  const p = join(process.cwd(), '.claude', 'session-guard.json');
  if (!existsSync(p)) return (cached = null);
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    cached = {
      blockArticleWrites: Boolean(raw.blockArticleWrites),
      allowedIds: Array.isArray(raw.allowedIds) ? raw.allowedIds : [],
    };
    return cached;
  } catch {
    return (cached = null);
  }
}

const VISIBILITY_FIELDS = new Set([
  'is_hub_visible',
  'visibility_state',
  'deployed_hash',
  'visibility_updated_at',
]);

export function assertArticleWriteAllowed(id: string | null, fields: string[]): void {
  const g = load();
  if (!g || !g.blockArticleWrites) return;
  if (id !== null && g.allowedIds.includes(id)) return;
  // 新規作成（id=null）は visibility フィールドのみ許容できないため問答無用でブロック
  if (id === null) {
    throw new Error(
      `session-guard: article create blocked (no id yet) fields=[${fields.join(',')}]. ` +
        `Set .claude/session-guard.json blockArticleWrites=false to allow.`,
    );
  }
  const touchesOnlyVisibility = fields.length > 0 && fields.every((f) => VISIBILITY_FIELDS.has(f));
  if (touchesOnlyVisibility) return;
  throw new Error(
    `session-guard: article write blocked for id=${id} fields=[${fields.join(',')}]. ` +
      `Set .claude/session-guard.json blockArticleWrites=false or add id to allowedIds.`,
  );
}

export function assertArticleDeleteAllowed(id: string): void {
  const g = load();
  if (!g || !g.blockArticleWrites) return;
  if (g.allowedIds.includes(id)) return;
  throw new Error(
    `session-guard: article delete blocked for id=${id}. ` +
      `Set .claude/session-guard.json blockArticleWrites=false or add id to allowedIds.`,
  );
}

export function resetSessionGuardCacheForTests(): void {
  cached = undefined;
}
