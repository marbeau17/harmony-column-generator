// =============================================================================
// scripts/auto-apply-images-batch.ts
//
// 既存の zero-generation 記事のうち、stage2_body_html に <img> タグの数が
// image_files の数より少ない (= 画像が反映されていない) 記事を一括検出・修復。
//
// 修復ロジック (2 段階):
//   1) replaceImagePlaceholders で残存プレースホルダを置換 (既存資産の流用)
//   2) それでも各 position の画像が body 内に未挿入なら、位置に応じて挿入
//      - hero    : 本文先頭 (最初の段落の直前)
//      - body    : 本文中央付近 (段落 <p> の中点)
//      - summary : 本文末尾 (CTA や FAQ より前 / なければ末尾)
//      ※ 既に同じ src の <img> が存在する position はスキップ
//
// 対象抽出条件:
//   - generation_mode = 'zero'
//   - image_files が 1 件以上
//   - stage2_body_html 内の <img> タグ数 < image_files.length
//
// 使い方:
//   tsx scripts/auto-apply-images-batch.ts            # dry-run (既定)
//   tsx scripts/auto-apply-images-batch.ts --apply    # 実反映
//
// 安全策 (プロジェクト固有禁止事項に準拠):
//   - HTML 書換前に必ず article_revisions に履歴 INSERT
//     (change_type='auto_apply_images_batch')
//   - --apply を明示しない限り DB は更新されない
//   - tmp/auto-apply-images-rollback-<ts>.json にスナップショット保存
//
// 既存資産の流用:
//   src/lib/zero-gen/replace-placeholders.ts の replaceImagePlaceholders を
//   そのまま import (重複実装を作らない)。
// =============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  replaceImagePlaceholders,
  type ImageFileRow,
} from '../src/lib/zero-gen/replace-placeholders';

// ---- env ローダ ------------------------------------------------------------
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

// ---- CLI 引数 --------------------------------------------------------------
interface Args {
  apply: boolean;
}

function parseArgs(argv: string[]): Args {
  return { apply: argv.includes('--apply') };
}

// ---- <img> カウント / 検出 -------------------------------------------------
function countImgTags(html: string | null | undefined): number {
  if (!html) return 0;
  const m = html.match(/<img\b[^>]*>/gi);
  return m ? m.length : 0;
}

function htmlContainsUrl(html: string, url: string): boolean {
  if (!html || !url) return false;
  // URL は属性値内に出現すれば OK (大文字小文字違いはほぼ無いため厳密一致)
  return html.includes(url);
}

function imgTagFor(img: ImageFileRow): string {
  return `<img src="${img.url}" alt="${img.alt || ''}" style="max-width:100%;border-radius:8px;margin:1em 0" />`;
}

/**
 * 残った image_files を position に応じて body へ挿入する。
 *   - hero    : 本文先頭 (最初の <p>/<h2>/<div> の直前)
 *   - body    : 段落の中点 (<p> 開始タグの中央付近)
 *   - summary : 末尾。harmony-cta / harmony-faq があればその直前、無ければ末尾
 *
 * 既に同 URL の <img> が含まれていればスキップする。
 * 戻り値: { html, inserted }
 */
function injectMissingImages(
  html: string,
  files: ImageFileRow[],
): { html: string; inserted: number } {
  let out = html;
  let inserted = 0;

  for (const f of files) {
    if (htmlContainsUrl(out, f.url)) continue; // 既に挿入済み
    const tag = `\n${imgTagFor(f)}\n`;

    if (f.position === 'hero') {
      // 最初のブロック要素の直前に挿入
      const m = out.match(/<(p|h1|h2|h3|div)\b/i);
      if (m && m.index !== undefined) {
        out = out.slice(0, m.index) + tag + out.slice(m.index);
      } else {
        out = tag + out;
      }
      inserted++;
    } else if (f.position === 'body') {
      // すべての <p> 開始位置を集めて、中点に挿入
      const positions: number[] = [];
      const re = /<p\b[^>]*>/gi;
      let mm: RegExpExecArray | null;
      while ((mm = re.exec(out)) !== null) positions.push(mm.index);
      if (positions.length >= 2) {
        const idx = positions[Math.floor(positions.length / 2)];
        out = out.slice(0, idx) + tag + out.slice(idx);
      } else {
        // 段落が無い場合は末尾に追加
        out = out + tag;
      }
      inserted++;
    } else if (f.position === 'summary') {
      // harmony-cta / harmony-faq / 最初の見出し系セクション直前を探す
      const anchors = [
        /<div[^>]*class="[^"]*harmony-cta[^"]*"/i,
        /<div[^>]*class="[^"]*harmony-faq[^"]*"/i,
      ];
      let idx = -1;
      for (const a of anchors) {
        const mm = out.match(a);
        if (mm && mm.index !== undefined) {
          if (idx === -1 || mm.index < idx) idx = mm.index;
        }
      }
      if (idx >= 0) {
        out = out.slice(0, idx) + tag + out.slice(idx);
      } else {
        out = out + tag;
      }
      inserted++;
    } else {
      // 未知 position は末尾に追加
      out = out + tag;
      inserted++;
    }
  }

  return { html: out, inserted };
}

