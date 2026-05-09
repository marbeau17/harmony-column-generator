// ============================================================================
// src/components/articles/KishotenketsuReview.tsx
// 起承転結ナラティブ レビュー UI (P5-100)
//
// spec: docs/specs/kishotenketsu-flow.md §6
//
// 責務:
//   - Stage1 で生成された起承転結プラン (4 phase) を 4 枚のカードで表示
//   - 各 phase は <textarea rows={3}> で inline 編集可能
//   - 文字数カウンター (50〜150 字推奨レンジ、範囲外は red)
//   - 転 (ten) phase のみ視覚強調 (border-l-4 + 由起子さん signature hint)
//   - 状態バッジ: 未生成 / 未承認 / 承認済 / 未保存の編集あり
//   - アクション: Stage1 再実行 / 一時保存 / 承認して本文生成へ進む
//   - Stage2 開始ガード: kishotenketsu_approved_at IS NOT NULL かつ未保存の編集なし
//
// 状態遷移 (spec §6.3):
//   kishotenketsu IS NULL                          → 「未生成」 + 生成ボタン
//   kishotenketsu 有 / approved_at IS NULL         → 「未承認」 (amber)
//   approved_at IS NOT NULL & 編集なし             → 「承認済」 (sage)
//   任意 phase 編集 → setApprovedAt(null) と等価   → 「未保存の編集あり」
//
// 設計原則:
//   - 編集が生じた瞬間 (textarea onChange) Stage2 ボタンを即時 disable
//   - 承認時は親 (outline page) に「次の plan + approve=true」を渡し、
//     PUT /api/articles/[id] で kishotenketsu_approved_at を ISO8601 で保存
//   - feature flag (NEXT_PUBLIC_KISHOTENKETSU_ENABLED) のチェックは呼び出し側責務
// ============================================================================

'use client';

import { useEffect, useMemo, useState } from 'react';
import type { KishotenketsuPlan, KishotenketsuPhase } from '@/lib/schemas/kishotenketsu';

// ─── 型定義 ──────────────────────────────────────────────────────────────────

interface KishotenketsuReviewProps {
  articleId: string;
  /** 既存プラン。null なら未生成状態。 */
  kishotenketsu: KishotenketsuPlan | null;
  /** 承認済みなら ISO8601、未承認なら null。 */
  approvedAt: string | null;
  /**
   * 一時保存 / 承認 時に呼ばれる。
   * approve=true の場合は kishotenketsu_approved_at を now() でセット。
   * approve=false は単なる下書き保存。
   */
  onUpdate: (next: KishotenketsuPlan, approve: boolean) => Promise<void>;
  /** Stage1 を再実行する (POST /api/ai/generate-outline)。 */
  onRegenerate: () => Promise<void>;
  /** 起承転結プランを新規生成する (POST /api/ai/generate-kishotenketsu)。 */
  onGenerate?: () => Promise<void>;
  /** Stage2 (本文生成) を起動する。承認済かつ編集なしのときだけ有効。 */
  onProceedToStage2?: () => Promise<void>;
}

interface PhaseDef {
  key: KishotenketsuPhase;
  label: string;
  hint: string;
  /** 転のみ視覚強調 */
  emphasis?: boolean;
  /** 由起子さん signature hint（転のみ） */
  signatureHint?: string;
}

// ─── phase 定義 (UI 順序固定) ───────────────────────────────────────────────

const PHASES: PhaseDef[] = [
  {
    key: 'ki',
    label: '起',
    hint: '読者の入口。共感から始める。',
  },
  {
    key: 'sho',
    label: '承',
    hint: 'テーマを深める。例示・体験。',
  },
  {
    key: 'ten',
    label: '転',
    hint: '視点の転換。承の延長ではなく、新しい角度の気づきを。',
    emphasis: true,
    signatureHint: '← ここで「視点転換」を入れます (由起子さん signature)',
  },
  {
    key: 'ketsu',
    label: '結',
    hint: '優しい余韻で締める。CTA への橋渡し。',
  },
];

const MIN_LEN = 50;
const MAX_LEN = 150;

// ─── ユーティリティ ─────────────────────────────────────────────────────────

/** 空のプラン (未生成 fallback)。 */
function emptyPlan(): KishotenketsuPlan {
  return {
    ki: '',
    sho: '',
    ten: '',
    ketsu: '',
    ten_perspective_shift: '',
  };
}

/** 2 つのプランが完全一致するか (編集検知用)。 */
function plansEqual(a: KishotenketsuPlan | null, b: KishotenketsuPlan | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.ki === b.ki &&
    a.sho === b.sho &&
    a.ten === b.ten &&
    a.ketsu === b.ketsu &&
    a.ten_perspective_shift === b.ten_perspective_shift
  );
}

