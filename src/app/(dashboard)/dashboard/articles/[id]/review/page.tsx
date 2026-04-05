// ============================================================================
// src/app/(dashboard)/dashboard/articles/[id]/review/page.tsx
// 本文レビューページ（ウィザード Step3）
// ============================================================================
'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { Article } from '@/types/article';
import StatusBadge from '@/components/common/StatusBadge';

// ─── SEOスコア計算 ──────────────────────────────────────────────────────────

interface SeoCheckItem {
  label: string;
  status: 'good' | 'warning' | 'bad';
  detail: string;
}

// キーワードマッチヘルパー（スペース区切り対応）
function kwTokens(kw: string): string[] {
  return kw.split(/[\s　]+/).filter(Boolean);
}
function kwContains(text: string, kw: string): boolean {
  const tokens = kwTokens(kw);
  if (tokens.length <= 1) return text.includes(kw);
  return tokens.every((t) => text.includes(t));
}
function kwCount(text: string, kw: string): number {
  const tokens = kwTokens(kw);
  if (tokens.length <= 1) {
    return (text.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  }
  return Math.min(...tokens.map((t) =>
    (text.match(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length,
  ));
}

function calculateSeoChecks(article: Article): SeoCheckItem[] {
  const checks: SeoCheckItem[] = [];
  const title = article.stage1_outline?.title_proposal ?? article.title ?? '';
  const meta = article.stage1_outline?.meta_description ?? article.meta_description ?? '';
  const keyword = article.keyword ?? '';
  const bodyHtml = article.stage2_body_html ?? '';

  // タイトル文字数チェック
  const titleLen = title.length;
  checks.push({
    label: 'タイトル文字数',
    status: titleLen >= 25 && titleLen <= 40 ? 'good' : titleLen >= 15 && titleLen <= 60 ? 'warning' : 'bad',
    detail: `${titleLen}文字（推奨: 25〜40文字）`,
  });

  // タイトルにキーワード含有
  if (keyword) {
    const titleHasKw = kwContains(title, keyword);
    checks.push({
      label: 'タイトルにキーワード',
      status: titleHasKw ? 'good' : 'bad',
      detail: titleHasKw
        ? `「${keyword}」の主要語を含んでいます`
        : `「${keyword}」が含まれていません`,
    });
  }

  // メタディスクリプション文字数
  const metaLen = meta.length;
  checks.push({
    label: 'メタディスクリプション',
    status: metaLen >= 80 && metaLen <= 160 ? 'good' : metaLen >= 50 && metaLen <= 200 ? 'warning' : 'bad',
    detail: `${metaLen}文字（推奨: 80〜160文字）`,
  });

  // メタにキーワード含有
  if (keyword) {
    const metaHasKw = kwContains(meta, keyword);
    checks.push({
      label: 'メタにキーワード',
      status: metaHasKw ? 'good' : 'warning',
      detail: metaHasKw
        ? `「${keyword}」の主要語を含んでいます`
        : `「${keyword}」が含まれていません`,
    });
  }

  // 本文にキーワード含有
  if (keyword && bodyHtml) {
    const plainText = bodyHtml.replace(/<[^>]+>/g, '');
    const count = kwCount(plainText, keyword);
    checks.push({
      label: '本文キーワード出現数',
      status: count >= 3 ? 'good' : count >= 1 ? 'warning' : 'bad',
      detail: `${count}回（推奨: 3回以上）`,
    });
  }

  // 本文文字数
  if (bodyHtml) {
    const plainText = bodyHtml.replace(/<[^>]+>/g, '');
    const wordCount = plainText.length;
    checks.push({
      label: '本文文字数',
      status: wordCount >= 1500 ? 'good' : wordCount >= 800 ? 'warning' : 'bad',
      detail: `${wordCount.toLocaleString()}文字`,
    });
  }

  // H2タグの存在チェック
  if (bodyHtml) {
    const h2Count = (bodyHtml.match(/<h2/g) || []).length;
    checks.push({
      label: 'H2見出しの数',
      status: h2Count >= 3 ? 'good' : h2Count >= 1 ? 'warning' : 'bad',
      detail: `${h2Count}個（推奨: 3個以上）`,
    });
  }

  return checks;
}

function getSeoScore(checks: SeoCheckItem[]): number {
  if (checks.length === 0) return 0;
  const points = checks.reduce((sum, c) => {
    if (c.status === 'good') return sum + 100;
    if (c.status === 'warning') return sum + 50;
    return sum;
  }, 0);
  return Math.round(points / checks.length);
}

// ─── SEOスコアリングUI ──────────────────────────────────────────────────────

function SeoScorePanel({ article }: { article: Article }) {
  const checks = calculateSeoChecks(article);
  const score = getSeoScore(checks);

  const scoreColor =
    score >= 80 ? 'text-emerald-600' : score >= 50 ? 'text-amber-600' : 'text-red-600';
  const scoreBg =
    score >= 80 ? 'bg-emerald-50 border-emerald-200' : score >= 50 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200';

  return (
    <div className="space-y-4">
      {/* 総合スコア */}
      <div className={`rounded-xl border p-4 text-center ${scoreBg}`}>
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">SEOスコア</p>
        <p className={`mt-1 text-4xl font-bold ${scoreColor}`}>{score}</p>
        <p className="text-xs text-slate-500">/ 100</p>
      </div>

      {/* チェック項目 */}
      <div className="space-y-2">
        {checks.map((check, idx) => (
          <div
            key={idx}
            className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
          >
            <span className="mt-0.5 shrink-0">
              {check.status === 'good' && (
                <svg className="h-4 w-4 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              )}
              {check.status === 'warning' && (
                <svg className="h-4 w-4 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
              )}
              {check.status === 'bad' && (
                <svg className="h-4 w-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-brand-800">{check.label}</p>
              <p className="text-xs text-slate-500">{check.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── メインコンポーネント ───────────────────────────────────────────────────

export default function ReviewPage() {
  const params = useParams();
  const router = useRouter();
  const articleId = params.id as string;

  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingStartRef = useRef<number | null>(null);
  const [pollingTimeout, setPollingTimeout] = useState(false);

  // ─── データ取得 ───────────────────────────────────────────────────────

  const fetchArticle = useCallback(async () => {
    try {
      const res = await fetch(`/api/articles/${articleId}`);
      if (!res.ok) throw new Error('記事の取得に失敗しました');
      const json = await res.json();
      const data: Article = json.data;
      setArticle(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期せぬエラー');
      return null;
    } finally {
      setLoading(false);
    }
  }, [articleId]);

  // ─── 初回取得 + ポーリング ────────────────────────────────────────────

  useEffect(() => {
    fetchArticle();
  }, [fetchArticle]);

  useEffect(() => {
    // body_generating の場合、3秒間隔でポーリング
    if (article?.status === 'body_generating') {
      pollingStartRef.current = Date.now();
      setPollingTimeout(false);

      pollingRef.current = setInterval(async () => {
        // 180秒（3分）でタイムアウト表示
        if (pollingStartRef.current && Date.now() - pollingStartRef.current > 180_000) {
          setPollingTimeout(true);
        }
        const updated = await fetchArticle();
        if (updated && updated.status !== 'body_generating') {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setPollingTimeout(false);
        }
      }, 3000);
    }

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [article?.status, fetchArticle]);

  // ─── 承認して編集へ ──────────────────────────────────────────────────

  const handleApproveEdit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/articles/${articleId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'editing' }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error ?? 'ステータス更新に失敗しました');
      }
      router.push(`/dashboard/articles/${articleId}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期せぬエラー');
    } finally {
      setSubmitting(false);
    }
  };

  // handleGoToEdit は handleApproveEdit と同一のため統合
  const handleGoToEdit = handleApproveEdit;

  // ─── 本文再生成 ──────────────────────────────────────────────────────

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/ai/generate-body`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId }),
      });
      if (!res.ok) throw new Error('本文再生成の開始に失敗しました');
      // ステータスがbody_generatingに変わるのでポーリングが開始される
      await fetchArticle();
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期せぬエラー');
    } finally {
      setRegenerating(false);
    }
  };

  // ─── ローディング ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" />
          <p className="text-sm text-brand-600">記事データを読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl py-10">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-700">{error}</p>
          <button
            className="mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm text-white hover:bg-brand-600"
            onClick={() => { setError(null); setLoading(true); fetchArticle(); }}
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="mx-auto max-w-3xl py-10 text-center">
        <p className="text-slate-500">記事データがありません。</p>
      </div>
    );
  }

  const isGenerating = article.status === 'body_generating';
  const bodyHtml = article.stage2_body_html ?? '';

  // ─── 生成中ローディング ───────────────────────────────────────────────

  if (isGenerating) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        {/* ヘッダー */}
        <div className="flex items-center justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs font-medium text-brand-400">STEP 3</span>
              <StatusBadge status={article.status} />
            </div>
            <h1 className="text-2xl font-bold text-brand-800">本文レビュー</h1>
          </div>
        </div>

        {/* 生成中表示 */}
        <div className="flex flex-col items-center justify-center rounded-xl border border-violet-200 bg-violet-50 px-4 py-12 sm:py-20">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
          </div>
          <h2 className="text-xl font-bold text-violet-800">AIが本文を生成中です...</h2>
          <p className="mt-2 text-sm text-violet-600">
            3秒ごとにステータスを確認しています。このページを開いたままお待ちください。
          </p>
          {pollingTimeout && (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              生成に通常より時間がかかっています。引き続き待つか、ページを再読み込みしてください。
              <button
                className="ml-2 underline hover:text-amber-900"
                onClick={() => { setLoading(true); fetchArticle(); }}
              >
                再読み込み
              </button>
            </div>
          )}
          <div className="mt-6 flex items-center gap-2">
            <div className="h-2 w-2 animate-bounce rounded-full bg-violet-400" style={{ animationDelay: '0ms' }} />
            <div className="h-2 w-2 animate-bounce rounded-full bg-violet-400" style={{ animationDelay: '150ms' }} />
            <div className="h-2 w-2 animate-bounce rounded-full bg-violet-400" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    );
  }

  // ─── レビュー表示 ─────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* ─ ヘッダー ─ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-medium text-brand-400">STEP 3</span>
            <StatusBadge status={article.status} />
          </div>
          <h1 className="text-xl font-bold text-brand-800 sm:text-2xl">本文レビュー</h1>
          <p className="mt-1 text-sm text-slate-500 truncate">
            キーワード:
            <span className="ml-1 font-medium text-brand-600">{article.keyword}</span>
            {article.title && (
              <>
                <span className="mx-2 text-slate-300">|</span>
                <span className="text-brand-700">{article.title}</span>
              </>
            )}
          </p>
        </div>
        <button
          className="self-start shrink-0 rounded-lg border border-brand-200 px-4 py-2.5 text-sm text-brand-600 hover:bg-brand-50 active:bg-brand-100 sm:self-auto"
          onClick={() => router.push(`/dashboard/articles/${articleId}/outline`)}
        >
          ← アウトラインへ
        </button>
      </div>

      {/* ─ 左右分割: HTML本文 + SEOスコア ─ */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-[1fr_320px]">
        {/* 左: HTML本文表示 & プレビュー */}
        <div className="space-y-6">
          {/* HTML本文 */}
          <section className="rounded-xl border border-brand-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-brand-100 px-4 py-3 sm:px-6">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-500">
                生成された本文（HTML）
              </h2>
              <span className="text-xs text-slate-400">
                {bodyHtml.replace(/<[^>]+>/g, '').length.toLocaleString()}文字
              </span>
            </div>
            <div className="max-h-[60vh] overflow-auto sm:max-h-[500px]">
              <pre className="whitespace-pre-wrap break-words px-4 py-4 font-mono text-xs text-slate-700 sm:px-6">
                {bodyHtml || '（本文がまだ生成されていません）'}
              </pre>
            </div>
          </section>

          {/* プレビュー */}
          <section className="rounded-xl border border-brand-200 bg-white shadow-sm">
            <div className="border-b border-brand-100 px-4 py-3 sm:px-6">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-500">
                プレビュー
              </h2>
            </div>
            <div className="max-h-[70vh] overflow-auto px-4 py-4 sm:max-h-[600px] sm:px-6">
              {bodyHtml ? (
                <div
                  className="prose prose-brand prose-sm max-w-none
                    prose-headings:text-brand-800 prose-headings:font-bold
                    prose-h2:mt-8 prose-h2:mb-4 prose-h2:border-b prose-h2:border-brand-200 prose-h2:pb-2
                    prose-h3:mt-6 prose-h3:mb-3
                    prose-p:text-brand-700 prose-p:leading-relaxed
                    prose-a:text-brand-500 prose-a:underline
                    prose-strong:text-brand-800
                    prose-ul:text-brand-700 prose-ol:text-brand-700"
                  dangerouslySetInnerHTML={{ __html: bodyHtml }}
                />
              ) : (
                <p className="py-10 text-center text-sm text-slate-400">
                  本文がまだ生成されていません
                </p>
              )}
            </div>
          </section>
        </div>

        {/* 右: SEOスコア（モバイルでは全幅） */}
        <div className="space-y-6 w-full">
          <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-brand-500">
              SEO分析
            </h2>
            <SeoScorePanel article={article} />
          </section>

          {/* 記事情報サマリ */}
          <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand-500">
              記事情報
            </h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">キーワード</dt>
                <dd className="font-medium text-brand-700">{article.keyword}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">テーマ</dt>
                <dd className="font-medium text-brand-700">{article.theme}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">ペルソナ</dt>
                <dd className="font-medium text-brand-700">{article.persona}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">目標文字数</dt>
                <dd className="font-medium text-brand-700">{article.target_word_count?.toLocaleString()}字</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>

      {/* ─ アクションボタン ─ */}
      <div className="flex flex-col gap-3 rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
          <button
            className="min-h-[44px] rounded-lg border border-amber-300 bg-amber-50 px-5 py-2.5 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100 active:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handleRegenerate}
            disabled={regenerating || submitting}
          >
            {regenerating ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
                再生成中...
              </span>
            ) : (
              '本文再生成'
            )}
          </button>

          <button
            className="min-h-[44px] rounded-lg border border-blue-300 bg-blue-50 px-5 py-2.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 active:bg-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handleGoToEdit}
            disabled={submitting || regenerating}
          >
            編集画面へ
          </button>
        </div>

        <button
          className="min-h-[44px] rounded-lg bg-brand-500 px-6 py-2.5 text-sm font-bold text-white shadow-md transition-colors hover:bg-brand-600 active:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleApproveEdit}
          disabled={submitting || regenerating}
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              処理中...
            </span>
          ) : (
            '承認して編集へ →'
          )}
        </button>
      </div>
    </div>
  );
}
