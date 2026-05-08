/**
 * P5-86 follow-up: 本番 FTP に対する運用プローブ。
 *
 * - ハブページ (https://harmony-mc.com/spiritual/column/index.html) を取得
 * - `<a class="article-card">` から記事 URL を抽出
 * - 各記事 HTML を取得し `<img src>` / `<a href>` の URL を全列挙
 * - 各 URL に HEAD を投げて 404 等を検出
 *
 * 単体テストではなく運用プローブ。`npx tsx scripts/probe-deployed.ts` で実行。
 *
 * ルール準拠:
 *  - HTML は cheerio でパース (regex 操作禁止 — CLAUDE.md アンチパターン)
 *  - Node 20 native fetch を使用 (undici 直接利用しない)
 *  - 本番 CDN/WAF が独自 UA を bot 判定する場合があるためブラウザ相当 UA
 */
import * as cheerio from 'cheerio';

const HUB_URL = 'https://harmony-mc.com/spiritual/column/index.html';

const FETCH_UA =
  'Mozilla/5.0 (compatible; HarmonyDeployedProbe/1.0; +https://harmony-mc.com)';

const HEAD_CONCURRENCY = 12;

interface ProbeResult {
  url: string;
  ok: boolean;
  status: number;
  source: string;
  tag: 'img' | 'a' | 'hub-card';
  via?: string; // method actually used (HEAD or GET fallback)
  error?: string;
}

async function fetchText(url: string): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': FETCH_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Cache-Control': 'no-cache',
    },
  });
  const text = res.ok ? await res.text() : '';
  return { status: res.status, text };
}

async function probeUrl(
  url: string,
  source: string,
  tag: ProbeResult['tag'],
): Promise<ProbeResult> {
  // 1) HEAD を試す
  try {
    const r = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': FETCH_UA },
    });
    // 一部 CDN は HEAD を 405/403 で蹴ってくるので GET にフォールバック
    if (r.status === 405 || r.status === 403 || r.status === 501) {
      const g = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': FETCH_UA, Range: 'bytes=0-0' },
      });
      return { url, ok: g.ok, status: g.status, source, tag, via: 'GET' };
    }
    return { url, ok: r.ok, status: r.status, source, tag, via: 'HEAD' };
  } catch (e) {
    return {
      url,
      ok: false,
      status: 0,
      source,
      tag,
      error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  }
}

async function probeBatch<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency = HEAD_CONCURRENCY,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

interface ExtractedUrl {
  url: string;
  source: string;
  tag: ProbeResult['tag'];
}

function isProbableHttpUrl(u: string): boolean {
  // data:, javascript:, mailto:, tel:, # は除外
  if (!u) return false;
  if (u.startsWith('#')) return false;
  if (/^(?:data|javascript|mailto|tel):/i.test(u)) return false;
  return true;
}

async function main(): Promise<void> {
  console.log(`[probe-deployed] start: ${HUB_URL}`);

  // 1. Hub HTML を取得
  const hub = await fetchText(HUB_URL);
  if (hub.status !== 200) {
    console.error(`HUB fetch failed: status=${hub.status}`);
    process.exit(2);
  }
  const $hub = cheerio.load(hub.text);

  // 2. 記事 URL を抽出 (本番ハブは <a class="article-card">)
  const articleUrls: { url: string; cardTitle: string }[] = [];
  $hub('a.article-card').each((_, el) => {
    const href = $hub(el).attr('href');
    if (!href || !isProbableHttpUrl(href)) return;
    const abs = new URL(href, HUB_URL).toString();
    const title = $hub(el).find('.card-title').first().text().trim() || abs;
    articleUrls.push({ url: abs, cardTitle: title });
  });

  console.log(`[probe-deployed] hub から ${articleUrls.length} 件の記事カードを検出`);
  if (articleUrls.length === 0) {
    console.error('No article cards found. selector mismatch?');
    process.exit(2);
  }

  // 3. 各記事を取得して URL を収集 (記事自身もプローブ対象)
  const allUrls = new Map<string, ExtractedUrl>();
  for (const { url: articleUrl } of articleUrls) {
    // 記事 URL 自身もプローブ
    if (!allUrls.has(articleUrl)) {
      allUrls.set(articleUrl, { url: articleUrl, source: HUB_URL, tag: 'hub-card' });
    }

    const r = await fetchText(articleUrl);
    if (r.status !== 200) {
      console.error(`[ARTICLE-${r.status}] ${articleUrl}`);
      continue;
    }
    const $a = cheerio.load(r.text);

    $a('img[src]').each((_, el) => {
      const src = $a(el).attr('src');
      if (!src || !isProbableHttpUrl(src)) return;
      const abs = new URL(src, articleUrl).toString();
      if (!allUrls.has(abs)) {
        allUrls.set(abs, { url: abs, source: articleUrl, tag: 'img' });
      }
    });

    $a('a[href]').each((_, el) => {
      const href = $a(el).attr('href');
      if (!href || !isProbableHttpUrl(href)) return;
      // 絶対 URL 化
      let abs: string;
      try {
        abs = new URL(href, articleUrl).toString();
      } catch {
        return;
      }
      // http(s) のみ probe
      if (!/^https?:/i.test(abs)) return;
      if (!allUrls.has(abs)) {
        allUrls.set(abs, { url: abs, source: articleUrl, tag: 'a' });
      }
    });
  }

  console.log(`[probe-deployed] ${allUrls.size} 件のユニーク URL を抽出。HEAD プローブ開始...`);

  // 4. 並列プローブ
  const items = [...allUrls.values()];
  const results = await probeBatch(items, (it) => probeUrl(it.url, it.source, it.tag));

  // 5. レポート
  const failed = results.filter((r) => !r.ok);
  const byStatus = new Map<number, number>();
  for (const r of results) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);

  console.log('');
  console.log('=== Probe summary ===');
  console.log(`Hub: ${HUB_URL}`);
  console.log(`Articles linked from hub: ${articleUrls.length}`);
  console.log(`Total unique URLs probed: ${results.length}`);
  console.log(
    `Status distribution: ${[...byStatus.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([s, c]) => `${s}=${c}`)
      .join(', ')}`,
  );
  console.log(`Failures: ${failed.length}`);
  console.log('');

  if (failed.length > 0) {
    console.log('=== Failed URLs ===');
    for (const f of failed) {
      const errSuffix = f.error ? ` (${f.error})` : '';
      console.log(`  [${f.status}] <${f.tag}> ${f.url}`);
      console.log(`         from: ${f.source}${errSuffix}`);
    }
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
