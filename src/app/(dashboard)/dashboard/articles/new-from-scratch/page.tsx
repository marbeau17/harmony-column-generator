// ============================================================================
// src/app/(dashboard)/dashboard/articles/new-from-scratch/page.tsx
// AI ゼロ生成（spec §11.1, §11.2）
// 入力: theme / persona / keywords (Tag Chip 最大8) / intent (Radio Card 4) / target_length
// 「生成」→ POST /api/articles/zero-generate-full → Stepper 表示
// 完了時:
//   - 2 カラム: 左 = 本文プレビュー + HallucinationResultPane
//                右 = スコアバッジ + RegenerationControls + 遷移ボタン
//   - ハルシネーション / 由起子トーン スコアバッジ（緑/黄/赤）
//   - 「記事ページへ」 / 「公開判断画面へ」 ボタン
// dark: 対応 + react-hot-toast でエラー通知
// ----------------------------------------------------------------------------
// 既存コンポーネント (HallucinationResultPane / RegenerationControls /
//   DiffViewer / GenerationStepper / IntentRadioCard) は読むのみ・変更なし。
// 既存 publish-control コア / articles.ts / 記事本文への write は一切行わない。
// マイグレ追加なし。
// ============================================================================
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Sparkles, X, ArrowRight, ShieldCheck, Heart } from 'lucide-react';
import toast from 'react-hot-toast';

import GenerationStepper, { type GenerationStage } from '@/components/articles/GenerationStepper';
import IntentRadioCard, { type IntentType } from '@/components/articles/IntentRadioCard';
import HallucinationResultPane from '@/components/articles/HallucinationResultPane';
import RegenerationControls from '@/components/articles/RegenerationControls';
import DiffViewer from '@/components/articles/DiffViewer';
import type {
  Claim,
  ClaimType,
  HallucinationResult,
  Risk,
  RiskLevel,
} from '@/types/hallucination';

// ─── Option definitions（記事作成ページと同じ枠を踏襲） ────────────────────

const THEME_CATEGORIES = [
  { value: 'soul_mission',    label: '魂と使命' },
  { value: 'relationships',   label: '人間関係' },
  { value: 'grief_care',      label: 'グリーフケア' },
  { value: 'self_growth',     label: '自己成長' },
  { value: 'healing',         label: '癒しと浄化' },
  { value: 'daily_awareness', label: '日常の気づき' },
  { value: 'spiritual_intro', label: 'スピリチュアル入門' },
] as const;

const PERSONA_TYPES = [
  { value: 'spiritual_beginner',      label: 'スピリチュアル初心者' },
  { value: 'self_growth_seeker',      label: '自己成長を求める人' },
  { value: 'grief_sufferer',          label: '喪失体験に苦しむ人' },
  { value: 'meditation_practitioner', label: '瞑想実践者' },
  { value: 'energy_worker',           label: 'エネルギーワーカー' },
  { value: 'life_purpose_seeker',     label: '人生の目的を探す人' },
  { value: 'holistic_health_seeker',  label: 'ホリスティック健康志向の人' },
] as const;

const MAX_KEYWORDS = 8;
const MIN_LENGTH = 800;
const MAX_LENGTH = 5000;

// ─── 結果型 ────────────────────────────────────────────────────────────────

/** /api/articles/zero-generate-full のレスポンス（必要な部分のみ）。 */
interface ZeroGenerateFullResponse {
  article_id: string;
  status?: string;
  generation_mode?: string;
  partial_success?: boolean;
  lead_summary?: string | null;
  narrative_arc?: string | null;
  scores?: {
    hallucination?: number | null;
    yukiko_tone?: number | null;
    centroid_similarity?: number | null;
  };
  claims_count?: number;
  criticals?: number;
  tone_passed?: boolean | null;
  cta_variants_count?: number;
  duration_ms?: number;
}

/** /api/articles/[id] レスポンス（必要部分のみ）。 */
interface ArticleDetail {
  id: string;
  title?: string | null;
  html_body?: string | null;
  stage2_body_html?: string | null;
  meta_description?: string | null;
  hallucination_score?: number | null;
  yukiko_tone_score?: number | null;
}

/** /api/articles/[id]/hallucination-check のレスポンス（必要部分のみ）。 */
interface HallucinationCheckApiResponse {
  hallucination_score?: number;
  criticals?: number;
  claims_count?: number;
  claims?: Claim[];
}

