/**
 * P5-43 Step 2 準備: legacy `reviewed_at` ベース判定から `visibility_state` ベース判定への
 * 移行に先立ち、parity 不整合を解消するための backfill ツール。
 *
 * 対象条件:
 *   reviewed_at IS NOT NULL
 *   AND status = 'published'
 *   AND visibility_state NOT IN ('live','live_hub_stale','deploying','unpublished','failed')
 *   (= visibility_state が 'idle' または NULL の legacy 値)
 *
 * 動作:
 *   - dry-run (デフォルト): 影響を受ける記事を列挙するだけ。書き込み一切なし。
 *   - --apply: 上記対象に対し
 *       articles.visibility_state = 'live'
 *       articles.visibility_updated_at = NOW()
 *     を UPDATE し、publish_events に監査ログを 1 件記録する。
 *
 * publish_events スキーマ注意点:
 *   action CHECK 制約 (20260503000000_publish_events_action_extension.sql) は
 *   'publish','unpublish','hub_rebuild','ripple_regen','batch-hide-source',
 *   'batch-hide-source-sql','hallucination-retry','dangling-recovery','manual-edit'
 *   のみ許可。'backfill' は未許可なので 'manual-edit' を使用し、reason 文字列に
 *   "backfill:legacy-reviewed-at -> visibility_state=live" を記録する。
 *   `new_state` カラムは存在しないため、reason に new_state も埋め込む。
 *
 * 実行前に必ず:
 *   1. supabase db のバックアップを取得 (Supabase Studio > Database > Backups)
 *   2. dry-run で対象件数を目視確認
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ロールバック手順:
 *   1. apply 完了時に tmp/backfill-visibility-{timestamp}.json が出力される。
 *      ファイルには変更対象の article id 配列と元の visibility_state が含まれる。
 *   2. 即時ロールバック (psql / Supabase SQL Editor):
 *        UPDATE articles
 *           SET visibility_state = 'idle',
 *               visibility_updated_at = NULL
 *         WHERE id = ANY(ARRAY[...JSON の ids 配列...]::uuid[]);
 *      (元の値が 'idle' 以外だった行は JSON の per-row originalState を参照)
 *   3. publish_events のロールバック (任意):
 *        DELETE FROM publish_events
 *         WHERE action = 'manual-edit'
 *           AND reason LIKE 'backfill:legacy-reviewed-at%'
 *           AND created_at >= '...timestamp...';
 *   4. 本番でのロールバックは Supabase Studio の Point-in-Time Recovery も検討。
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 使い方:
 *   tsx scripts/backfill-visibility-from-reviewed.ts          # dry-run
 *   tsx scripts/backfill-visibility-from-reviewed.ts --apply  # 実行
 */
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

