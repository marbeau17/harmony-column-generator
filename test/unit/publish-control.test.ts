import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

import {
  canTransition,
  assertTransition,
  isDanglingDeploying,
  STALE_DEPLOYING_MS,
} from '@/lib/publish-control/state-machine';
import { checkVisibilityGuard } from '@/lib/publish-control/guards';
import { hashHtml, isValidRequestId } from '@/lib/publish-control/idempotency';
import { renderSoftWithdrawalHtml } from '@/lib/publish-control/soft-withdrawal';
import {
  assertArticleWriteAllowed,
  assertArticleDeleteAllowed,
  resetSessionGuardCacheForTests,
} from '@/lib/publish-control/session-guard';

describe('state-machine', () => {
  it('allows idle → deploying', () => {
    expect(canTransition('idle', 'deploying')).toBe(true);
  });

  it('rejects idle → live (must go through deploying)', () => {
    expect(canTransition('idle', 'live')).toBe(false);
  });

  it('allows deploying → live, live_hub_stale, failed', () => {
    expect(canTransition('deploying', 'live')).toBe(true);
    expect(canTransition('deploying', 'live_hub_stale')).toBe(true);
    expect(canTransition('deploying', 'failed')).toBe(true);
  });

  it('rejects deploying → deploying (no self-loop)', () => {
    expect(canTransition('deploying', 'deploying')).toBe(false);
  });

  it('allows re-deploy from any terminal state', () => {
    expect(canTransition('live', 'deploying')).toBe(true);
    expect(canTransition('unpublished', 'deploying')).toBe(true);
    expect(canTransition('failed', 'deploying')).toBe(true);
    expect(canTransition('live_hub_stale', 'deploying')).toBe(true);
  });

  it('assertTransition throws on illegal transition', () => {
    expect(() => assertTransition('idle', 'live')).toThrow(/illegal visibility transition/);
  });

  it('detects dangling deploying past threshold', () => {
    const now = new Date('2026-04-19T10:00:00Z');
    const old = new Date(now.getTime() - STALE_DEPLOYING_MS - 1_000);
    const fresh = new Date(now.getTime() - 10_000);
    expect(isDanglingDeploying('deploying', old, now)).toBe(true);
    expect(isDanglingDeploying('deploying', fresh, now)).toBe(false);
    expect(isDanglingDeploying('live', old, now)).toBe(false);
  });
});