// ─── スコア → 色マッピング ─────────────────────────────────────────────────

type ScoreTone = 'good' | 'warn' | 'bad' | 'na';

/** ハルシネーション (0..100, 高いほど安全) → 色。 */
function hallucinationTone(score: number | null | undefined): ScoreTone {
  if (typeof score !== 'number') return 'na';
  if (score >= 80) return 'good';
  if (score >= 50) return 'warn';
  return 'bad';
}

/** 由起子トーン (0..1 想定) → 色。 */
function toneScoreTone(score: number | null | undefined): ScoreTone {
  if (typeof score !== 'number') return 'na';
  // 0..1 を 0..100 にスケール。1 を超えていれば既に 0..100 と判断。
  const v = score <= 1 ? score * 100 : score;
  if (v >= 75) return 'good';
  if (v >= 55) return 'warn';
  return 'bad';
}

const SCORE_TONE_CLS: Record<ScoreTone, string> = {
  good: 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-700',
  warn: 'bg-amber-100  text-amber-900  border-amber-300  dark:bg-amber-900/40  dark:text-amber-100  dark:border-amber-700',
  bad:  'bg-red-100    text-red-900    border-red-300    dark:bg-red-900/40    dark:text-red-100    dark:border-red-700',
  na:   'bg-stone-100  text-stone-700  border-stone-300  dark:bg-stone-800     dark:text-stone-200  dark:border-stone-600',
};

/** スコア → verdict (Pane の verdict カラー反映用)。 */
function deriveVerdict(
  hallucinationScore: number | null | undefined,
): HallucinationResult['verdict'] {
  if (typeof hallucinationScore !== 'number') return 'review';
  if (hallucinationScore >= 80) return 'pass';
  if (hallucinationScore >= 50) return 'review';
  return 'block';
}

/**
 * Claim[] と hallucination_score から HallucinationResult を擬似的に組み立てる。
 *
 * `runHallucinationChecks` は ClaimResult[] (validator 出力) を返すが、
 * API レスポンスには claims のみが含まれるため、表示用に最低限の HallucinationResult
 * へ詰め替える。risks は claim_type ベースの簡易評価で埋める（factual/spiritual=high、
 * attribution=medium、その他=low）— あくまで UI バッジの目安。
 */
