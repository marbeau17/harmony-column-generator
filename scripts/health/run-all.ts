/**
 * P5-61: Article Health Monitor — 12 項目の自動ヘルスチェックを集約実行。
 *
 * 設計参照: docs/refactor/article-health-monitor.md
 *
 * 使い方:
 *   tsx scripts/health/run-all.ts                # JSON サマリを stdout
 *   tsx scripts/health/run-all.ts --strict       # critical >0 で exit 1
 *   tsx scripts/health/run-all.ts --very-strict  # critical or high >0 で exit 1
 *   tsx scripts/health/run-all.ts --skip-http    # H-05 (URL probe) を skip
 *   tsx scripts/health/run-all.ts --json out.json # ファイル出力
 *
 * GitHub Actions / Vercel cron どちらからも import 可能。
 */
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import { buildDeployHtml } from '../../src/lib/deploy/article-html-builder';
import { runTemplateCheck } from '../../src/lib/content/html-template-validator';
import type { Article } from '../../src/types/article';

// .env.local 読み込み
try {
  const env = fs.readFileSync('.env.local', 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
} catch {
  // env file may not exist in CI
}

const STRICT = process.argv.includes('--strict');
const VERY_STRICT = process.argv.includes('--very-strict');
const SKIP_HTTP = process.argv.includes('--skip-http');
const jsonArgIdx = process.argv.indexOf('--json');
const JSON_OUT_PATH = jsonArgIdx > 0 ? process.argv[jsonArgIdx + 1] : null;

type Severity = 'critical' | 'high' | 'medium';

interface HealthResult {
  id: string; // H-01 等
  label: string;
  severity: Severity;
  ok: boolean;
  detail: string;
  failedSamples?: { id: string; slug: string | null; note: string }[];
}

const PUBLIC_BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://harmony-mc.com';
const HUB_PATH = process.env.NEXT_PUBLIC_HUB_PATH || '/spiritual/column';

// CI 環境（GitHub Actions / Vercel cron）からの fetch は一部 CDN/WAF が
// "harmony-health-monitor/1.0" のような独自 UA を bot 判定して block するケースがあり、
// status=0 (TypeError: fetch failed) で落ちる。一般ブラウザ相当の UA を使用する。
const FETCH_UA =
  'Mozilla/5.0 (compatible; HarmonyHealthMonitor/1.0; +https://harmony-mc.com)';

async function fetchWithTimeout(
  url: string,
  ms = 15000,
  retries = 2,
): Promise<{ status: number; text?: string; error?: string }> {
  let lastError = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': FETCH_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return { status: res.status };
      const text = await res.text();
      return { status: res.status, text };
    } catch (e) {
      clearTimeout(timer);
      lastError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  return { status: 0, error: lastError };
}

async function fetchPublicHtml(slug: string): Promise<{ status: number; html?: string }> {
  const url = `${PUBLIC_BASE}${HUB_PATH}/${slug}/index.html`;
  const r = await fetchWithTimeout(url);
  return { status: r.status, html: r.text };
}

/**
 * HEAD probe (本文ダウンロードを避けるため画像系で使用)。
 * H-18 で各 live 記事の hero/body/summary 画像 URL の 200 応答を確認する。
 */
async function headPublicUrl(url: string, ms = 10000): Promise<{ status: number; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': FETCH_UA, 'Cache-Control': 'no-cache' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    return { status: res.status };
  } catch (e) {
    clearTimeout(timer);
    return { status: 0, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

async function main(): Promise<void> {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // 公開記事を全件取得
  const { data: articles, error } = await sb
    .from('articles')
    .select('id, slug, title, generation_mode, status, visibility_state, reviewed_at, stage2_body_html, stage3_final_html, related_articles')
    .in('visibility_state', ['live', 'live_hub_stale']);

  if (error) {
    console.error('SELECT error:', error.message);
    process.exit(2);
  }

  const list = articles ?? [];
  const results: HealthResult[] = [];

  // ── H-01 / H-02: HTML 構造 (DB stage3_final_html ベース) ───────────────────
  const h01Failed: HealthResult['failedSamples'] = [];
  const h02Failed: HealthResult['failedSamples'] = [];
  for (const a of list) {
    const html = (a.stage3_final_html as string) ?? '';
    const mainCount = (html.match(/<main\b[^>]*>/gi) ?? []).length;
    const footerCount = (html.match(/<footer\b[^>]*>/gi) ?? []).length;
    if (mainCount !== 1) {
      h01Failed.push({ id: a.id as string, slug: (a.slug as string) ?? null, note: `main=${mainCount}` });
    }
    if (footerCount !== 1) {
      h02Failed.push({ id: a.id as string, slug: (a.slug as string) ?? null, note: `footer=${footerCount}` });
    }
  }
  results.push({
    id: 'H-01', label: '<main> ちょうど 1 個', severity: 'critical',
    ok: h01Failed.length === 0,
    detail: `${list.length - h01Failed.length}/${list.length}`,
    failedSamples: h01Failed.slice(0, 5),
  });
  results.push({
    id: 'H-02', label: '<footer> ちょうど 1 個', severity: 'critical',
    ok: h02Failed.length === 0,
    detail: `${list.length - h02Failed.length}/${list.length}`,
    failedSamples: h02Failed.slice(0, 5),
  });

  // ── H-03: <!--<img 不正コメント (stage2_body_html) ─────────────────────────
  const h03Failed: HealthResult['failedSamples'] = [];
  for (const a of list) {
    const s2 = (a.stage2_body_html as string) ?? '';
    if (s2.includes('<!--<img')) {
      h03Failed.push({ id: a.id as string, slug: (a.slug as string) ?? null, note: '<!--<img 残存' });
    }
  }
  results.push({
    id: 'H-03', label: '<!--<img 不正コメント 0 件', severity: 'high',
    ok: h03Failed.length === 0,
    detail: `clean: ${list.length - h03Failed.length}/${list.length}`,
    failedSamples: h03Failed.slice(0, 5),
  });

  // ── H-04: {{...}} プレースホルダ残存 ──────────────────────────────────────
  const h04Failed: HealthResult['failedSamples'] = [];
  for (const a of list) {
    const s3 = (a.stage3_final_html as string) ?? '';
    const matches = s3.match(/\{\{[^}]+\}\}/g) ?? [];
    if (matches.length > 0) {
      h04Failed.push({
        id: a.id as string,
        slug: (a.slug as string) ?? null,
        note: `${matches.length} 個 (${matches[0]})`,
      });
    }
  }
  results.push({
    id: 'H-04', label: '{{...}} プレースホルダ残存 0', severity: 'critical',
    ok: h04Failed.length === 0,
    detail: `clean: ${list.length - h04Failed.length}/${list.length}`,
    failedSamples: h04Failed.slice(0, 5),
  });

  // ── H-05: published URL HTTP 応答 ─────────────────────────────────────────
  if (!SKIP_HTTP) {
    const h05Failed: HealthResult['failedSamples'] = [];
    let http200 = 0;
    const concurrency = 8;
    const queue = list.filter((a) => a.slug);
    while (queue.length > 0) {
      const batch = queue.splice(0, concurrency);
      const probed = await Promise.all(
        batch.map(async (a) => ({
          a,
          res: await fetchPublicHtml(a.slug as string),
        })),
      );
      for (const { a, res } of probed) {
        if (res.status === 200) http200++;
        else if (res.status !== 301) {
          h05Failed.push({
            id: a.id as string,
            slug: (a.slug as string) ?? null,
            note: `status=${res.status}`,
          });
        }
      }
    }
    results.push({
      id: 'H-05', label: 'published URL 200 応答', severity: 'critical',
      ok: h05Failed.length === 0,
      detail: `200: ${http200}/${list.length}`,
      failedSamples: h05Failed.slice(0, 5),
    });
  } else {
    results.push({
      id: 'H-05', label: 'published URL 200 応答', severity: 'critical',
      ok: true, detail: 'SKIPPED (--skip-http)',
    });
  }

  // ── H-06: 関連記事 generation_mode 一致 ──────────────────────────────────
  const slugToMode = new Map<string, string | null>();
  for (const a of list) slugToMode.set((a.slug as string) ?? '', a.generation_mode as string | null);

  const h06Failed: HealthResult['failedSamples'] = [];
  for (const a of list) {
    const myMode = a.generation_mode;
    const rel = (a.related_articles as { href: string }[] | null) ?? [];
    for (const r of rel) {
      const refSlug = r.href.match(/\/([^/]+)\/(?:index\.html)?$/)?.[1];
      if (refSlug && slugToMode.has(refSlug)) {
        const refMode = slugToMode.get(refSlug);
        if (refMode !== myMode) {
          h06Failed.push({
            id: a.id as string,
            slug: (a.slug as string) ?? null,
            note: `${myMode}→${refMode} (${refSlug})`,
          });
          break;
        }
      }
    }
  }
  results.push({
    id: 'H-06', label: '関連記事 generation_mode 一致', severity: 'high',
    ok: h06Failed.length === 0,
    detail: `clean: ${list.length - h06Failed.length}/${list.length}`,
    failedSamples: h06Failed.slice(0, 5),
  });

  // ── H-07: sitemap.xml URL 件数 (記事 URL のみ抽出して比較) ───────────────
  if (!SKIP_HTTP) {
    // .env.local の NEXT_PUBLIC_APP_URL は dev 用 (localhost:3000) のため、
    // 本番ヘルスチェックでは HEALTH_SITEMAP_URL > NEXT_PUBLIC_APP_URL(非localhost) > 本番デフォルト
    // の優先順位で解決する。CI/cron で localhost に向かないようにする。
    const envAppUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
    const isLocalAppUrl = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(envAppUrl);
    const sitemapBase =
      process.env.HEALTH_SITEMAP_BASE ||
      (envAppUrl && !isLocalAppUrl ? envAppUrl : 'https://blogauto-pi.vercel.app');
    const sm = await fetchWithTimeout(`${sitemapBase}/sitemap.xml`);
    const sitemapStatus = sm.status;
    const xml = sm.text ?? '';
    // 記事 URL = "/spiritual/column/{slug}/index.html" 形式。ハブ・テーマページは除外。
    const articleLocPattern = new RegExp(
      `<loc>[^<]*${HUB_PATH.replace(/\//g, '\\/')}\\/[^<\\/]+\\/index\\.html<\\/loc>`,
      'g',
    );
    const sitemapArticleUrls = (xml.match(articleLocPattern) ?? []).length;
    const sitemapTotalUrls = (xml.match(/<loc>/g) ?? []).length;
    const expectedCount = list.filter((a) => a.generation_mode === 'zero').length;
    const ok = sitemapStatus === 200 && sitemapArticleUrls === expectedCount;
    let detail: string;
    if (sitemapStatus === 0) {
      detail = `fetch failed (${sm.error ?? 'unknown'})`;
    } else if (sitemapStatus !== 200) {
      detail = `HTTP ${sitemapStatus}`;
    } else {
      detail = `sitemap article=${sitemapArticleUrls} (total loc=${sitemapTotalUrls}) vs zero-gen=${expectedCount}`;
    }
    results.push({
      id: 'H-07', label: 'sitemap.xml 全 zero-gen 出力', severity: 'high',
      ok,
      detail,
    });
  } else {
    results.push({ id: 'H-07', label: 'sitemap.xml 全 zero-gen 出力', severity: 'high', ok: true, detail: 'SKIPPED' });
  }

  // ── H-08: ハブ記事数 vs DB zero-gen 数 (簡易: HTML 内 article-card 数) ──
  if (!SKIP_HTTP) {
    const hub = await fetchWithTimeout(`${PUBLIC_BASE}${HUB_PATH}/index.html`);
    const hubStatus = hub.status;
    const html = hub.text ?? '';
    const hubCount = (html.match(/<a [^>]*class="article-card"/g) ?? []).length;
    const expectedHub = list.filter((a) => a.generation_mode === 'zero').length;
    const ok = hubStatus === 200 && hubCount === expectedHub;
    let detail: string;
    if (hubStatus === 0) {
      detail = `fetch failed (${hub.error ?? 'unknown'})`;
    } else if (hubStatus !== 200) {
      detail = `HTTP ${hubStatus}`;
    } else {
      detail = `hub=${hubCount} vs zero-gen=${expectedHub}`;
    }
    results.push({
      id: 'H-08', label: 'ハブ記事数 == DB zero-gen 数', severity: 'medium',
      ok,
      detail,
    });
  } else {
    results.push({ id: 'H-08', label: 'ハブ記事数 == DB zero-gen 数', severity: 'medium', ok: true, detail: 'SKIPPED' });
  }

  // ── H-09: parity (reviewed_at vs visibility_state) blocker ──────────────
  let parityBlockers = 0;
  for (const a of list) {
    const reviewed = a.reviewed_at != null;
    const isPublic = ['live', 'live_hub_stale'].includes((a.visibility_state as string) ?? '');
    if (!reviewed && isPublic) parityBlockers++; // B blocker
    // A1 (audit drift) は許容
  }
  results.push({
    id: 'H-09', label: 'parity blocker 0 件', severity: 'critical',
    ok: parityBlockers === 0,
    detail: `B blockers: ${parityBlockers}`,
  });

  // ── H-10: placeholder mismatch カウント (stage2 中 IMAGE: 残存) ─────────
  const h10Failed: HealthResult['failedSamples'] = [];
  for (const a of list) {
    const s2 = (a.stage2_body_html as string) ?? '';
    const imageHits = (s2.match(/<!--\s*IMAGE[：:]/g) ?? []).length;
    if (imageHits > 0) {
      h10Failed.push({
        id: a.id as string,
        slug: (a.slug as string) ?? null,
        note: `${imageHits} 個 IMAGE: 残存`,
      });
    }
  }
  results.push({
    id: 'H-10', label: 'placeholder mismatched 0', severity: 'high',
    ok: h10Failed.length === 0,
    detail: `clean: ${list.length - h10Failed.length}/${list.length}`,
    failedSamples: h10Failed.slice(0, 5),
  });

  // ── H-11: CTA 出現回数 (各記事 3 回が期待) ────────────────────────────
  const h11Failed: HealthResult['failedSamples'] = [];
  for (const a of list) {
    const s3 = (a.stage3_final_html as string) ?? '';
    const ctaCount = (s3.match(/harmony-booking\.web\.app/g) ?? []).length;
    if (ctaCount < 3) {
      h11Failed.push({
        id: a.id as string,
        slug: (a.slug as string) ?? null,
        note: `CTA=${ctaCount}`,
      });
    }
  }
  results.push({
    id: 'H-11', label: 'CTA 出現 >= 3 回', severity: 'medium',
    ok: h11Failed.length === 0,
    detail: `clean: ${list.length - h11Failed.length}/${list.length}`,
    failedSamples: h11Failed.slice(0, 5),
  });

  // ── H-12: disclaimer (免責事項) 末尾付与 ───────────────────────────────
  const h12Failed: HealthResult['failedSamples'] = [];
  for (const a of list) {
    const s3 = (a.stage3_final_html as string) ?? '';
    if (!s3.includes('本コラムの内容')) {
      h12Failed.push({
        id: a.id as string,
        slug: (a.slug as string) ?? null,
        note: 'disclaimer 不在',
      });
    }
  }
  results.push({
    id: 'H-12', label: 'disclaimer 末尾付与', severity: 'medium',
    ok: h12Failed.length === 0,
    detail: `clean: ${list.length - h12Failed.length}/${list.length}`,
    failedSamples: h12Failed.slice(0, 5),
  });

  // P5-67: H-13 — stuck finalizing ジョブ検知 ─────────────────────────────────
  // generation_jobs で stage IN ('image_generating','finalizing') かつ
  // updated_at から 5 分以上経過しているジョブをカウント。期待値 0 件。
  const STUCK_THRESHOLD_MS = 5 * 60 * 1000;
  const stuckCutoffIso = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();
  const { data: stuckJobs, error: stuckErr } = await sb
    .from('generation_jobs')
    .select('id, stage, updated_at, article_id')
    .in('stage', ['image_generating', 'finalizing'])
    .lt('updated_at', stuckCutoffIso);

  const h13Failed: HealthResult['failedSamples'] = [];
  if (stuckErr) {
    h13Failed.push({
      id: 'query-error',
      slug: null,
      note: `SELECT error: ${stuckErr.message}`,
    });
  } else {
    for (const j of stuckJobs ?? []) {
      h13Failed.push({
        id: j.id as string,
        slug: (j.article_id as string) ?? null,
        note: `stage=${j.stage} updated_at=${j.updated_at}`,
      });
    }
  }
  results.push({
    id: 'H-13', label: 'stuck finalizing ジョブ 0 件', severity: 'high',
    ok: !stuckErr && (stuckJobs ?? []).length === 0,
    detail: stuckErr
      ? `query failed: ${stuckErr.message}`
      : `stuck: ${(stuckJobs ?? []).length} 件 (>5min in image_generating/finalizing)`,
    failedSamples: h13Failed.slice(0, 5),
  });

  // ── H-14: visibility=live なのに deployed_hash=null の記事 ───────────────
  // DB 上 live (or live_hub_stale) だが deployed_hash が null = FTP 未到達の可能性。
  // 注意: 現状 deploy/route.ts は articles.deployed_hash を書き込んでいないため、
  //       deploy route が hash 書き込みを実装するまでは恒常的に fail となる。
  //       follow-up として deploy/route.ts での hash 更新が必要。
  const { data: driftRows, error: driftErr } = await sb
    .from('articles')
    .select('id, slug, visibility_state, deployed_hash')
    .in('visibility_state', ['live', 'live_hub_stale'])
    .is('deployed_hash', null);

  const h14Failed: HealthResult['failedSamples'] = [];
  if (driftErr) {
    h14Failed.push({
      id: 'query-error',
      slug: null,
      note: `SELECT error: ${driftErr.message}`,
    });
  } else {
    for (const r of driftRows ?? []) {
      h14Failed.push({
        id: r.id as string,
        slug: (r.slug as string) ?? null,
        note: `visibility=${r.visibility_state} deployed_hash=null`,
      });
    }
  }
  const driftCount = (driftRows ?? []).length;
  results.push({
    id: 'H-14', label: 'visibility=live なのに deployed_hash=null の記事 0 件', severity: 'high',
    ok: !driftErr && driftCount === 0,
    detail: driftErr
      ? `query failed: ${driftErr.message}`
      : driftCount === 0
        ? '全 live 記事に deployed_hash あり'
        : `${driftCount} 件が DB live なのに deployed_hash=null (FTP 未到達の可能性) / note: deploy/route.ts が成功時に articles.deployed_hash を更新するよう follow-up が必要`,
    failedSamples: h14Failed.slice(0, 10),
  });

  // ── H-15: zero-mode drift (live なのに generation_mode != 'zero') ────────
  // P5-85 以降、live / live_hub_stale な記事は generation_mode='zero' のみ許容。
  // source-mode が live に紛れ込んでいる場合は drift。
  const h15Failed: HealthResult['failedSamples'] = [];
  for (const a of list) {
    if ((a.generation_mode as string | null) !== 'zero') {
      h15Failed.push({
        id: a.id as string,
        slug: (a.slug as string) ?? null,
        note: `generation_mode=${a.generation_mode ?? 'null'} visibility=${a.visibility_state}`,
      });
    }
  }
  results.push({
    id: 'H-15', label: 'live 記事は generation_mode=zero のみ', severity: 'critical',
    ok: h15Failed.length === 0,
    detail: h15Failed.length === 0
      ? `clean: ${list.length}/${list.length}`
      : `${h15Failed.length} 件の source-mode drift`,
    failedSamples: h15Failed.slice(0, 10),
  });

  // ── H-16: FTP source-mode orphan probe ───────────────────────────────────
  // 公開 (status='published') かつ source-mode の slug をランダム 3 件取得し、
  // 本番 URL に GET。200 を返すなら P5-85 以前の orphan が残置している。
  if (!SKIP_HTTP) {
    const { data: sourceCandidates, error: srcErr } = await sb
      .from('articles')
      .select('id, slug')
      .eq('status', 'published')
      .eq('generation_mode', 'source')
      .not('slug', 'is', null)
      .limit(50);

    const h16Failed: HealthResult['failedSamples'] = [];
    let probeDetail = '';
    if (srcErr) {
      h16Failed.push({ id: 'query-error', slug: null, note: `SELECT error: ${srcErr.message}` });
      probeDetail = `query failed: ${srcErr.message}`;
    } else {
      const candidates = (sourceCandidates ?? []).filter((r) => r.slug);
      // ランダムシャッフル → 先頭 3 件
      const shuffled = [...candidates].sort(() => Math.random() - 0.5).slice(0, 3);
      if (shuffled.length === 0) {
        probeDetail = 'no source-mode published candidates';
      } else {
        const probed: { slug: string; status: number }[] = [];
        for (const c of shuffled) {
          const slug = c.slug as string;
          const r = await fetchPublicHtml(slug);
          probed.push({ slug, status: r.status });
          if (r.status === 200) {
            h16Failed.push({
              id: c.id as string,
              slug,
              note: `FTP orphan: ${PUBLIC_BASE}${HUB_PATH}/${slug}/index.html returns 200`,
            });
          }
        }
        probeDetail = `probed ${probed.length} source-mode slugs: ${probed
          .map((p) => `${p.slug}=${p.status}`)
          .join(', ')}`;
      }
    }
    results.push({
      id: 'H-16', label: 'FTP source-mode orphan 0 件 (probe)', severity: 'high',
      ok: h16Failed.length === 0,
      detail: probeDetail,
      failedSamples: h16Failed.slice(0, 5),
    });
  } else {
    results.push({
      id: 'H-16', label: 'FTP source-mode orphan 0 件 (probe)', severity: 'high',
      ok: true, detail: 'SKIPPED (--skip-http)',
    });
  }

  // ── H-17: live 記事の template_check (buildDeployHtml + runTemplateCheck) ──
  // visibility_state='live' な記事を全件 build → template 検証。
  // DB に紛れ込んだ broken CTA / 構造破損を検知する。
  // 注意: buildDeployHtml は full Article 行が必要なので追加 SELECT を実行。
  const h17Failed: HealthResult['failedSamples'] = [];
  let h17Checked = 0;
  let h17DetailExtra = '';
  const { data: liveFull, error: liveFullErr } = await sb
    .from('articles')
    .select('*')
    .eq('visibility_state', 'live');

  if (liveFullErr) {
    h17Failed.push({ id: 'query-error', slug: null, note: `SELECT error: ${liveFullErr.message}` });
    h17DetailExtra = `query failed: ${liveFullErr.message}`;
  } else {
    for (const row of liveFull ?? []) {
      const article = row as unknown as Article;
      h17Checked++;
      try {
        const { html } = buildDeployHtml(article);
        const tc = runTemplateCheck(html);
        if (!tc.passed) {
          h17Failed.push({
            id: article.id,
            slug: article.slug,
            note: `template_check 失敗: ${tc.failures.slice(0, 3).join(' / ')}`,
          });
        }
      } catch (e) {
        h17Failed.push({
          id: article.id,
          slug: article.slug,
          note: `buildDeployHtml threw: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  }
  results.push({
    id: 'H-17', label: 'live 記事 template_check 全 pass', severity: 'critical',
    ok: !liveFullErr && h17Failed.length === 0,
    detail: liveFullErr
      ? h17DetailExtra
      : `clean: ${h17Checked - h17Failed.length}/${h17Checked}`,
    failedSamples: h17Failed.slice(0, 5),
  });

  // ── H-18: live 記事の hero/body/summary 画像 URL 200 応答 ─────────────────
  // 背景: 2026-05-24 — POST /deploy が "Readable is not a constructor" で 500 に
  //   なっていたため、ハブ index.html は更新されるが個別記事の画像が FTP に
  //   上がらず、harmony-mc.com/spiritual/column/<slug>/images/hero.jpg が
  //   404 になっていた。H-05 は HTML URL だけ probe しており画像は対象外。
  // 仕様:
  //   - liveFull (= H-17 と同じ全カラム結果) の image_files から url を取得
  //   - position が 'hero' のものを最優先で 1 件 HEAD probe (記事ごとの代表)
  //     画像 3 種全部 probe すると 1 日 200+ 件で lolipop に過剰負荷なので
  //     代表 1 件 + 全 fail 時の詳細出力にとどめる
  //   - 200 以外 (404/0/4xx/5xx) は critical
  if (!SKIP_HTTP && !liveFullErr) {
    const h18Failed: HealthResult['failedSamples'] = [];
    let h18Checked = 0;
    let h18Ok = 0;
    const probeQueue: { article: Article; url: string }[] = [];
    for (const row of liveFull ?? []) {
      const article = row as unknown as Article;
      const slug = article.slug;
      if (!slug) continue;
      const imageFiles = Array.isArray(article.image_files)
        ? (article.image_files as { url?: string; position?: string }[])
        : [];
      // hero を最優先 (記事サムネ + ハブカード両方で参照される代表)
      const hero = imageFiles.find((f) => f?.position === 'hero');
      if (!hero) continue; // image_files 自体が無いケースは別 health で扱う
      const url = `${PUBLIC_BASE}${HUB_PATH}/${slug}/images/hero.jpg`;
      probeQueue.push({ article, url });
    }
    const concurrency = 8;
    while (probeQueue.length > 0) {
      const batch = probeQueue.splice(0, concurrency);
      const probed = await Promise.all(
        batch.map(async ({ article, url }) => ({
          article,
          url,
          res: await headPublicUrl(url),
        })),
      );
      for (const { article, url, res } of probed) {
        h18Checked++;
        if (res.status === 200) {
          h18Ok++;
        } else {
          h18Failed.push({
            id: article.id,
            slug: article.slug,
            note: `hero.jpg status=${res.status}${res.error ? ` (${res.error})` : ''} url=${url}`,
          });
        }
      }
    }
    results.push({
      id: 'H-18', label: 'live 記事 hero 画像 200 応答', severity: 'critical',
      ok: h18Failed.length === 0,
      detail: `200: ${h18Ok}/${h18Checked}`,
      failedSamples: h18Failed.slice(0, 5),
    });
  } else {
    results.push({
      id: 'H-18', label: 'live 記事 hero 画像 200 応答', severity: 'critical',
      ok: true,
      detail: SKIP_HTTP ? 'SKIPPED (--skip-http)' : 'SKIPPED (H-17 query failed)',
    });
  }

  // ── サマリ出力 ────────────────────────────────────────────────────────────
  const summary = {
    timestamp: new Date().toISOString(),
    totalArticles: list.length,
    results,
    failedCount: results.filter((r) => !r.ok).length,
    criticalFailed: results.filter((r) => !r.ok && r.severity === 'critical').length,
    highFailed: results.filter((r) => !r.ok && r.severity === 'high').length,
    mediumFailed: results.filter((r) => !r.ok && r.severity === 'medium').length,
  };

  const json = JSON.stringify(summary, null, 2);
  if (JSON_OUT_PATH) {
    const dir = path.dirname(JSON_OUT_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(JSON_OUT_PATH, json, 'utf-8');
    console.log(`JSON 出力: ${JSON_OUT_PATH}`);
  }

  // 人間可読サマリ
  console.log('\n=== Article Health Monitor ===');
  console.log(`記事数: ${list.length}, 検査時刻: ${summary.timestamp}`);
  console.log('');
  for (const r of results) {
    const icon = r.ok ? '✅' : r.severity === 'critical' ? '🚨' : r.severity === 'high' ? '⚠️' : '📊';
    console.log(`${icon} ${r.id} [${r.severity}] ${r.label}: ${r.detail}`);
    if (!r.ok && r.failedSamples) {
      for (const s of r.failedSamples) {
        console.log(`     - ${s.slug ?? s.id}: ${s.note}`);
      }
    }
  }
  console.log('');
  console.log(`合計: critical=${summary.criticalFailed} / high=${summary.highFailed} / medium=${summary.mediumFailed}`);

  if (VERY_STRICT && (summary.criticalFailed > 0 || summary.highFailed > 0)) {
    console.error('\n🚨 critical or high failure detected (--very-strict). exit 1');
    process.exit(1);
  }
  if (STRICT && summary.criticalFailed > 0) {
    console.error('\n🚨 critical failure detected. exit 1');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