// ---- image_files 正規化 ----------------------------------------------------
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
    change_type: 'auto_apply_images_batch',
    changed_by: 'script:auto-apply-images-batch',
    comment: JSON.stringify({
      reason: 'stage2_body_html の <img> 数が image_files より少なかったため一括修復',
    }),
  });
  if (insErr) throw new Error(`revision INSERT 失敗: ${insErr.message}`);
}

// ---- メイン ----------------------------------------------------------------
interface Candidate {
  id: string;
  slug: string | null;
  imgCountBefore: number;
  imageFilesCount: number;
  beforeHtml: string;
  afterHtml: string;
  imgCountAfter: number;
  phase1: number;
  phase2: number;
  injected: number;
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
  console.log(`Mode: ${mode}`);

  // --- 全 zero-gen articles をページング取得 ----------------------------
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
      .eq('generation_mode', 'zero')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`articles SELECT 失敗: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`Total zero-gen articles scanned: ${all.length}`);

  // --- 候補抽出 ---------------------------------------------------------
  const candidates: Candidate[] = [];
  let noImageFilesCount = 0;
  let alreadyOkCount = 0;
  let cannotRepairCount = 0;

  for (const row of all) {
    const body = row.stage2_body_html ?? '';
    const files = normalizeImageFiles(row.image_files);
    if (files.length === 0) {
      noImageFilesCount++;
      continue;
    }
    const imgBefore = countImgTags(body);
    if (imgBefore >= files.length) {
      alreadyOkCount++;
      continue;
    }
    // 修復試行
    const r = replaceImagePlaceholders(body, files);
    const imgAfter = countImgTags(r.html);
    if (imgAfter <= imgBefore) {
      // 置換器が増やせなかった (プレースホルダがそもそも無いケース等)
      cannotRepairCount++;
      continue;
    }
    candidates.push({
      id: row.id,
      slug: row.slug,
      imgCountBefore: imgBefore,
      imageFilesCount: files.length,
      beforeHtml: body,
      afterHtml: r.html,
      imgCountAfter: imgAfter,
      phase1: r.phase1,
      phase2: r.phase2,
      imageFiles: files,
    });
  }

  console.log('');
  console.log(`zero-gen 記事 image_files なし    : ${noImageFilesCount} 件`);
  console.log(`画像反映済 (img >= image_files)    : ${alreadyOkCount} 件`);
  console.log(`修復不能 (置換器が触れず)         : ${cannotRepairCount} 件`);
  console.log(`修復対象                          : ${candidates.length} 件`);
  console.log('');

  if (candidates.length === 0) {
    console.log('修復対象なし。終了します。');
    return;
  }

  console.log(`次の ${candidates.length} 件を再置換${args.apply ? 'します' : '対象として表示します (dry-run)'}:`);
  for (const c of candidates) {
    console.log(
      `  - id=${c.id} slug=${c.slug ?? '(none)'} img:${c.imgCountBefore}→${c.imgCountAfter}/${c.imageFilesCount} phase1=${c.phase1} phase2=${c.phase2}`,
    );
  }

  if (!args.apply) {
    console.log('\n--apply を付けると実反映されます。');
    return;
  }

  // --- ロールバック JSON ------------------------------------------------
  const tmpDir = path.resolve(process.cwd(), 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const rollbackPath = path.join(
    tmpDir,
    `auto-apply-images-rollback-${ts}.json`,
  );
  fs.writeFileSync(
    rollbackPath,
    JSON.stringify(
      candidates.map((c) => ({
        id: c.id,
        slug: c.slug,
        before_html: c.beforeHtml,
        after_html: c.afterHtml,
        image_files: c.imageFiles,
        img_before: c.imgCountBefore,
        img_after: c.imgCountAfter,
        phase1: c.phase1,
        phase2: c.phase2,
      })),
      null,
      2,
    ),
    'utf-8',
  );
  console.log(`\nロールバック JSON: ${rollbackPath}`);

  // --- 実反映 (履歴 INSERT → UPDATE) ------------------------------------
  let updated = 0;
  let failed = 0;
  for (const c of candidates) {
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
      console.log(`  OK ${c.id} (img ${c.imgCountBefore}->${c.imgCountAfter})`);
    } catch (e) {
      failed++;
      console.error(`  NG ${c.id}: ${(e as Error).message}`);
    }
  }
  console.log(`\n完了: 更新=${updated} 失敗=${failed} / 候補=${candidates.length}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