/** ISO8601 を YYYY-MM-DD HH:mm 形式に整形。失敗時は元文字列。 */
function formatApprovedAt(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

// ─── メインコンポーネント ───────────────────────────────────────────────────

export default function KishotenketsuReview({
  articleId: _articleId,
  kishotenketsu,
  approvedAt,
  onUpdate,
  onRegenerate,
  onGenerate,
  onProceedToStage2,
}: KishotenketsuReviewProps) {
  // ── ローカル編集状態 ────────────────────────────────────────────────────
  const initialPlan = useMemo<KishotenketsuPlan>(
    () => (kishotenketsu ? { ...kishotenketsu } : emptyPlan()),
    [kishotenketsu],
  );

  const [draft, setDraft] = useState<KishotenketsuPlan>(initialPlan);
  const [busy, setBusy] = useState<null | 'save' | 'approve' | 'regenerate' | 'generate' | 'stage2'>(null);
  const [error, setError] = useState<string | null>(null);

  // 親から新しい plan が降ってきたら draft をリセット (再生成・他タブ更新対応)
  useEffect(() => {
    setDraft(initialPlan);
    setError(null);
  }, [initialPlan]);

  // ── 派生状態 ─────────────────────────────────────────────────────────────
  const isGenerated = kishotenketsu !== null;
  const hasUnsavedEdits = isGenerated && !plansEqual(draft, kishotenketsu);
  const isApproved = approvedAt !== null && !hasUnsavedEdits;

  // バッジ判定 (spec §6.3)
  const badge: { label: string; tone: 'slate' | 'amber' | 'sage' | 'rose' } = (() => {
    if (!isGenerated) return { label: '未生成', tone: 'slate' };
    if (hasUnsavedEdits) return { label: '未保存の編集あり', tone: 'rose' };
    if (approvedAt) return { label: `承認済 ✓ ${formatApprovedAt(approvedAt)}`, tone: 'sage' };
    return { label: '未承認', tone: 'amber' };
  })();

  // 全 phase が 50〜150 字レンジ内かつ ten_perspective_shift も妥当か
  const allPhasesValid = useMemo(() => {
    if (!isGenerated) return false;
    return (
      draft.ki.length >= MIN_LEN && draft.ki.length <= MAX_LEN &&
      draft.sho.length >= MIN_LEN && draft.sho.length <= MAX_LEN &&
      draft.ten.length >= MIN_LEN && draft.ten.length <= MAX_LEN &&
      draft.ketsu.length >= MIN_LEN && draft.ketsu.length <= MAX_LEN
    );
  }, [draft, isGenerated]);

  const stage2Disabled = !isApproved || hasUnsavedEdits || busy !== null;

  // ── ハンドラ ─────────────────────────────────────────────────────────────
  const handlePhaseChange = (key: KishotenketsuPhase, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (busy) return;
    setBusy('save');
    setError(null);
    try {
      await onUpdate(draft, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setBusy(null);
    }
  };

  const handleApprove = async () => {
    if (busy) return;
    if (!allPhasesValid) {
      setError('各 phase を 50〜150 字の範囲で入力してから承認してください');
      return;
    }
    setBusy('approve');
    setError(null);
    try {
      await onUpdate(draft, true);
      // 承認後は本文生成へ自動進行（呼び出し側 onProceedToStage2 が定義されている場合）
      if (onProceedToStage2) {
        setBusy('stage2');
        await onProceedToStage2();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '承認に失敗しました');
    } finally {
      setBusy(null);
    }
  };

  const handleRegenerate = async () => {
    if (busy) return;
    setBusy('regenerate');
    setError(null);
    try {
      await onRegenerate();
    } catch (e) {
      setError(e instanceof Error ? e.message : '再生成に失敗しました');
    } finally {
      setBusy(null);
    }
  };

  const handleGenerate = async () => {
    if (busy || !onGenerate) return;
    setBusy('generate');
    setError(null);
    try {
      await onGenerate();
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成に失敗しました');
    } finally {
      setBusy(null);
    }
  };

  // ── レンダリング ────────────────────────────────────────────────────────
  return (
    <section
      className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm dark:border-brand-700 dark:bg-brand-900/40 sm:p-6"
      data-testid="kishotenketsu-review"
    >
      {/* ─ ヘッダー ─ */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-300">
            起承転結ナラティブ
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Stage2（本文生成）に進む前の最終確認です。各段 50〜150 字で記述してください。
          </p>
        </div>
        <BadgePill label={badge.label} tone={badge.tone} />
      </div>

      {/* ─ 未生成 fallback ─ */}
      {!isGenerated && (
        <div className="mb-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center dark:border-slate-600 dark:bg-slate-800/40">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            起承転結プランがまだ生成されていません。
          </p>
          {onGenerate && (
            <button
              type="button"
              className="mt-3 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-400 dark:hover:bg-brand-300 dark:text-brand-900"
              onClick={handleGenerate}
              disabled={busy !== null}
            >
              {busy === 'generate' ? '生成中…' : '起承転結を生成'}
            </button>
          )}
        </div>
      )}

      {/* ─ 4 phase カード ─ */}
      {isGenerated && (
        <div className="space-y-3">
          {PHASES.map((p) => (
            <PhaseCard
              key={p.key}
              def={p}
              value={draft[p.key]}
              onChange={(v) => handlePhaseChange(p.key, v)}
              disabled={busy !== null}
            />
          ))}

          {/* ten_perspective_shift (auxiliary) — 任意編集 */}
          <details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300">
            <summary className="cursor-pointer select-none">
              転の視点角度の自己説明 (ten_perspective_shift)
            </summary>
            <textarea
              className="mt-2 w-full resize-none rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:ring-2 focus:ring-brand-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              rows={2}
              value={draft.ten_perspective_shift}
              onChange={(e) => handlePhaseChange('ten_perspective_shift' as KishotenketsuPhase, e.target.value)}
              disabled={busy !== null}
              placeholder="承から転への視点角度差を 20〜120 字で説明"
            />
          </details>
        </div>
      )}

      {/* ─ エラー表示 ─ */}
      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200">
          {error}
        </p>
      )}

      {/* ─ アクションボタン ─ */}
      {isGenerated && (
        <div className="mt-5 flex flex-col gap-2 border-t border-brand-100 pt-4 dark:border-brand-700 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100 dark:hover:bg-amber-900/50"
            onClick={handleRegenerate}
            disabled={busy !== null}
          >
            {busy === 'regenerate' ? '再生成中…' : '← Stage1 を再実行'}
          </button>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className="rounded-lg border border-brand-300 bg-white px-4 py-2 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-brand-600 dark:bg-brand-900/40 dark:text-brand-200 dark:hover:bg-brand-800/40"
              onClick={handleSave}
              disabled={busy !== null || !hasUnsavedEdits}
              title={hasUnsavedEdits ? '編集内容を一時保存します' : '編集はありません'}
            >
              {busy === 'save' ? '保存中…' : '編集を一時保存'}
            </button>
            <button
              type="button"
              className="rounded-lg bg-brand-500 px-5 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-400 dark:hover:bg-brand-300 dark:text-brand-900"
              onClick={handleApprove}
              disabled={busy !== null || !allPhasesValid || (isApproved && !hasUnsavedEdits)}
              aria-disabled={stage2Disabled || !allPhasesValid}
              title={
                !allPhasesValid
                  ? '各段 50〜150 字を満たしてください'
                  : isApproved
                  ? 'すでに承認済です'
                  : '承認して本文生成へ進みます'
              }
            >
              {busy === 'approve' || busy === 'stage2'
                ? '処理中…'
                : '✓ 承認して本文生成へ進む'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── サブコンポーネント: PhaseCard ──────────────────────────────────────────

function PhaseCard({
  def,
  value,
  onChange,
  disabled,
}: {
  def: PhaseDef;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const len = value.length;
  const inRange = len >= MIN_LEN && len <= MAX_LEN;
  const counterTone = inRange
    ? 'text-sage dark:text-sage'
    : 'text-red-600 dark:text-red-400';

  // 転 (ten) のみ強調枠線
  const cardBase = def.emphasis
    ? 'rounded-lg border border-amber-200 bg-amber-50/60 p-3 border-l-4 border-l-amber-500 dark:border-amber-700 dark:bg-amber-900/20'
    : 'rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/40';

  return (
    <div className={cardBase}>
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold ${
              def.emphasis
                ? 'bg-amber-500 text-white'
                : 'bg-brand-500 text-white dark:bg-brand-400 dark:text-brand-900'
            }`}
          >
            {def.label}
          </span>
          <span className="text-xs text-slate-600 dark:text-slate-300">{def.hint}</span>
        </div>
        <span
          data-testid={`kishotenketsu-counter-${def.key}`}
          className={`shrink-0 text-xs font-medium ${counterTone}`}
        >
          {len}/{MAX_LEN}
        </span>
      </div>

      {def.signatureHint && (
        <p className="mb-1.5 text-xs italic text-amber-700 dark:text-amber-200">
          {def.signatureHint}
        </p>
      )}

      <textarea
        name={def.key}
        rows={3}
        className="w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-800 outline-none focus:ring-2 focus:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={`${def.label} を 50〜150 字で記述`}
      />
    </div>
  );
}

// ─── サブコンポーネント: BadgePill ──────────────────────────────────────────

function BadgePill({
  label,
  tone,
}: {
  label: string;
  tone: 'slate' | 'amber' | 'sage' | 'rose';
}) {
  const cls = {
    slate:
      'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
    amber:
      'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-100',
    sage:
      'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100',
    rose:
      'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-900/40 dark:text-rose-100',
  }[tone];

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-xs font-medium ${cls}`}
      data-testid="kishotenketsu-status-badge"
    >
      {label}
    </span>
  );
}
