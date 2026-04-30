/**
 * Zero-Generation E2E fixtures (spec §13.4 / §13.2)
 *
 * 既存の monkey-fixtures.ts と同じ防御層 (prod-DB ガード, FTP_DRY_RUN 必須) を
 * 流用しつつ、`zg_` プレフィックスで名前空間を完全に分離する。
 *
 * 重要な不変量:
 *   1. 本ヘルパは `zg_` で始まる name/slug を持つレコードしか作らない/消さない。
 *   2. 既存記事 (45 件) や monkey-* 名前空間には絶対に触れない。
 *   3. cleanupZeroFixtures() は必ず子→親の順で削除し、FK 違反を起こさない。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// 本番 Supabase project ref。monkey-fixtures と同期させる。
const PROD_SUBSTRINGS = ['khsorerqojgwbmtiqrac'];

export const ZG_PREFIX = 'zg_';

export interface ZeroGenEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
  baseUrl: string;
  seed: number;
}

/**
 * 環境変数を読み込む。monkey-fixtures と同じキーを再利用することで、
 * dev サーバを 1 つ立ち上げれば両 suite を回せるようにする。
 */
export function loadZeroGenEnv(): ZeroGenEnv {
  const supabaseUrl = mustEnv('MONKEY_SUPABASE_URL');
  const serviceRoleKey = mustEnv('MONKEY_SUPABASE_SERVICE_ROLE');
  const baseUrl = mustEnv('MONKEY_BASE_URL');
  const seed = Number(process.env.MONKEY_SEED ?? '1');

  for (const bad of PROD_SUBSTRINGS) {
    if (supabaseUrl.includes(bad)) {
      throw new Error(`refuse to start: MONKEY_SUPABASE_URL looks like prod (${bad})`);
    }
  }
  if (baseUrl.includes('blogauto-pi.vercel.app')) {
    throw new Error('refuse to start: MONKEY_BASE_URL targets production');
  }
  if (process.env.FTP_DRY_RUN !== 'true' || process.env.MONKEY_TEST !== 'true') {
    throw new Error(
      'refuse to start: zero-generation E2E requires FTP_DRY_RUN=true and MONKEY_TEST=true in the dev-server env',
    );
  }

  return { supabaseUrl, serviceRoleKey, baseUrl, seed };
}

export function makeZeroGenAdminClient(env: ZeroGenEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false } });
}

export interface CreatedTheme {
  id: string;
  name: string;
  slug: string;
}

export interface CreatedPersona {
  id: string;
  name: string;
}

/**
 * `zg_` プレフィックス強制で theme を 1 件作成する。
 * spec §13.4: themes 8 件まで使う想定だが、各テストが独立して呼ぶ前提。
 */
export async function createZeroTheme(name: string): Promise<CreatedTheme> {
  if (!name.startsWith(ZG_PREFIX)) {
    throw new Error(`createZeroTheme: name must start with "${ZG_PREFIX}" (got: ${name})`);
  }
  const env = loadZeroGenEnv();
  const sb = makeZeroGenAdminClient(env);
  const slug = `${name}-${Date.now()}`;
  const { data, error } = await sb
    .from('themes')
    .insert({
      name,
      slug,
      category: 'spiritual',
      description: `Zero-generation E2E fixture: ${name}`,
      is_active: true,
    })
    .select('id, name, slug')
    .single();
  if (error) throw new Error(`createZeroTheme(${name}) failed: ${error.message}`);
  return { id: data.id as string, name: data.name as string, slug: data.slug as string };
}

/**
 * `zg_` プレフィックス強制で persona を 1 件作成する。
 * preferred_words / avoided_words / cta_default_stage は zero-generation v1 で
 * 追加された列 (20260501000000_zero_generation_v1.sql) なので、ここでも初期化する。
 */
export async function createZeroPersona(name: string): Promise<CreatedPersona> {
  if (!name.startsWith(ZG_PREFIX)) {
    throw new Error(`createZeroPersona: name must start with "${ZG_PREFIX}" (got: ${name})`);
  }
  const env = loadZeroGenEnv();
  const sb = makeZeroGenAdminClient(env);
  const { data, error } = await sb
    .from('personas')
    .insert({
      name,
      age_range: '30-45',
      description: `Zero-generation E2E fixture persona: ${name}`,
      tone_guide: '優しく、断定せず、比喩を交えて',
      cta_approach: 'empathy',
      preferred_words: ['寄り添う', '光', '気づき'],
      avoided_words: ['絶対', '必ず', '断言'],
      cta_default_stage: 'empathy',
      is_active: true,
    })
    .select('id, name')
    .single();
  if (error) throw new Error(`createZeroPersona(${name}) failed: ${error.message}`);
  return { id: data.id as string, name: data.name as string };
}

/**
 * すべての zg_* レコードを削除する。子→親順で FK 違反を回避。
 *
 * 削除対象:
 *   - articles (title or slug が zg_ で始まる) → cta_variants / article_claims / article_revisions / publish_events も CASCADE
 *   - source_articles (title が zg_ で始まる) → source_chunks も CASCADE
 *   - themes (name が zg_ で始まる)
 *   - personas (name が zg_ で始まる)
 *
 * 既存記事 (非 zg_) には絶対触れない。
 */
export async function cleanupZeroFixtures(): Promise<void> {
  const env = loadZeroGenEnv();
  const sb = makeZeroGenAdminClient(env);

  // 1. articles (CASCADE で article_claims / cta_variants / article_revisions / publish_events も消える)
  await sb.from('articles').delete().ilike('title', `${ZG_PREFIX}%`);
  await sb.from('articles').delete().ilike('slug', `${ZG_PREFIX}%`);

  // 2. source_articles (CASCADE で source_chunks も消える)
  await sb.from('source_articles').delete().ilike('title', `${ZG_PREFIX}%`);

  // 3. themes
  await sb.from('themes').delete().ilike('name', `${ZG_PREFIX}%`);

  // 4. personas
  await sb.from('personas').delete().ilike('name', `${ZG_PREFIX}%`);
}

/**
 * 非 zg_ レコード件数を取得し、テスト前後で drift していないことを保証するためのカウンタ。
 * monkey-fixtures.countNonMonkeyArticles と同じ思想。
 */
export async function countNonZeroArticles(sb: SupabaseClient): Promise<number> {
  const { count, error } = await sb
    .from('articles')
    .select('id', { head: true, count: 'exact' })
    .not('title', 'ilike', `${ZG_PREFIX}%`)
    .not('slug', 'ilike', `${ZG_PREFIX}%`);
  if (error) throw new Error(`countNonZeroArticles failed: ${error.message}`);
  return count ?? 0;
}

function mustEnv(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`${k} required for zero-generation E2E`);
  return v;
}

export { PROD_SUBSTRINGS };
