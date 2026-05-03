/**
 * P5-61: Article Health Monitor — 12 項目の自動ヘルスチェックを集約実行。
 *
 * 設計参照: docs/refactor/article-health-monitor.md
 *
 * 使い方:
 *   tsx scripts/health/run-all.ts                # JSON サマリを stdout
 *   tsx scripts/health/run-all.ts --strict       # critical >0 で exit 1
 *   tsx scripts/health/run-all.ts --skip-http    # H-05 (URL probe) を skip
 *   tsx scripts/health/run-all.ts --json out.json # ファイル出力
 *
 * GitHub Actions / Vercel cron どちらからも import 可能。
 */
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

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

async function fetchPublicHtml(slug: string): Promise<{ status: number; html?: string }> {
  const url = `${PUBLIC_BASE}${HUB_PATH}/${slug}/index.html`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'harmony-health-monitor/1.0', 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return { status: res.status };
    const html = await res.text();
    return { status: res.status, html };
  } catch {
    return { status: 0 };
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

  // ── H-07: sitemap.xml URL 件数 (簡易) ────────────────────────────────────
  if (!SKIP_HTTP) {
    let sitemapStatus = 0;
    let sitemapUrls = 0;
    try {
      const sm = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'https://blogauto-pi.vercel.app'}/sitemap.xml`, {
        headers: { 'User-Agent': 'harmony-health-monitor/1.0' },
      });
      sitemapStatus = sm.status;
      if (sm.ok) {
        const xml = await sm.text();
        sitemapUrls = (xml.match(/<loc>[^<]+\/index\.html<\/loc>/g) ?? []).length;
      }
    } catch {
      sitemapStatus = 0;
    }
    const expectedCount = list.filter((a) => a.generation_mode === 'zero').length;
    const ok = sitemapStatus === 200 && sitemapUrls === expectedCount;
    results.push({
      id: 'H-07', label: 'sitemap.xml 全 zero-gen 出力', severity: 'high',
      ok,
      detail: ok
        ? `sitemap=${sitemapUrls} == zero-gen=${expectedCount}`
        : `sitemap=${sitemapUrls} vs zero-gen=${expectedCount} (status=${sitemapStatus})`,
    });
  } else {
    results.push({ id: 'H-07', label: 'sitemap.xml 全 zero-gen 出力', severity: 'high', ok: true, detail: 'SKIPPED' });
  }

  // ── H-08: ハブ記事数 vs DB zero-gen 数 (簡易: HTML 内 article-card 数) ──
  if (!SKIP_HTTP) {
    let hubCount = 0;
    let hubStatus = 0;
    try {
      const hub = await fetch(`${PUBLIC_BASE}${HUB_PATH}/index.html`, {
        headers: { 'User-Agent': 'harmony-health-monitor/1.0', 'Cache-Control': 'no-cache' },
      });
      hubStatus = hub.status;
      if (hub.ok) {
        const html = await hub.text();
        hubCount = (html.match(/<a [^>]*class="article-card"/g) ?? []).length;
      }
    } catch {
      hubStatus = 0;
    }
    const expectedHub = list.filter((a) => a.generation_mode === 'zero').length;
    const ok = hubStatus === 200 && hubCount === expectedHub;
    results.push({
      id: 'H-08', label: 'ハブ記事数 == DB zero-gen 数', severity: 'medium',
      ok,
      detail: `hub=${hubCount} vs zero-gen=${expectedHub} (status=${hubStatus})`,
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

  if (STRICT && summary.criticalFailed > 0) {
    console.error('\n🚨 critical failure detected. exit 1');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
