// Read-only health check: zero-gen 記事の related_articles に cross-mode 混入が無いか確認
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const e = fs.readFileSync('.env.local', 'utf-8');
for (const l of e.split('\n')) {
  const t = l.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

type Related = { href: string; title?: string };

function extractSlug(href: string): string | null {
  if (!href) return null;
  // 末尾の / を削除し、最後のセグメントを取得
  const trimmed = href.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const parts = trimmed.split('/');
  const last = parts[parts.length - 1];
  return last || null;
}

(async () => {
  // 1) zero-gen × visibility_state='live' の全記事
  const { data: zeroLive, error: e1 } = await sb
    .from('articles')
    .select('id, article_number, slug, generation_mode, visibility_state, related_articles')
    .eq('generation_mode', 'zero')
    .eq('visibility_state', 'live');
  if (e1) {
    console.error('zeroLive query error:', e1);
    process.exit(1);
  }

  console.log(`zero-gen live 記事数: ${zeroLive?.length ?? 0}`);

  // 2) related_articles の href から slug を抽出 → 全 slug を集計
  const allRelatedSlugs = new Set<string>();
  const articleSlugMap: { article_number: number; slug: string; related_slugs: string[] }[] = [];

  for (const a of zeroLive ?? []) {
    const list: Related[] = Array.isArray(a.related_articles) ? (a.related_articles as Related[]) : [];
    const slugs: string[] = [];
    for (const r of list) {
      const s = extractSlug(r?.href ?? '');
      if (s) {
        slugs.push(s);
        allRelatedSlugs.add(s);
      }
    }
    articleSlugMap.push({
      article_number: a.article_number ?? -1,
      slug: a.slug ?? '',
      related_slugs: slugs,
    });
  }

  console.log(`抽出された unique 関連 slug 数: ${allRelatedSlugs.size}`);

  // 3) DB 上で各 slug の generation_mode を引く
  const slugToMode = new Map<string, string | null>();
  if (allRelatedSlugs.size > 0) {
    const slugArr = Array.from(allRelatedSlugs);
    // chunk to be safe
    const chunkSize = 100;
    for (let i = 0; i < slugArr.length; i += chunkSize) {
      const chunk = slugArr.slice(i, i + chunkSize);
      const { data, error } = await sb
        .from('articles')
        .select('slug, generation_mode')
        .in('slug', chunk);
      if (error) {
        console.error('slug lookup error:', error);
        process.exit(1);
      }
      for (const row of data ?? []) {
        if (row.slug) slugToMode.set(row.slug, row.generation_mode ?? null);
      }
    }
  }

  // 4) cross-mode 混入を検出
  let contaminatedArticles = 0;
  let unknownSlugCount = 0;
  const samples: string[] = [];
  for (const item of articleSlugMap) {
    const bad: string[] = [];
    for (const s of item.related_slugs) {
      if (!slugToMode.has(s)) {
        unknownSlugCount++;
        // unknown は cross-mode かどうか不明 → 記録のみ
        continue;
      }
      const mode = slugToMode.get(s);
      if (mode !== 'zero') {
        bad.push(`${s}(mode=${mode})`);
      }
    }
    if (bad.length > 0) {
      contaminatedArticles++;
      if (samples.length < 5) {
        samples.push(`#${item.article_number} ${item.slug} → ${bad.join(', ')}`);
      }
    }
  }

  console.log(`cross-mode 混入を含む zero 記事数: ${contaminatedArticles}`);
  console.log(`DB 未登録の related slug 参照数 (delisted/外部の可能性): ${unknownSlugCount}`);
  if (samples.length > 0) {
    console.log('--- contaminated samples ---');
    for (const s of samples) console.log(s);
  }
})();
