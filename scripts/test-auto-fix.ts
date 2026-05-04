// ============================================================================
// scripts/test-auto-fix.ts
// service-role でローカルから auto-fix オーケストレータを直接トリガーする検証用 CLI
//
// 使い方:
//   npx tsx scripts/test-auto-fix.ts <article_id>
//
// 動作:
//   1. .env.local から service-role キーを読み込む
//   2. 指定 article を取得 (RLS bypass)
//   3. quality_check.items から keyword_density の fail/warn を抽出
//   4. STRATEGY_MAP から auto_fix_type を決定し runAutoFix() を呼ぶ
//   5. 修復前後の stage2_body_html 文字数 + キーワード出現回数を出力
//
// 注意: 実 DB は更新しない (ドライラン)。書き戻したい場合は --apply フラグを足す。
// ============================================================================

import * as fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

import { createClient } from '@supabase/supabase-js';
import { runAutoFix } from '@/lib/auto-fix/orchestrator';
import { getStrategyFor } from '@/lib/auto-fix/strategy-map';
import type { AutoFixParams } from '@/lib/auto-fix/types';

const TARGET_CHECK_ITEM = 'keyword_density';

function htmlToText(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function countOccurrences(text: string, keyword: string): number {
  // キーワード内の半角空白は柔軟マッチ (フルフレーズ評価)
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  const re = new RegExp(escaped, 'g');
  return (text.match(re) ?? []).length;
}

function parseKeywords(raw: string): string[] {
  return raw
    .split(/[,、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const articleId = process.argv[2];
  if (!articleId) {
    console.error('usage: npx tsx scripts/test-auto-fix.ts <article_id>');
    process.exit(1);
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  console.log('[test-auto-fix] fetch article', articleId);
  const { data, error } = await sb
    .from('articles')
    .select('id,title,keyword,quality_check,stage2_body_html')
    .eq('id', articleId)
    .maybeSingle();
  if (error || !data) {
    console.error('article fetch failed', error);
    process.exit(1);
  }

  const article = data as {
    id: string;
    title: string;
    keyword: string | null;
    quality_check: { items?: Array<{ id: string; status: string; detail?: string; value?: unknown }> } | null;
    stage2_body_html: string | null;
  };

  console.log(`[test-auto-fix] target  : ${article.title}`);
  console.log(`[test-auto-fix] keyword : ${article.keyword}`);

  const items = article.quality_check?.items ?? [];
  const failed = items.find((it) => it.id === TARGET_CHECK_ITEM && (it.status === 'fail' || it.status === 'warn'));
  if (!failed) {
    console.log(`[test-auto-fix] no failed/warn ${TARGET_CHECK_ITEM} item — nothing to fix`);
    process.exit(0);
  }
  console.log(`[test-auto-fix] failed item: ${failed.id} status=${failed.status} detail=${failed.detail}`);

  const strategy = getStrategyFor(TARGET_CHECK_ITEM);
  if (!strategy.auto_fix_type) {
    console.error(`[test-auto-fix] strategy-map has no auto_fix_type for ${TARGET_CHECK_ITEM}`);
    process.exit(1);
  }
  console.log(`[test-auto-fix] strategy: auto_fix_type=${strategy.auto_fix_type} allowed=${strategy.allowed.join(',')}`);

  const bodyHtml = article.stage2_body_html ?? '';
  if (bodyHtml.length < 100) {
    console.error('[test-auto-fix] stage2_body_html is empty/too short');
    process.exit(1);
  }

  const keywords = parseKeywords(article.keyword ?? '');
  console.log(`[test-auto-fix] parsed keywords: ${JSON.stringify(keywords)}`);

  // ── 修復前メトリクス ───────────────────────────────────────
  const beforeText = htmlToText(bodyHtml);
  const beforeCounts = Object.fromEntries(
    keywords.map((k) => [k, countOccurrences(beforeText, k)]),
  );
  console.log('[test-auto-fix] BEFORE chars(html)=', bodyHtml.length, 'chars(text)=', beforeText.length);
  console.log('[test-auto-fix] BEFORE keyword counts:', beforeCounts);

  // ── auto-fix 実行 ─────────────────────────────────────────
  const params: AutoFixParams = {
    fix_type: strategy.auto_fix_type,
    keywords,
  };
  console.log('[test-auto-fix] runAutoFix(params)=', JSON.stringify(params));

  const t0 = Date.now();
  let result;
  try {
    result = await runAutoFix({ bodyHtml, params });
  } catch (e) {
    console.error('[test-auto-fix] runAutoFix threw:', (e as Error).message);
    process.exit(1);
  }
  console.log(`[test-auto-fix] runAutoFix done in ${Date.now() - t0}ms cost~$${result.cost_estimate}`);

  // ── 修復後メトリクス ───────────────────────────────────────
  const afterHtml = result.after_html;
  const afterText = htmlToText(afterHtml);
  const afterCounts = Object.fromEntries(
    keywords.map((k) => [k, countOccurrences(afterText, k)]),
  );
  console.log('[test-auto-fix] AFTER  chars(html)=', afterHtml.length, 'chars(text)=', afterText.length);
  console.log('[test-auto-fix] AFTER  keyword counts:', afterCounts);

  // ── サマリ ───────────────────────────────────────────────
  const delta = afterHtml.length - bodyHtml.length;
  console.log('\n=== SUMMARY ===');
  console.log(`html chars : ${bodyHtml.length} → ${afterHtml.length}  (delta ${delta >= 0 ? '+' : ''}${delta})`);
  for (const k of keywords) {
    const b = beforeCounts[k] as number;
    const a = afterCounts[k] as number;
    const ok = a >= 3 ? 'PASS' : 'STILL FAIL';
    console.log(`keyword "${k}": ${b} → ${a}  [${ok}]`);
  }
}

main().catch((e) => {
  console.error('[test-auto-fix] fatal:', e);
  process.exit(1);
});