describe('guards.checkVisibilityGuard', () => {
  const base = {
    status: 'published' as const,
    stage3_final_html: '<html>…</html>',
    is_hub_visible: false,
    visible_target: true,
  };

  it('allows publishing a published article with html', () => {
    expect(checkVisibilityGuard(base).ok).toBe(true);
  });

  it('blocks publishing when status != published', () => {
    const r = checkVisibilityGuard({ ...base, status: 'draft' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_PUBLISHED');
  });

  it('blocks publishing when no stage3 html', () => {
    const r = checkVisibilityGuard({ ...base, stage3_final_html: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NO_HTML');
  });

  it('blocks no-op (already visible, target=visible)', () => {
    const r = checkVisibilityGuard({ ...base, is_hub_visible: true, visible_target: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOOP');
  });

  it('allows unpublishing a published visible article', () => {
    const r = checkVisibilityGuard({ ...base, is_hub_visible: true, visible_target: false });
    expect(r.ok).toBe(true);
  });

  it('allows unpublishing regardless of status (to clean up)', () => {
    const r = checkVisibilityGuard({
      ...base,
      status: 'draft',
      is_hub_visible: true,
      visible_target: false,
    });
    expect(r.ok).toBe(true);
  });
});

describe('idempotency', () => {
  it('hashes deterministically', () => {
    expect(hashHtml('<p>hi</p>')).toBe(hashHtml('<p>hi</p>'));
    expect(hashHtml('<p>hi</p>')).not.toBe(hashHtml('<p>hello</p>'));
  });

  it('validates ULIDs', () => {
    expect(isValidRequestId('01HK4ZQ5A9N8M7TEST123456XYZ'.slice(0, 26))).toBe(true);
    expect(isValidRequestId('')).toBe(false);
    expect(isValidRequestId('TOO_SHORT')).toBe(false);
    expect(isValidRequestId(42)).toBe(false);
    expect(isValidRequestId(null)).toBe(false);
  });
});

describe('soft-withdrawal html', () => {
  it('includes noindex meta', () => {
    const html = renderSoftWithdrawalHtml({ title: 'テスト記事' });
    expect(html).toMatch(/<meta name="robots" content="noindex,noarchive,nofollow">/);
    expect(html).toContain('テスト記事');
  });

  it('escapes dangerous characters in title', () => {
    const html = renderSoftWithdrawalHtml({ title: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('session-guard', () => {
  const guardPath = join(process.cwd(), '.claude', 'session-guard.json');
  const backupPath = guardPath + '.unit-backup';
  const backupExists = existsSync(guardPath);

  afterEach(() => {
    if (existsSync(backupPath)) {
      renameSync(backupPath, guardPath);
    } else if (existsSync(guardPath) && !backupExists) {
      unlinkSync(guardPath);
    }
    resetSessionGuardCacheForTests();
  });

  function writeGuard(contents: unknown): void {
    if (existsSync(guardPath) && !existsSync(backupPath)) {
      renameSync(guardPath, backupPath);
    }
    mkdirSync(join(process.cwd(), '.claude'), { recursive: true });
    writeFileSync(guardPath, JSON.stringify(contents), 'utf8');
    resetSessionGuardCacheForTests();
  }

  it('blocks arbitrary field writes when blockArticleWrites=true', () => {
    writeGuard({ blockArticleWrites: true, allowedIds: [] });
    expect(() => assertArticleWriteAllowed('00000000-0000-0000-0000-000000000001', ['title'])).toThrow(
      /session-guard: article write blocked/,
    );
  });

  it('allows writes limited to visibility fields (publish-control path)', () => {
    writeGuard({ blockArticleWrites: true, allowedIds: [] });
    expect(() =>
      assertArticleWriteAllowed('00000000-0000-0000-0000-000000000001', [
        'is_hub_visible',
        'visibility_state',
        'visibility_updated_at',
      ]),
    ).not.toThrow();
  });

  it('allows writes for allowlisted ids', () => {
    writeGuard({ blockArticleWrites: true, allowedIds: ['00000000-0000-0000-0000-000000000002'] });
    expect(() => assertArticleWriteAllowed('00000000-0000-0000-0000-000000000002', ['title'])).not.toThrow();
  });

  it('is a no-op when blockArticleWrites=false', () => {
    writeGuard({ blockArticleWrites: false });
    expect(() => assertArticleWriteAllowed('x', ['title'])).not.toThrow();
  });

  it('is a no-op when the guard file is absent', () => {
    if (existsSync(guardPath) && !existsSync(backupPath)) {
      renameSync(guardPath, backupPath);
    }
    resetSessionGuardCacheForTests();
    expect(() => assertArticleWriteAllowed('x', ['title'])).not.toThrow();
  });

  it('rejects mixed field writes (visibility + content)', () => {
    writeGuard({ blockArticleWrites: true, allowedIds: [] });
    expect(() =>
      assertArticleWriteAllowed('00000000-0000-0000-0000-000000000003', [
        'is_hub_visible',
        'title', // content field — should not slip through
      ]),
    ).toThrow(/session-guard/);
  });

  it('blocks createArticle (id=null) when blockArticleWrites=true', () => {
    writeGuard({ blockArticleWrites: true, allowedIds: [] });
    expect(() => assertArticleWriteAllowed(null, ['title', 'keyword'])).toThrow(
      /session-guard: article create blocked/,
    );
  });

  it('allows createArticle (id=null) when blockArticleWrites=false', () => {
    writeGuard({ blockArticleWrites: false });
    expect(() => assertArticleWriteAllowed(null, ['title'])).not.toThrow();
  });

  it('blocks deletes when blockArticleWrites=true', () => {
    writeGuard({ blockArticleWrites: true, allowedIds: [] });
    expect(() => assertArticleDeleteAllowed('00000000-0000-0000-0000-000000000004')).toThrow(
      /session-guard: article delete blocked/,
    );
  });

  it('allows deletes for allowlisted ids', () => {
    writeGuard({ blockArticleWrites: true, allowedIds: ['00000000-0000-0000-0000-000000000005'] });
    expect(() => assertArticleDeleteAllowed('00000000-0000-0000-0000-000000000005')).not.toThrow();
  });

  it('delete is a no-op when blockArticleWrites=false', () => {
    writeGuard({ blockArticleWrites: false });
    expect(() => assertArticleDeleteAllowed('x')).not.toThrow();
  });

  describe('MONKEY_TEST bypass — strengthened', () => {
    const ORIG_MONKEY = process.env.MONKEY_TEST;
    const ORIG_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

    afterEach(() => {
      process.env.MONKEY_TEST = ORIG_MONKEY;
      process.env.NEXT_PUBLIC_SUPABASE_URL = ORIG_URL;
      resetSessionGuardCacheForTests();
    });

    it('bypasses guard when MONKEY_TEST=true AND SUPABASE_URL is localhost', () => {
      writeGuard({ blockArticleWrites: true, allowedIds: [] });
      process.env.MONKEY_TEST = 'true';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
      resetSessionGuardCacheForTests();
      expect(() => assertArticleWriteAllowed('any-id', ['title'])).not.toThrow();
    });

    it('does NOT bypass guard when MONKEY_TEST=true AND SUPABASE_URL is production', () => {
      writeGuard({ blockArticleWrites: true, allowedIds: [] });
      process.env.MONKEY_TEST = 'true';
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://khsorerqojgwbmtiqrac.supabase.co';
      resetSessionGuardCacheForTests();
      expect(() => assertArticleWriteAllowed('any-id', ['title'])).toThrow(/session-guard/);
    });
  });
});
