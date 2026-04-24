/**
 * Monkey test fixtures for publish-control-v2.
 * Spec: docs/specs/publish-control/19-monkey-test-plan.md
 *
 * Five-layer isolation enforced here:
 * 1. Dedicated harmony-dev Supabase project (URL guard against prod).
 * 2. FTP fully disabled (FTP_DRY_RUN=true, MONKEY_TEST=true asserted on uploads).
 * 3. `monkey-` slug namespace only.
 * 4. Pre/post non-monkey row-count snapshot — any drift fails the suite.
 * 5. Playwright route blocklist for harmony-mc.com and the prod Supabase hostname.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const PROD_SUBSTRINGS = ['khsorerqojgwbmtiqrac']; // prod Supabase project ref; extend as needed

export interface MonkeyEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
  baseUrl: string;
  seed: number;
}

export function loadMonkeyEnv(): MonkeyEnv {
  const supabaseUrl = mustEnv('MONKEY_SUPABASE_URL');
  const serviceRoleKey = mustEnv('MONKEY_SUPABASE_SERVICE_ROLE');
  const baseUrl = mustEnv('MONKEY_BASE_URL');
  const seed = Number(process.env.MONKEY_SEED ?? '1');

  // Layer 1: prod-DB guard.
  for (const bad of PROD_SUBSTRINGS) {
    if (supabaseUrl.includes(bad)) {
      throw new Error(`refuse to start: MONKEY_SUPABASE_URL looks like prod (${bad})`);
    }
  }

  // Base URL must not target prod Vercel.
  if (baseUrl.includes('blogauto-pi.vercel.app')) {
    throw new Error('refuse to start: MONKEY_BASE_URL targets production');
  }

  // FTP must be stubbed.
  if (process.env.FTP_DRY_RUN !== 'true' || process.env.MONKEY_TEST !== 'true') {
    throw new Error(
      'refuse to start: monkey test requires FTP_DRY_RUN=true and MONKEY_TEST=true in the dev-server env',
    );
  }

  // Feature flag must be on.
  if (process.env.PUBLISH_CONTROL_V2 !== 'on') {
    throw new Error('refuse to start: monkey test requires PUBLISH_CONTROL_V2=on in the dev-server env');
  }

  return { supabaseUrl, serviceRoleKey, baseUrl, seed };
}

export function makeAdminClient(env: MonkeyEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false } });
}

export async function countNonMonkeyArticles(sb: SupabaseClient): Promise<number> {
  const { count, error } = await sb
    .from('articles')
    .select('id', { head: true, count: 'exact' })
    .not('slug', 'ilike', 'monkey-%');
  if (error) throw new Error(`row-count snapshot failed: ${error.message}`);
  return count ?? 0;
}

export async function seedMonkeyArticles(sb: SupabaseClient, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const slug = `monkey-${Date.now()}-${i}`;
    const { data, error } = await sb
      .from('articles')
      .insert({
        title: `Monkey ${i}`,
        slug,
        status: 'published',
        stage3_final_html: `<html><body>monkey ${i}</body></html>`,
        published_at: new Date().toISOString(),
        is_hub_visible: false,
        visibility_state: 'idle',
      })
      .select('id')
      .single();
    if (error) throw new Error(`seed ${slug} failed: ${error.message}`);
    ids.push(data.id as string);
  }
  return ids;
}

export async function cleanupMonkeyArticles(sb: SupabaseClient): Promise<void> {
  const { data: monkeys, error: selErr } = await sb.from('articles').select('id').ilike('slug', 'monkey-%');
  if (selErr) throw selErr;
  const ids = (monkeys ?? []).map((r) => r.id as string);
  if (ids.length > 0) {
    const { error: delEvents } = await sb.from('publish_events').delete().in('article_id', ids);
    if (delEvents) throw delEvents;
  }
  const { error: delArticles } = await sb.from('articles').delete().ilike('slug', 'monkey-%');
  if (delArticles) throw delArticles;
}

export function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function ulid(rand: () => number): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let ms = Date.now();
  let t = '';
  for (let i = 0; i < 10; i++) {
    t = alphabet.charAt(ms % 32) + t;
    ms = Math.floor(ms / 32);
  }
  const r = Array.from({ length: 16 }, () => alphabet.charAt(Math.floor(rand() * 32))).join('');
  return t + r;
}

function mustEnv(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`${k} required for monkey test`);
  return v;
}

export { PROD_SUBSTRINGS };

// ─── Hub rebuild guarantee fixtures (spec §6.3) ─────────────────────────────
// These helpers stage DB data and read local FTP_DRY_RUN output only.
// They never reach real FTP — `assertSafeTarget` in ftp-uploader.ts enforces
// the `monkey-` slug prefix, which we preserve here.

export interface ReviewedMonkeyArticle {
  id: string;
  slug: string;
  title: string;
}

/**
 * Insert `count` monkey articles with `status='published'` AND a non-null
 * `reviewed_at` so they qualify for hub inclusion
 * (see `src/lib/generators/hub-generator.ts:427-432`).
 *
 * Slugs are `monkey-*` to satisfy `assertSafeTarget`
 * (src/lib/deploy/ftp-uploader.ts:156-167).
 */
