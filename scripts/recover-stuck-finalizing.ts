/**
 * scripts/recover-stuck-finalizing.ts
 * ============================================================================
 * stuck な finalizing / image_generating ジョブを recovery するスクリプト。
 *
 * 仕様:
 *   1. service-role で `generation_jobs` を走査:
 *        - stage IN ('finalizing', 'image_generating')
 *        - updated_at が 5 分以上前
 *   2. 各 stuck ジョブについて article 状態 (image_files / stage2 / stage3) を確認
 *   3. dry-run (default): stuck 一覧を表示するだけ
 *   4. --apply:
 *        - 画像生成済 (image_files >= 1) → runZeroGenCompletion で resume
 *          (idempotent: image_files が prompts と同数なら画像 gen は skip され、
 *           Stage2 placeholder 置換 + Stage3 生成 + DB UPDATE のみ実行される)
 *        - 画像生成未完 → stage='failed' + error メッセージをセット
 *          (ユーザーに再実行を促す)
 *
 * 使い方:
 *   tsx scripts/recover-stuck-finalizing.ts          # dry-run
 *   tsx scripts/recover-stuck-finalizing.ts --apply  # 実行
 *   tsx scripts/recover-stuck-finalizing.ts --apply --threshold-min=10
 * ============================================================================
 */
import * as fs from 'fs';
import * as path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ── .env.local 読み込み (他の scripts/*.ts と同様の方式) ─────────────────────
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const raw = fs.readFileSync(envPath, 'utf-8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

// ── 既存ロジック再利用 (re-implementation せず import で揃える) ─────────────
import { runZeroGenCompletion } from '../src/lib/zero-gen/run-completion';
// 注: replaceImagePlaceholders / generateArticleHtml は runZeroGenCompletion 内で
// 既に呼ばれているため、resume は runZeroGenCompletion を 1 回呼ぶだけで完結する。
// (skipImages=false でも image_files が満たされていれば内部で skip される設計)

// ── CLI 引数 ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const thresholdArg = argv.find((a) => a.startsWith('--threshold-min='));
const THRESHOLD_MIN = thresholdArg
  ? Number(thresholdArg.split('=')[1])
  : 5;

const STUCK_STAGES = ['finalizing', 'image_generating'] as const;

interface JobRow {
  id: string;
  article_id: string | null;
  stage: string;
  progress: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface ArticleSnapshot {
  id: string;
  title: string | null;
  status: string | null;
  generation_mode: string | null;
  stage2_chars: number;
  stage3_chars: number;
  image_files_count: number;
  has_meta: boolean;
  has_seo_filename: boolean;
}

interface Diagnosis {
  job: JobRow;
  article: ArticleSnapshot | null;
  /** 'resume' | 'fail' | 'skip' */
  action: 'resume' | 'fail' | 'skip';
  reason: string;
  stuckMinutes: number;
}