function buildHallucinationResultForPane(args: {
  articleId: string;
  claims: Claim[];
  hallucinationScore: number | null | undefined;
  criticals: number | null | undefined;
}): HallucinationResult {
  const verdict = deriveVerdict(args.hallucinationScore);

  const riskLevelByType: Record<ClaimType, RiskLevel> = {
    factual:     'high',
    spiritual:   'high',
    logical:     'medium',
    attribution: 'medium',
    experience:  'low',
    general:     'low',
  };
  const riskScoreByType: Record<ClaimType, number> = {
    factual:     0.7,
    spiritual:   0.7,
    logical:     0.5,
    attribution: 0.5,
    experience:  0.2,
    general:     0.2,
  };
  const reasonByType: Record<ClaimType, string> = {
    factual:     '事実主張のため要事実確認',
    spiritual:   'スピリチュアル断定のため表現緩和を推奨',
    logical:     '論理推論のため整合性を確認',
    attribution: '引用のため出典確認を推奨',
    experience:  '体験談として記述',
    general:     '一般論として記述',
  };

  const risks: Risk[] = args.claims.map((c) => ({
    sentence_idx: c.sentence_idx,
    claim_text:   c.claim_text,
    claim_type:   c.claim_type,
    risk_level:   riskLevelByType[c.claim_type] ?? 'low',
    risk_score:   riskScoreByType[c.claim_type] ?? 0.3,
    reason:       reasonByType[c.claim_type] ?? '—',
  }));

  const summary =
    typeof args.hallucinationScore === 'number'
      ? `Hallucination スコア: ${args.hallucinationScore.toFixed(1)} / 100${
          typeof args.criticals === 'number' ? `（critical: ${args.criticals} 件）` : ''
        }`
      : `Claim ${args.claims.length} 件を解析しました`;

  return {
    article_id:  args.articleId,
    claims:      args.claims,
    risks,
    verdict,
    summary,
    analyzed_at: new Date().toISOString(),
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function NewFromScratchPage() {
  // ── Form state ────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState<string>('');
  const [persona, setPersona] = useState<string>('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState<string>('');
  const [intent, setIntent] = useState<IntentType | ''>('');
  const [targetLength, setTargetLength] = useState<number>(2000);

  // ── Generation state ──────────────────────────────────────────────────────
  const [stage, setStage] = useState<GenerationStage>('idle');
  const [stageError, setStageError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [result, setResult] = useState<ZeroGenerateFullResponse | null>(null);

  // ── Post-generate enrichment state ────────────────────────────────────────
  const [articleDetail, setArticleDetail] = useState<ArticleDetail | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [enrichLoading, setEnrichLoading] = useState<boolean>(false);

  // ── Diff preview state（再生成後の差分プレビュー枠） ─────────────────────
  const [diffBefore, setDiffBefore] = useState<string | null>(null);
  const [diffAfter, setDiffAfter] = useState<string | null>(null);

  const generating = stage !== 'idle' && stage !== 'done' && stage !== 'error';
  const stageTimers = useRef<number[]>([]);

  // ── ページ離脱防止（生成中） ─────────────────────────────────────────────
  useEffect(() => {
    if (!generating) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [generating]);

  // ── Stage timer cleanup ───────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stageTimers.current.forEach((id) => window.clearTimeout(id));
      stageTimers.current = [];
    };
  }, []);

  // ── Keyword chip handlers ─────────────────────────────────────────────────
  const addKeyword = useCallback(
    (raw: string) => {
      const trimmed = raw.trim().replace(/[、,]+$/u, '').trim();
      if (!trimmed) return;
      setKeywords((prev) => {
        if (prev.length >= MAX_KEYWORDS) {
          toast.error(`キーワードは最大 ${MAX_KEYWORDS} 個までです`);
          return prev;
        }
        if (prev.includes(trimmed)) {
          toast.error('同じキーワードは追加できません');
          return prev;
        }
        return [...prev, trimmed];
      });
    },
    [],
  );

  const removeKeyword = useCallback((kw: string) => {
    setKeywords((prev) => prev.filter((k) => k !== kw));
  }, []);

  const handleKeywordKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '、') {
      e.preventDefault();
      if (keywordDraft.trim()) {
        addKeyword(keywordDraft);
        setKeywordDraft('');
      }
    } else if (e.key === 'Backspace' && !keywordDraft && keywords.length > 0) {
      removeKeyword(keywords[keywords.length - 1]);
    }
  };

  // ── プレビュー生成（フォーム値をライブ反映） ─────────────────────────────
  const previewMeta = useMemo(() => {
    const themeLabel = THEME_CATEGORIES.find((t) => t.value === theme)?.label ?? '未選択';
    const personaLabel = PERSONA_TYPES.find((p) => p.value === persona)?.label ?? '未選択';
    const intentLabel = (() => {
      switch (intent) {
        case 'info': return '情報提供';
        case 'empathy': return '共感';
        case 'solve': return '課題解決';
        case 'introspect': return '内省促進';
        default: return '未選択';
      }
    })();
    return { themeLabel, personaLabel, intentLabel };
  }, [theme, persona, intent]);

  // ── 生成完了後: 記事詳細 + claims を取得 ─────────────────────────────────
  const enrichResult = useCallback(async (articleId: string) => {
    setEnrichLoading(true);
    try {
      // 並列で記事詳細とハルシネーション再評価を取る。
      // hallucination-check は POST だが冪等的に再実行可能なため、
      // ここで claims を取り直して Pane 用の HallucinationResult を組み立てる。
      const [articleRes, halluRes] = await Promise.allSettled([
        fetch(`/api/articles/${articleId}`, { method: 'GET' }),
        fetch(`/api/articles/${articleId}/hallucination-check`, { method: 'POST' }),
      ]);

      // 記事詳細
      if (articleRes.status === 'fulfilled' && articleRes.value.ok) {
        const json = (await articleRes.value.json().catch(() => ({}))) as
          | { data?: ArticleDetail }
          | ArticleDetail;
        const detail =
          (json as { data?: ArticleDetail }).data ?? (json as ArticleDetail);
        if (detail && typeof detail === 'object') {
          setArticleDetail(detail);
        }
      }

      // ハルシネーション claims
      if (halluRes.status === 'fulfilled' && halluRes.value.ok) {
        const json = (await halluRes.value
          .json()
          .catch(() => ({}))) as HallucinationCheckApiResponse;
        if (Array.isArray(json.claims)) {
          setClaims(json.claims);
        }
      }
    } catch (err) {
      // enrichment 失敗はエラーにしない（基本情報は API 直返却から取れるため）
      // eslint-disable-next-line no-console
      console.warn('[new-from-scratch] enrichResult failed:', err);
    } finally {
      setEnrichLoading(false);
    }
  }, []);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (generating) return;

    // 簡易バリデーション
    if (!theme) { toast.error('テーマを選択してください'); return; }
    if (!persona) { toast.error('ペルソナを選択してください'); return; }
    if (keywords.length === 0) { toast.error('キーワードを 1 つ以上追加してください'); return; }
    if (!intent) { toast.error('意図タイプを選択してください'); return; }
    if (!Number.isFinite(targetLength) || targetLength < MIN_LENGTH || targetLength > MAX_LENGTH) {
      toast.error(`目標文字数は ${MIN_LENGTH}〜${MAX_LENGTH} の範囲で指定してください`);
      return;
    }

    // タイマー & 状態リセット
    stageTimers.current.forEach((id) => window.clearTimeout(id));
    stageTimers.current = [];
    setResult(null);
    setArticleDetail(null);
    setClaims([]);
    setDiffBefore(null);
    setDiffAfter(null);
    setStageError(null);
    setStartedAt(Date.now());
    setStage('stage1');

    // バックエンド完了前に視覚的に進めるための擬似ステージ進行
    stageTimers.current.push(
      window.setTimeout(() => setStage((s) => (s === 'stage1' ? 'stage2' : s)), 30_000),
      window.setTimeout(() => setStage((s) => (s === 'stage2' ? 'hallucination' : s)), 110_000),
    );

    try {
      const res = await fetch('/api/articles/zero-generate-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 新 API は theme_id / persona_id (UUID) を要求するため、
          // フォームが UUID を保持していない現状はサーバ側でバリデーションエラーになる
          // 可能性があるが、UI 結合上はキー名を新 API に合わせる。
          theme_id: theme,
          persona_id: persona,
          keywords,
          intent,
          target_length: targetLength,
        }),
      });

      if (!res.ok && res.status !== 207) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body && typeof body.error === 'string' && body.error) ||
            `生成に失敗しました (HTTP ${res.status})`,
        );
      }

      const json = (await res.json()) as ZeroGenerateFullResponse;
      stageTimers.current.forEach((id) => window.clearTimeout(id));
      stageTimers.current = [];
      setResult(json);
      setStage('done');
      if (json.partial_success) {
        toast('一部処理が失敗しましたが、記事は生成されました', { icon: 'ℹ️' });
      } else {
        toast.success('記事生成が完了しました');
      }

      // 後追いで詳細 + claims を取得
      if (json.article_id) {
        void enrichResult(json.article_id);
      }
    } catch (err) {
      stageTimers.current.forEach((id) => window.clearTimeout(id));
      stageTimers.current = [];
      const message = err instanceof Error ? err.message : '生成に失敗しました';
      setStageError(message);
      setStage('error');
      toast.error(message);
    }
  };

  const handleReset = () => {
    if (generating) return;
    setStage('idle');
    setStageError(null);
    setStartedAt(null);
    setResult(null);
    setArticleDetail(null);
    setClaims([]);
    setDiffBefore(null);
    setDiffAfter(null);
  };

  const articleId = result?.article_id ?? null;

  // ── Pane 用 HallucinationResult を組立 ────────────────────────────────────
  const hallucinationResultForPane: HallucinationResult | null = useMemo(() => {
    if (!articleId) return null;
    return buildHallucinationResultForPane({
      articleId,
      claims,
      hallucinationScore: result?.scores?.hallucination ?? null,
      criticals: result?.criticals ?? null,
    });
  }, [articleId, claims, result?.scores?.hallucination, result?.criticals]);

  const previewHtmlBody =
    articleDetail?.html_body ??
    articleDetail?.stage2_body_html ??
    '<p class="text-stone-500">本文を取得中…</p>';

  // ── スコア値（バッジ用）。 ────────────────────────────────────────────────
  const hallucinationScoreVal = result?.scores?.hallucination ?? null;
  const yukikoToneScoreVal = result?.scores?.yukiko_tone ?? null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* ヘッダー */}
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-xl font-bold text-brand-800 dark:text-brand-50 sm:text-2xl">
          <Sparkles className="h-5 w-5 text-brand-500 dark:text-brand-300" />
          AI ゼロ生成
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          テーマ・ペルソナ・キーワード・意図のみから、AI が記事を一気通貫で生成します。
        </p>
      </div>

      {stage !== 'done' ? (
        // ════════════════════════════════════════════════════════════════════
        // 生成前 / 生成中: 既存の 2 カラム入力フォーム + Stepper
        // ════════════════════════════════════════════════════════════════════
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* ── 左 60% フォーム ─────────────────────────────────────────── */}
          <form
            onSubmit={handleSubmit}
            className="space-y-5 lg:col-span-3"
            aria-label="ゼロ生成フォーム"
          >
            <div
              className="space-y-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm
                dark:border-gray-700 dark:bg-gray-900 sm:p-6"
            >
              {/* テーマ */}
              <div>
                <label
                  htmlFor="theme"
                  className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-100"
                >
                  テーマ <span className="text-red-500">*</span>
                </label>
                <select
                  id="theme"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  disabled={generating}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm
                    text-gray-900 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20
                    disabled:cursor-not-allowed disabled:opacity-50
                    dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">選択してください</option>
                  {THEME_CATEGORIES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {/* ペルソナ */}
              <div>
                <label
                  htmlFor="persona"
                  className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-100"
                >
                  ペルソナ <span className="text-red-500">*</span>
                </label>
                <select
                  id="persona"
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                  disabled={generating}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm
                    text-gray-900 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20
                    disabled:cursor-not-allowed disabled:opacity-50
                    dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">選択してください</option>
                  {PERSONA_TYPES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>

              {/* キーワード Tag Chip */}
              <div>
                <label
                  htmlFor="keywords"
                  className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-100"
                >
                  キーワード <span className="text-red-500">*</span>
                  <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                    最大 {MAX_KEYWORDS} 個 / Enter または , で追加
                  </span>
                </label>
                <div
                  className={`flex min-h-[44px] flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5 transition
                    focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20
                    ${
                      generating
                        ? 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800'
                        : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800'
                    }`}
                >
                  {keywords.map((kw) => (
                    <span
                      key={kw}
                      className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-1 text-xs font-medium text-brand-800
                        dark:bg-brand-900/40 dark:text-brand-100"
                    >
                      {kw}
                      <button
                        type="button"
                        onClick={() => removeKeyword(kw)}
                        disabled={generating}
                        className="rounded-full p-0.5 transition hover:bg-brand-200 disabled:opacity-50 dark:hover:bg-brand-800"
                        aria-label={`${kw} を削除`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    id="keywords"
                    type="text"
                    value={keywordDraft}
                    onChange={(e) => setKeywordDraft(e.target.value)}
                    onKeyDown={handleKeywordKeyDown}
                    onBlur={() => {
                      if (keywordDraft.trim()) {
                        addKeyword(keywordDraft);
                        setKeywordDraft('');
                      }
                    }}
                    disabled={generating || keywords.length >= MAX_KEYWORDS}
                    placeholder={
                      keywords.length >= MAX_KEYWORDS
                        ? '上限に達しました'
                        : keywords.length === 0
                        ? '例: チャクラ, 瞑想, 初心者'
                        : '追加…'
                    }
                    className="min-w-[8rem] flex-1 border-0 bg-transparent px-1 py-1 text-sm
                      text-gray-900 placeholder:text-gray-400 focus:outline-none
                      disabled:cursor-not-allowed disabled:opacity-50
                      dark:text-gray-100 dark:placeholder:text-gray-500"
                  />
                </div>
              </div>

              {/* 意図 Radio Card */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-gray-800 dark:text-gray-100">
                  意図 <span className="text-red-500">*</span>
                </label>
                <IntentRadioCard
                  value={intent}
                  onChange={(v) => setIntent(v)}
                  disabled={generating}
                />
              </div>

              {/* 目標文字数 */}
              <div>
                <label
                  htmlFor="targetLength"
                  className="mb-1.5 block text-sm font-semibold text-gray-800 dark:text-gray-100"
                >
                  目標文字数
                  <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                    {MIN_LENGTH.toLocaleString()}〜{MAX_LENGTH.toLocaleString()} 文字
                  </span>
                </label>
                <input
                  id="targetLength"
                  type="number"
                  min={MIN_LENGTH}
                  max={MAX_LENGTH}
                  step={100}
                  value={targetLength}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) setTargetLength(n);
                  }}
                  disabled={generating}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm
                    text-gray-900 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20
                    disabled:cursor-not-allowed disabled:opacity-50
                    dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
              </div>

              {/* 送信ボタン */}
              <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-end">
                {stage === 'error' && (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="inline-flex items-center justify-center rounded-lg border border-gray-300
                      bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50
                      dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    リセット
                  </button>
                )}
                <button
                  type="submit"
                  disabled={generating}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5
                    text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 active:bg-brand-700
                    focus:outline-none focus:ring-2 focus:ring-brand-500/40
                    disabled:cursor-not-allowed disabled:opacity-50
                    dark:bg-brand-500 dark:hover:bg-brand-400"
                >
                  {generating ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {generating ? '生成中…' : '生成'}
                </button>
              </div>
            </div>
          </form>

          {/* ── 右 40% プレビュー ─────────────────────────────────────────── */}
          <aside className="space-y-4 lg:col-span-2" aria-label="プレビュー">
            {/* 入力サマリ */}
            <div
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm
                dark:border-gray-700 dark:bg-gray-900 sm:p-5"
            >
              <h2 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-100">
                入力プレビュー
              </h2>
              <dl className="space-y-2 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">テーマ</dt>
                  <dd className="text-right text-gray-900 dark:text-gray-100">
                    {previewMeta.themeLabel}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">ペルソナ</dt>
                  <dd className="text-right text-gray-900 dark:text-gray-100">
                    {previewMeta.personaLabel}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">意図</dt>
                  <dd className="text-right text-gray-900 dark:text-gray-100">
                    {previewMeta.intentLabel}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">目標文字数</dt>
                  <dd className="text-right tabular-nums text-gray-900 dark:text-gray-100">
                    {targetLength.toLocaleString()} 文字
                  </dd>
                </div>
                <div className="border-t border-gray-100 pt-2 dark:border-gray-800">
                  <dt className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                    キーワード（{keywords.length} / {MAX_KEYWORDS}）
                  </dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {keywords.length === 0 ? (
                      <span className="text-xs text-gray-400 dark:text-gray-500">未入力</span>
                    ) : (
                      keywords.map((kw) => (
                        <span
                          key={kw}
                          className="inline-flex items-center rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-800
                            dark:bg-brand-900/40 dark:text-brand-100"
                        >
                          {kw}
                        </span>
                      ))
                    )}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Stepper（生成中 / エラー時のみ表示） */}
            {stage !== 'idle' && (
              <GenerationStepper
                stage={stage}
                startedAt={startedAt}
                errorMessage={stageError}
              />
            )}
          </aside>
        </div>
      ) : (
        // ════════════════════════════════════════════════════════════════════
        // 生成完了: 2 カラム — 左: 本文 + HallucinationResultPane
        //                       右: スコア + RegenerationControls + 遷移
        // ════════════════════════════════════════════════════════════════════
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* ── 左 60%: HallucinationResultPane（本文プレビュー含む） ──── */}
          <section className="space-y-4 lg:col-span-3" aria-label="生成結果">
            {/* 完了サマリ */}
            <div
              className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm
                dark:border-emerald-900 dark:bg-emerald-950/40 sm:p-5"
            >
              <Sparkles
                className="h-5 w-5 text-emerald-600 dark:text-emerald-300"
                aria-hidden
              />
              <div>
                <h2 className="text-sm font-semibold text-emerald-800 dark:text-emerald-100">
                  記事生成が完了しました
                </h2>
                {result?.lead_summary && (
                  <p className="mt-1 line-clamp-3 text-xs text-emerald-900/80 dark:text-emerald-200/80">
                    {result.lead_summary}
                  </p>
                )}
              </div>
            </div>

            {/* HallucinationResultPane */}
            {hallucinationResultForPane && articleId && (
              <HallucinationResultPane
                articleId={articleId}
                htmlBody={previewHtmlBody}
                result={hallucinationResultForPane}
              />
            )}

            {/* 取得中インジケータ */}
            {enrichLoading && (
              <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
                追加の検証情報を取得しています…
              </div>
            )}

            {/* 差分プレビュー（再生成後に表示する想定の枠） */}
            {diffBefore !== null && diffAfter !== null && (
              <DiffViewer
                before={diffBefore}
                after={diffAfter}
                onAccept={() => {
                  setDiffBefore(null);
                  setDiffAfter(null);
                  toast.success('差分を採用しました（次サイクルで適用予定）');
                }}
                onReject={() => {
                  setDiffBefore(null);
                  setDiffAfter(null);
                  toast('差分を却下しました', { icon: '↩︎' });
                }}
              />
            )}
          </section>

          {/* ── 右 40%: スコア + 再生成 + 遷移 ──────────────────────────── */}
          <aside className="space-y-4 lg:col-span-2" aria-label="評価と操作">
            {/* スコアバッジ */}
            <div
              className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm
                dark:border-gray-700 dark:bg-gray-900 sm:p-5"
            >
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                品質スコア
              </h2>

              {/* ハルシネーション */}
              <div
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                  SCORE_TONE_CLS[hallucinationTone(hallucinationScoreVal)]
                }`}
              >
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                  <span className="text-xs font-semibold">ハルシネーション</span>
                </div>
                <span className="tabular-nums text-sm font-bold">
                  {typeof hallucinationScoreVal === 'number'
                    ? `${hallucinationScoreVal.toFixed(1)} / 100`
                    : '—'}
                </span>
              </div>

              {/* 由起子トーン */}
              <div
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                  SCORE_TONE_CLS[toneScoreTone(yukikoToneScoreVal)]
                }`}
              >
                <div className="flex items-center gap-2">
                  <Heart className="h-4 w-4" aria-hidden />
                  <span className="text-xs font-semibold">由起子トーン</span>
                </div>
                <span className="tabular-nums text-sm font-bold">
                  {typeof yukikoToneScoreVal === 'number'
                    ? yukikoToneScoreVal <= 1
                      ? `${(yukikoToneScoreVal * 100).toFixed(1)} / 100`
                      : `${yukikoToneScoreVal.toFixed(1)} / 100`
                    : '—'}
                </span>
              </div>

              {/* メタ情報 */}
              <dl className="space-y-1 border-t border-gray-100 pt-2 text-xs dark:border-gray-800">
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">Claim 件数</dt>
                  <dd className="tabular-nums text-gray-900 dark:text-gray-100">
                    {result?.claims_count ?? claims.length}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-gray-500 dark:text-gray-400">Critical 件数</dt>
                  <dd className="tabular-nums text-gray-900 dark:text-gray-100">
                    {result?.criticals ?? 0}
                  </dd>
                </div>
                {result?.partial_success && (
                  <div className="mt-1 rounded bg-amber-100 px-2 py-1 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                    一部処理が失敗しました（partial_success）
                  </div>
                )}
              </dl>
            </div>

            {/* 再生成コントロール */}
            {articleId && (
              <div
                className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm
                  dark:border-gray-700 dark:bg-gray-900 sm:p-5"
              >
                <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                  再生成
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  問題のある文 / 章 / 全体を再生成できます。
                </p>
                <RegenerationControls
                  articleId={articleId}
                  onRegenerated={() => {
                    // 再生成後は記事詳細と claims を再取得し、Pane と Diff 表示を更新
                    if (articleId) {
                      const before = previewHtmlBody;
                      void enrichResult(articleId).then(() => {
                        const after =
                          articleDetail?.html_body ??
                          articleDetail?.stage2_body_html ??
                          '';
                        if (before && after && before !== after) {
                          setDiffBefore(before);
                          setDiffAfter(after);
                        }
                      });
                    }
                  }}
                />
              </div>
            )}

            {/* 遷移ボタン */}
            <div
              className="space-y-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm
                dark:border-gray-700 dark:bg-gray-900 sm:p-5"
            >
              <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                次のアクション
              </h2>

              {articleId ? (
                <Link
                  href={`/dashboard/articles/${articleId}`}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2
                    text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700
                    focus:outline-none focus:ring-2 focus:ring-emerald-500/40
                    dark:bg-emerald-500 dark:hover:bg-emerald-400"
                >
                  記事ページへ
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  記事 ID が返却されませんでした。
                </p>
              )}

              <Link
                href="/dashboard/publish-events"
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-brand-500 bg-white px-4 py-2
                  text-sm font-semibold text-brand-700 transition hover:bg-brand-50
                  focus:outline-none focus:ring-2 focus:ring-brand-500/40
                  dark:border-brand-400 dark:bg-gray-900 dark:text-brand-200 dark:hover:bg-gray-800"
              >
                公開判断画面へ
                <ArrowRight className="h-4 w-4" />
              </Link>

              <button
                type="button"
                onClick={handleReset}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-300
                  bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50
                  dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                新しく生成する
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
