// =============================================================================
// scripts/repair-image-placeholders.ts
//
// 既存記事のうち stage2_body_html に IMAGE プレースホルダが残ったままで、
// かつ image_files に画像が揃っている記事を検出し、手動で再置換するスクリプト。
//
// 検出対象パターン:
//   - IMAGE:hero / IMAGE:body / IMAGE:summary
//   - <!-- IMAGE -->（位置情報無し HTML コメント）
//
// 使い方:
//   tsx scripts/repair-image-placeholders.ts                # dry-run（既定）
//   tsx scripts/repair-image-placeholders.ts --apply        # 実反映
//   tsx scripts/repair-image-placeholders.ts --apply --limit=5
//
// 安全策:
//   - dry-run が既定。--apply を明示しない限り DB は更新されない。
//   - --apply 時は記事 HTML を更新する前に必ず article_revisions に
//     change_type='image_placeholder_repair' で履歴を INSERT する
//     （プロジェクト固有禁止事項: HTML 書換は履歴 INSERT 必須）。
//   - 加えて tmp/repair-image-placeholders-rollback-<timestamp>.json に
//     {id, before_html, after_html, image_files} のスナップショットを保存。
//
// 既存資産の流用:
//   src/lib/zero-gen/replace-placeholders.ts の replaceImagePlaceholders を
//   そのまま import して再利用する（重複実装を作らない）。
// =============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  replaceImagePlaceholders,
  type ImageFileRow,
} from '../src/lib/zero-gen/replace-placeholders';

// ---- env ローダ（他スクリプトと同じ簡易方式） -----------------------------
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf-8');
  for (const line of text.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const k = m[1].trim();
      const v = m[2].trim();
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

// ---- CLI 引数 -------------------------------------------------------------
interface Args {
  apply: boolean;
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  const apply = argv.includes('--apply');
  let limit: number | null = null;
  for (const a of argv) {
    const m = a.match(/^--limit=(\d+)$/);
    if (m) limit = Number(m[1]);
  }
  return { apply, limit };
}

// ---- プレースホルダ残存判定 ------------------------------------------------
// 検出は「副作用なしの正規表現マッチ」で行い、最終的な書換は
// replace-placeholders.ts に完全に委譲する（パターン重複を避けるため）。
const PLACEHOLDER_DETECT_PATTERNS: RegExp[] = [
  /IMAGE:hero\b/,
  /IMAGE:body\b/,
  /IMAGE:summary\b/,
  /<!--\s*IMAGE\s*-->/,
  /<!--\s*IMAGE:[^>]*-->/,
];

function hasPlaceholder(html: string | null | undefined): boolean {
  if (!html) return false;
  return PLACEHOLDER_DETECT_PATTERNS.some((p) => p.test(html));
}

// ---- image_files 妥当性チェック -------------------------------------------
function normalizeImageFiles(raw: unknown): ImageFileRow[] {
  if (!Array.isArray(raw)) return [];
  const out: ImageFileRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const position = typeof o.position === 'string' ? o.position : '';
    const url = typeof o.url === 'string' ? o.url : '';
    const alt = typeof o.alt === 'string' ? o.alt : '';
    const filename = typeof o.filename === 'string' ? o.filename : '';
    if (position && url) out.push({ position, url, alt, filename });
  }
  return out;
}

// ---- リビジョン履歴 INSERT --------------------------------------------------
async function saveRevision(
  sb: SupabaseClient,
  articleId: string,
  htmlSnapshot: string,
): Promise<void> {
  const { data: existing, error: selErr } = await sb
    .from('article_revisions')
    .select('revision_number')
    .eq('article_id', articleId)
    .order('revision_number', { ascending: false })
    .limit(1);
  if (selErr) throw new Error(`revision SELECT 失敗: ${selErr.message}`);
  const nextRev =
    existing && existing.length > 0
      ? (existing[0].revision_number ?? 0) + 1
      : 1;
  const { error: insErr } = await sb.from('article_revisions').insert({
    article_id: articleId,
    revision_number: nextRev,
    html_snapshot: htmlSnapshot,
    change_type: 'image_placeholder_repair',
    changed_by: 'script:repair-image-placeholders',
    comment: JSON.stringify({ reason: 'IMAGE プレースホルダ残存修復' }),
  });
  if (insErr) throw new Error(`revision INSERT 失敗: ${insErr.message}`);
}