// .env.local 読み込み (他スクリプトと同一パターン)
const env = fs.readFileSync('.env.local', 'utf-8');
for (const line of env.split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const APPLY = process.argv.includes('--apply');

// 既に "正しい" 状態として扱う visibility_state 値。これら以外 (= idle/null)
// が backfill 対象。
const ALREADY_VALID_STATES = new Set([
  'live',
  'live_hub_stale',
  'deploying',
  'unpublished',
  'failed',
]);

type ArticleRow = {
  id: string;
  title: string | null;
  status: string | null;
  reviewed_at: string | null;
  visibility_state: string | null;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      'NEXT_PUBLIC_SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が未設定です',
    );
    process.exit(1);
  }
  const sb = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  console.log(
    `[mode] ${APPLY ? 'APPLY (書き込み実行)' : 'DRY-RUN (読み取りのみ)'}`,
  );

  // status='published' かつ reviewed_at NOT NULL の記事を全件取得し、
  // クライアント側で visibility_state による絞り込みを行う
  // (NULL/idle の両方を取りこぼさないため、SQL 側で NOT IN を組まずに
  //  TS 側で安全に判定する)。
  const { data, error } = await sb
    .from('articles')
    .select('id, title, status, reviewed_at, visibility_state')
    .eq('status', 'published')
    .not('reviewed_at', 'is', null);

  if (error) {
    console.error('SELECT 失敗:', error.message);
    process.exit(1);
  }

  const all = (data ?? []) as ArticleRow[];
  const targets = all.filter(
    (a) => !a.visibility_state || !ALREADY_VALID_STATES.has(a.visibility_state),
  );

  console.log(
    `published & reviewed_at NOT NULL: ${all.length} 件 / 対象 (legacy state): ${targets.length} 件\n`,
  );

  if (targets.length === 0) {
    console.log('backfill 対象なし。parity OK。');
    return;
  }

  for (const t of targets) {
    console.log(
      `  - ${t.id}  state=${t.visibility_state ?? 'NULL'}  title="${t.title ?? '(no title)'}"`,
    );
  }

  if (!APPLY) {
    console.log('\n[dry-run] 書き込みは行いませんでした。');
    console.log('実行する場合: tsx scripts/backfill-visibility-from-reviewed.ts --apply');
    return;
  }

  // ── APPLY MODE ────────────────────────────────────────────────────────────
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tmpDir = path.resolve('tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const rollbackPath = path.join(tmpDir, `backfill-visibility-${timestamp}.json`);

  // ロールバック用情報を先に書き出す (途中で死んでも復元可能にする)
  const rollbackPayload = {
    timestamp,
    note: 'P5-43 Step 2 準備 backfill — visibility_state を live に更新した記事の元状態',
    rollbackSql:
      "UPDATE articles SET visibility_state = COALESCE(originalState, 'idle'), visibility_updated_at = NULL WHERE id = ANY(...)",
    targets: targets.map((t) => ({
      id: t.id,
      originalState: t.visibility_state, // null の可能性あり
      title: t.title,
    })),
    ids: targets.map((t) => t.id),
  };
  fs.writeFileSync(rollbackPath, JSON.stringify(rollbackPayload, null, 2), 'utf-8');
  console.log(`\nロールバック用 ID リストを保存: ${rollbackPath}`);

  const nowIso = new Date().toISOString();
  let okArticles = 0;
  let okEvents = 0;
  const failures: { id: string; phase: string; message: string }[] = [];

  for (const t of targets) {
    // 1) articles 更新 — 競合回避のため status/reviewed_at 条件を WHERE に再付与
    const { error: updErr } = await sb
      .from('articles')
      .update({
        visibility_state: 'live',
        visibility_updated_at: nowIso,
      })
      .eq('id', t.id)
      .eq('status', 'published')
      .not('reviewed_at', 'is', null);

    if (updErr) {
      failures.push({ id: t.id, phase: 'articles.update', message: updErr.message });
      console.error(`  ❌ ${t.id} update: ${updErr.message}`);
      continue;
    }
    okArticles++;

    // 2) publish_events 監査ログ
    //    action='backfill' は CHECK 違反になるため 'manual-edit' を使用。
    //    意図と new_state は reason 文字列にエンコードする。
    const reason = `backfill:legacy-reviewed-at -> visibility_state=live (prev=${t.visibility_state ?? 'NULL'})`;
    const { error: evErr } = await sb.from('publish_events').insert({
      article_id: t.id,
      action: 'manual-edit',
      reason,
      request_id: `backfill-${timestamp}-${t.id}`,
    });
    if (evErr) {
      failures.push({ id: t.id, phase: 'publish_events.insert', message: evErr.message });
      console.error(`  ⚠️  ${t.id} event: ${evErr.message}`);
    } else {
      okEvents++;
    }
    console.log(`  ✅ ${t.id}`);
  }

  console.log('\n──────────────────────────────────────────');
  console.log(`articles 更新成功:       ${okArticles}/${targets.length}`);
  console.log(`publish_events 記録成功: ${okEvents}/${targets.length}`);
  if (failures.length > 0) {
    console.log(`失敗: ${failures.length} 件`);
    for (const f of failures) {
      console.log(`  - ${f.id} [${f.phase}] ${f.message}`);
    }
  }
  console.log(`ロールバック用 JSON:     ${rollbackPath}`);
  console.log('──────────────────────────────────────────');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