function ageMinutes(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

async function loadArticleSnapshot(
  sb: SupabaseClient,
  articleId: string,
): Promise<ArticleSnapshot | null> {
  const { data, error } = await sb
    .from('articles')
    .select(
      'id, title, status, generation_mode, stage2_body_html, stage3_final_html, image_files, meta_description, seo_filename',
    )
    .eq('id', articleId)
    .maybeSingle();
  if (error || !data) return null;
  const imageFiles = Array.isArray(data.image_files)
    ? (data.image_files as unknown[])
    : [];
  return {
    id: data.id as string,
    title: (data.title as string | null) ?? null,
    status: (data.status as string | null) ?? null,
    generation_mode: (data.generation_mode as string | null) ?? null,
    stage2_chars: ((data.stage2_body_html as string | null) ?? '').length,
    stage3_chars: ((data.stage3_final_html as string | null) ?? '').length,
    image_files_count: imageFiles.length,
    has_meta: Boolean((data.meta_description as string | null)?.length),
    has_seo_filename: Boolean((data.seo_filename as string | null)?.length),
  };
}

function diagnose(job: JobRow, article: ArticleSnapshot | null): Diagnosis {
  const stuckMinutes = ageMinutes(job.updated_at);
  if (!article) {
    return {
      job,
      article,
      action: 'fail',
      reason: 'article_id に対応する記事が見つからない',
      stuckMinutes,
    };
  }
  if (article.stage2_chars === 0) {
    return {
      job,
      article,
      action: 'fail',
      reason: 'stage2_body_html が空 — finalizing 前段で失敗している',
      stuckMinutes,
    };
  }
  if (article.image_files_count >= 1) {
    return {
      job,
      article,
      action: 'resume',
      reason: `image_files=${article.image_files_count} 既存 — Stage2 置換 + Stage3 + DB UPDATE を resume`,
      stuckMinutes,
    };
  }
  return {
    job,
    article,
    action: 'fail',
    reason: 'image_files が空 — 画像生成未完。ユーザーに再実行を促す',
    stuckMinutes,
  };
}

function formatTable(diags: Diagnosis[]): string {
  if (diags.length === 0) return '  (該当なし)';
  const lines: string[] = [];
  for (const d of diags) {
    const a = d.article;
    lines.push(
      [
        `  job=${d.job.id}`,
        `stage=${d.job.stage}`,
        `stuck=${d.stuckMinutes}m`,
        `article=${d.job.article_id ?? '(null)'}`,
        a
          ? `status=${a.status} mode=${a.generation_mode} stage2=${a.stage2_chars}c stage3=${a.stage3_chars}c imgs=${a.image_files_count}`
          : 'article=NOT_FOUND',
        `→ ${d.action.toUpperCase()}: ${d.reason}`,
      ].join(' | '),
    );
  }
  return lines.join('\n');
}

async function applyResume(
  sb: SupabaseClient,
  d: Diagnosis,
): Promise<{ ok: boolean; message: string }> {
  const articleId = d.job.article_id;
  if (!articleId) {
    return { ok: false, message: 'article_id が null' };
  }
  try {
    const result = await runZeroGenCompletion({ articleId });
    // 成功したら job を done に更新
    const { error } = await sb
      .from('generation_jobs')
      .update({
        stage: 'done',
        progress: 1.0,
        eta_seconds: 0,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', d.job.id);
    if (error) {
      return {
        ok: true,
        message: `runZeroGenCompletion OK だが job UPDATE 失敗: ${error.message} (resume 自体は成功)`,
      };
    }
    return {
      ok: true,
      message: `resume OK: imgs=${result.imageFilesCount} stage3=${result.stage3HtmlChars}c partial=${result.partial} issues=${result.validationIssues.length}`,
    };
  } catch (e) {
    const msg = (e as Error).message;
    return { ok: false, message: `runZeroGenCompletion 失敗: ${msg}` };
  }
}

async function applyFail(
  sb: SupabaseClient,
  d: Diagnosis,
): Promise<{ ok: boolean; message: string }> {
  const errorMsg =
    `[recover-stuck-finalizing] ${d.reason} (stuck ${d.stuckMinutes}m). ` +
    `ユーザーに再実行を促してください。`;
  const { error } = await sb
    .from('generation_jobs')
    .update({
      stage: 'failed',
      error: errorMsg,
      updated_at: new Date().toISOString(),
    })
    .eq('id', d.job.id);
  if (error) {
    return { ok: false, message: `job UPDATE 失敗: ${error.message}` };
  }
  return { ok: true, message: 'job を failed にマーク' };
}

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const cutoff = new Date(Date.now() - THRESHOLD_MIN * 60_000).toISOString();
  console.log(
    `[recover-stuck-finalizing] mode=${APPLY ? 'APPLY' : 'DRY-RUN'} threshold=${THRESHOLD_MIN}min cutoff=${cutoff}`,
  );

  const { data: jobs, error } = await sb
    .from('generation_jobs')
    .select('*')
    .in('stage', STUCK_STAGES as unknown as string[])
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true });

  if (error) {
    console.error('generation_jobs 取得失敗:', error.message);
    process.exit(1);
  }
  const stuckJobs = (jobs ?? []) as JobRow[];

  console.log(`\n=== stuck ジョブ: ${stuckJobs.length} 件 ===`);

  // 各 stuck ジョブを並列に diagnosis
  const diags = await Promise.all(
    stuckJobs.map(async (j) => {
      const a = j.article_id ? await loadArticleSnapshot(sb, j.article_id) : null;
      return diagnose(j, a);
    }),
  );

  const resumeList = diags.filter((d) => d.action === 'resume');
  const failList = diags.filter((d) => d.action === 'fail');
  const skipList = diags.filter((d) => d.action === 'skip');

  console.log(`\n[RESUME 候補] ${resumeList.length} 件`);
  console.log(formatTable(resumeList));
  console.log(`\n[FAIL マーク候補] ${failList.length} 件`);
  console.log(formatTable(failList));
  if (skipList.length > 0) {
    console.log(`\n[SKIP] ${skipList.length} 件`);
    console.log(formatTable(skipList));
  }

  if (!APPLY) {
    console.log('\n[dry-run] 上記が --apply で実行される処理です');
    console.log(
      `  RESUME: runZeroGenCompletion で Stage2 placeholder 置換 + Stage3 生成 + DB UPDATE を再実行 (画像 gen は image_files が満たされていれば skip)`,
    );
    console.log(
      `  FAIL:   stage='failed' + error メッセージをセット — ユーザーに再実行を促す`,
    );
    return;
  }

  // ── APPLY モード ────────────────────────────────────────────────────────
  console.log('\n=== APPLY 開始 ===');

  // resume は重い (画像 gen ではないにせよ I/O 多) ので、安全のため逐次実行
  let resumeOk = 0;
  for (const d of resumeList) {
    const res = await applyResume(sb, d);
    console.log(`  ${res.ok ? '[OK]' : '[NG]'} resume ${d.job.id}: ${res.message}`);
    if (res.ok) resumeOk++;
  }

  // fail マークは軽量 — 並列実行
  const failResults = await Promise.all(failList.map((d) => applyFail(sb, d).then((r) => ({ d, r }))));
  let failOk = 0;
  for (const { d, r } of failResults) {
    console.log(`  ${r.ok ? '[OK]' : '[NG]'} fail-mark ${d.job.id}: ${r.message}`);
    if (r.ok) failOk++;
  }

  console.log(
    `\n完了: resume=${resumeOk}/${resumeList.length}, fail=${failOk}/${failList.length}`,
  );
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});
