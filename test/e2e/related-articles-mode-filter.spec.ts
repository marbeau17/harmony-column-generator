/**
 * E2E: 関連記事の同 generation_mode フィルタ保証 (P5-59 ガード)
 * --------------------------------------------------------
 * 目的:
 *   公開済み zero-generation 記事の HTML から関連記事リンクの slug を抽出し、
 *   各リンク先記事の DB レコードが generation_mode = 'zero' であることを
 *   service-role Supabase クライアント経由で実機検証する。
 *
 *   src/lib/publish/auto-related.ts の P5-59 不変条件
 *     『関連記事は対象記事と同じ generation_mode の候補からのみ選定する』
 *   をデプロイ後の HTML レイヤで再保証するゴールデンパスのスポット検査。
 *
 * 起動条件:
 *   HARMONY_LIVE_TEST=1 を明示した時のみ実行。CI には組み込まない。
 *   service-role クエリには下記 env のいずれかが必要 (優先順):
 *     1. HARMONY_SUPABASE_URL + HARMONY_SUPABASE_SERVICE_ROLE
 *     2. NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * 実行例:
 *   HARMONY_LIVE_TEST=1 \
 *   HARMONY_SUPABASE_URL=... HARMONY_SUPABASE_SERVICE_ROLE=... \
 *     npx playwright test related-articles-mode-filter
 *
 * 任意:
 *   HARMONY_PUBLIC_URL=https://harmony-mc.com (default)
 *   HARMONY_HUB_PATH=/spiritual/column     (default; live 公開ハブ)
 */
import { test, expect, request as pwRequest } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const BASE_URL = process.env.HARMONY_PUBLIC_URL ?? 'https://harmony-mc.com';
const HUB_PATH = process.env.HARMONY_HUB_PATH ?? '/spiritual/column';
const LIVE_ENABLED = process.env.HARMONY_LIVE_TEST === '1';

/** 検証対象の zero-generation 公開 slug 群 (law-of-attraction または healing)。 */
const TARGET_SLUGS: string[] = ['law-of-attraction', 'healing'];

/** 関連記事リンクの href から slug 1 件を抽出する正規表現。
 *  例: /spiritual/column/<slug>/index.html → <slug>
 *  HUB_PATH の前後スラッシュは正規化済みの想定。
 */
function buildRelatedLinkRegex(hubPath: string): RegExp {
  const normalized = hubPath.replace(/^\/+|\/+$/g, '');
  // 関連記事ブロック (<div class="related-articles"> ... </div>) 内の <a href> を抽出。
  // bigram 安全のため最小マッチ + 単純な href パターンのみで構成する。
  return new RegExp(
    `<a\\s+href="\\/${normalized}\\/([^\\/"]+)\\/index\\.html"`,
    'g',
  );
}

/** related-articles ブロックだけ切り出して、その中の slug を返す。 */
function extractRelatedSlugs(html: string, hubPath: string): string[] {
  const blockMatch = html.match(
    /<div\s+class="related-articles">([\s\S]*?)<\/div>/,
  );
  if (!blockMatch) return [];
  const block = blockMatch[1];
  const re = buildRelatedLinkRegex(hubPath);
  const slugs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    slugs.push(m[1]);
  }
  return slugs;
}

/** Supabase service-role クライアントを生成する。env 不足時は null。 */
function makeServiceRoleClient(): SupabaseClient | null {
  const url =
    process.env.HARMONY_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.HARMONY_SUPABASE_SERVICE_ROLE ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

test.describe('関連記事 同 generation_mode フィルタ保証 (手動実行)', () => {
  test.skip(!LIVE_ENABLED, 'HARMONY_LIVE_TEST=1 が指定されていないためスキップ');

  for (const slug of TARGET_SLUGS) {
    test(`/${HUB_PATH.replace(/^\/+|\/+$/g, '')}/${slug}/index.html の関連記事リンクは全て generation_mode='zero' を指す`, async () => {
      const supabase = makeServiceRoleClient();
      test.skip(
        supabase === null,
        'Supabase service-role 接続情報が未設定のため検証を skip',
      );

      // 1) 起点となる zero-gen 記事を取得
      const ctx = await pwRequest.newContext();
      const url = `${BASE_URL}${HUB_PATH}/${slug}/index.html`;
      const res = await ctx.get(url, { timeout: 30_000 });

      // 公開状態が落ちている場合 (例: 一時的な非公開化) は false negative を避けるため skip
      if (res.status() === 404) {
        await ctx.dispose();
        test.skip(true, `${url} が 404 のため skip (公開状態に依存)`);
        return;
      }
      expect(res.status(), `GET ${url} status`).toBe(200);

      const html = await res.text();
      expect(html.length, 'HTML 本文が空ではない').toBeGreaterThan(0);

      // 2) 起点記事自身が DB 上 zero-generation であることを確認
      const { data: selfRow, error: selfErr } = await supabase!
        .from('articles')
        .select('slug, generation_mode')
        .eq('slug', slug)
        .maybeSingle();
      expect(selfErr, `起点記事 ${slug} の取得エラー`).toBeNull();
      expect(selfRow, `起点記事 ${slug} が DB に存在しない`).not.toBeNull();
      expect(
        selfRow!.generation_mode,
        `前提: 起点記事 ${slug} は zero-generation のはず`,
      ).toBe('zero');

      // 3) 関連記事リンクの slug を抽出
      const linkedSlugs = extractRelatedSlugs(html, HUB_PATH);

      // ゼロ件は本テストの本旨を検証できないため skip (auto-related の同モード候補不足ケース)
      test.skip(
        linkedSlugs.length === 0,
        `${slug}: 関連記事リンクが 0 件のため検証を skip (同モード候補不足の可能性)`,
      );

      // 4) 各リンク先の generation_mode を service-role で一括取得
      const { data: rows, error: rowsErr } = await supabase!
        .from('articles')
        .select('slug, generation_mode')
        .in('slug', linkedSlugs);
      expect(rowsErr, `関連記事 slug の DB 取得エラー`).toBeNull();
      expect(rows, '関連記事 slug の DB 結果が null').not.toBeNull();

      // DB に見つからない slug は片方向リンクで重大なバグなので fail させる
      const foundSlugs = new Set((rows ?? []).map((r) => r.slug as string));
      for (const s of linkedSlugs) {
        expect(
          foundSlugs.has(s),
          `関連リンク ${s} に対応する DB レコードが見つからない`,
        ).toBe(true);
      }

      // 5) 全リンク先が generation_mode='zero' であることを保証
      for (const r of rows ?? []) {
        expect(
          r.generation_mode,
          `関連記事 ${r.slug} は generation_mode='zero' のはず (P5-59 不変条件)`,
        ).toBe('zero');
      }

      await ctx.dispose();
    });
  }
});