export async function createReviewedMonkeyArticles(count: number): Promise<ReviewedMonkeyArticle[]> {
  const env = loadMonkeyEnv();
  const sb = makeAdminClient(env);
  const rows: ReviewedMonkeyArticle[] = [];
  const now = new Date().toISOString();
  for (let i = 0; i < count; i++) {
    const slug = `monkey-${Date.now()}-${i}`;
    const title = slug;
    const { data, error } = await sb
      .from('articles')
      .insert({
        title,
        slug,
        status: 'published',
        stage3_final_html: `<html><body>monkey reviewed ${i}</body></html>`,
        published_at: now,
        reviewed_at: now,
        is_hub_visible: false,
        visibility_state: 'idle',
      })
      .select('id')
      .single();
    if (error) throw new Error(`createReviewedMonkeyArticles ${slug} failed: ${error.message}`);
    rows.push({ id: data.id as string, slug, title });
  }
  return rows;
}

/**
 * Clear `reviewed_at` on the given article (DB-direct, bypasses the UI
 * checkbox path). Used to pre-condition hub-rebuild tests that need a
 * specific article to be unreviewed at start.
 */
export async function unreviewArticle(id: string): Promise<void> {
  const env = loadMonkeyEnv();
  const sb = makeAdminClient(env);
  const { error } = await sb.from('articles').update({ reviewed_at: null }).eq('id', id);
  if (error) throw new Error(`unreviewArticle ${id} failed: ${error.message}`);
}

/**
 * Read the dry-run hub `index.html` that `/api/hub/deploy` writes when
 * `FTP_DRY_RUN=true`. Path mirrors `dryRunWrite` in
 * `src/lib/deploy/ftp-uploader.ts:169-186` — i.e.
 * `tmp/ftp-dry-run/{FTP_REMOTE_PATH}/index.html`.
 */
export async function readDryRunHubIndex(): Promise<string> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const remoteBasePath = process.env.FTP_REMOTE_PATH || '/public_html/column/columns/';
  const full = path.join(process.cwd(), 'tmp', 'ftp-dry-run', remoteBasePath, 'index.html');
  try {
    return await fs.readFile(full, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `readDryRunHubIndex: could not read ${full} (${msg}). ` +
        `Ensure FTP_DRY_RUN=true is set in the dev-server env and that /api/hub/deploy ran at least once.`,
    );
  }
}

/**
 * Case-sensitive substring check for a slug in hub HTML output.
 * Kept intentionally dumb — tests assert "slug appears somewhere in the
 * rendered hub", which is sufficient for the rebuild-guarantee scenarios.
 */
export function hubIndexContainsSlug(html: string, slug: string): boolean {
  return html.includes(slug);
}