// ---- メイン処理 ------------------------------------------------------------
interface Candidate {
  id: string;
  slug: string | null;
  imageCount: number;
  beforeHtml: string;
  afterHtml: string;
  phase1: number;
  phase2: number;
  imageFiles: ImageFileRow[];
}

async function main() {
  loadEnvLocal();
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      'ERROR: NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です。',
    );
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const mode = args.apply ? 'APPLY' : 'DRY-RUN';
  console.log(`Mode: ${mode}${args.limit != null ? ` (limit=${args.limit})` : ''}`);

  // --- 全 articles を一括取得（id, slug, stage2_body_html, image_files） ---
  // 大量レコード対策で keyset ページング
  const PAGE = 500;
  let from = 0;
  const all: Array<{
    id: string;
    slug: string | null;
    stage2_body_html: string | null;
    image_files: unknown;
  }> = [];
  for (;;) {
    const { data, error } = await sb
      .from('articles')
      .select('id, slug, stage2_body_html, image_files')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`articles SELECT 失敗: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Total articles scanned: ${all.length}`);

  // --- 候補抽出 ----------------------------------------------------------
  const candidates: Candidate[] = [];
  let hasPlaceholderCount = 0;
  let noImageFilesCount = 0;

  for (const row of all) {
    const body = row.stage2_body_html ?? '';
    if (!hasPlaceholder(body)) continue;
    hasPlaceholderCount++;
    const files = normalizeImageFiles(row.image_files);
    if (files.length === 0) {
      noImageFilesCount++;
      continue;
    }
    const r = replaceImagePlaceholders(body, files);
    if (r.phase1 + r.phase2 === 0) {
      // プレースホルダはあるが置換器が触らないケース（平文 IMAGE: など）
      continue;
    }
    candidates.push({
      id: row.id,
      slug: row.slug,
      imageCount: files.length,
      beforeHtml: body,
      afterHtml: r.html,
      phase1: r.phase1,
      phase2: r.phase2,
      imageFiles: files,
    });
  }

  console.log('');
  console.log(`プレースホルダ残存記事       : ${hasPlaceholderCount} 件`);
  console.log(`  └ うち image_files なし    : ${noImageFilesCount} 件`);
  console.log(`  └ 再置換可能（候補）       : ${candidates.length} 件`);
  console.log('');

  const target =
    args.limit != null ? candidates.slice(0, args.limit) : candidates;

  if (target.length === 0) {
    console.log('再置換対象なし。終了します。');
    return;
  }

  console.log(`次の ${target.length} 件を再置換${args.apply ? 'します' : '対象として表示します（dry-run）'}:`);
  for (const c of target) {
    console.log(
      `  - id=${c.id} slug=${c.slug ?? '(none)'} phase1=${c.phase1} phase2=${c.phase2} images=${c.imageCount}`,
    );
  }

  if (!args.apply) {
    console.log('\n--apply を付けると実反映されます。');
    return;
  }

  // --- ロールバック用 JSON 保存 -----------------------------------------
  const tmpDir = path.resolve(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const rollbackPath = path.join(
    tmpDir,
    `repair-image-placeholders-rollback-${ts}.json`,
  );
  fs.writeFileSync(
    rollbackPath,
    JSON.stringify(
      target.map((c) => ({
        id: c.id,
        slug: c.slug,
        before_html: c.beforeHtml,
        after_html: c.afterHtml,
        image_files: c.imageFiles,
        phase1: c.phase1,
        phase2: c.phase2,
      })),
      null,
      2,
    ),
    'utf-8',
  );
  console.log(`\nロールバック JSON 保存: ${rollbackPath}`);

  // --- 実反映（履歴 INSERT → UPDATE） ----------------------------------
  let updated = 0;
  let failed = 0;
  for (const c of target) {
    try {
      await saveRevision(sb, c.id, c.beforeHtml);
      const { error } = await sb
        .from('articles')
        .update({
          stage2_body_html: c.afterHtml,
          updated_at: new Date().toISOString(),
        })
        .eq('id', c.id);
      if (error) throw new Error(`UPDATE 失敗: ${error.message}`);
      updated++;
      console.log(`  ✓ ${c.id} (phase1=${c.phase1} phase2=${c.phase2})`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${c.id}: ${(e as Error).message}`);
    }
  }
  console.log(`\n完了: 更新=${updated} 失敗=${failed} / 候補=${target.length}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
