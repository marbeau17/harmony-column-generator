'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Plus, ChevronLeft, ChevronRight, ArrowUpDown, RefreshCw, Download, Upload } from 'lucide-react';
import StatusBadge from '@/components/common/StatusBadge';
import PublishButton, { type PublishButtonState } from '@/components/articles/PublishButton';
import { rebuildHub, formatHubRebuildResult } from '@/lib/deploy/hub-rebuild-client';
import { fetchPublishedArticles } from '@/lib/articles/fetch-published-articles';

// publish-control-v2 flag (inlined at build time). Default OFF — existing UI unchanged.
const PUBLISH_CONTROL_V2 = process.env.NEXT_PUBLIC_PUBLISH_CONTROL_V2 === 'on';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ArticleItem {
  id: string;
  title: string | null;
  slug: string;
  keyword: string;
  status: string;
  updated_at: string;
  reviewed_at: string | null;
  hallucination_score?: number | null;
  yukiko_tone_score?: number | null;
  generation_mode?: string | null;
}

interface ArticlesResponse {
  data: ArticleItem[];
  meta?: { total: number };
  /** @deprecated 後方互換 */
  count?: number;
}

type SortKey =
  | 'updated_at'
  | 'status'
  | 'hallucination_score'
  | 'yukiko_tone_score'
  | 'generation_mode';
type SortDir = 'asc' | 'desc';

// ─── Filter config ──────────────────────────────────────────────────────────

const STATUS_FILTERS = [
  { value: '',                label: '全て' },
  { value: 'draft',           label: '下書き' },
  { value: 'outline_pending', label: 'レビュー中' },
  { value: 'editing',         label: '編集中' },
  { value: 'published',       label: '公開済み' },
] as const;

const PER_PAGE = 20;

// ─── Status → 遷移先マップ ──────────────────────────────────────────────────

function getArticlePath(id: string, status: string): string {
  switch (status) {
    case 'draft':
      return `/dashboard/articles/${id}/edit`;
    case 'outline_pending':
    case 'outline_approved':
      return `/dashboard/articles/${id}/outline`;
    case 'body_generating':
    case 'body_review':
      return `/dashboard/articles/${id}/review`;
    case 'editing':
      return `/dashboard/articles/${id}/edit`;
    case 'published':
      return `/dashboard/articles/${id}/edit`;
    default:
      return `/dashboard/articles/${id}`;
  }
}

// ─── Status ソート用の順序 ──────────────────────────────────────────────────

const STATUS_ORDER: Record<string, number> = {
  draft: 0,
  outline_pending: 1,
  outline_approved: 2,
  body_generating: 3,
  body_review: 4,
  editing: 5,
  published: 6,
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function ArticlesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [articles, setArticles] = useState<ArticleItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Bulk update related articles
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkUpdateResult, setBulkUpdateResult] = useState<string | null>(null);

  // Bulk export all articles
  const [bulkExporting, setBulkExporting] = useState(false);
  const [bulkExportResult, setBulkExportResult] = useState<string | null>(null);

  // Bulk deploy to server
  const [bulkDeploying, setBulkDeploying] = useState(false);
  const [bulkDeployResult, setBulkDeployResult] = useState<string | null>(null);

  const handleBulkDeploy = async () => {
    if (!confirm('確認済みの記事をサーバーにデプロイしますか？')) return;
    setBulkDeploying(true);
    setBulkDeployResult(null);
    try {
      const fetchResult = await fetchPublishedArticles(200);
      if (!fetchResult.ok) {
        setBulkDeployResult(`記事一覧取得エラー: ${fetchResult.error}`);
        return;
      }
      const freshArticles = fetchResult.articles as unknown as ArticleItem[];
      const reviewed = freshArticles.filter((a) => a.reviewed_at);
      const skipped = freshArticles.filter((a) => !a.reviewed_at);

      let success = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const article of reviewed) {
        try {
          const res = await fetch(`/api/articles/${article.id}/deploy`, { method: 'POST' });
          if (res.ok) {
            success++;
          } else {
            failed++;
            const body = await res.json().catch(() => ({}));
            errors.push(`${article.title}: ${body.error || res.status}`);
            console.error(`[Deploy FAIL] ${article.slug}:`, body);
          }
        } catch (err) {
          failed++;
          errors.push(`${article.title}: ネットワークエラー`);
          console.error(`[Deploy ERROR] ${article.slug}:`, err);
        }
      }

      // ★ UNCONDITIONAL hub rebuild — even if reviewed.length === 0 and even if some per-article deploys failed.
      const hubResult = await rebuildHub();

      let msg = `${success} 件デプロイ成功`;
      if (failed > 0) msg += `、${failed} 件失敗`;
      if (skipped.length > 0) msg += `（未確認スキップ: ${skipped.length} 件）`;
      msg += ` ／ ${formatHubRebuildResult(hubResult)}`;
      if (errors.length > 0) msg += `\n失敗: ${errors.slice(0, 3).join(' / ')}`;
      setBulkDeployResult(msg);
    } catch (err) {
      console.error('[BulkDeploy ERROR]:', err);
      setBulkDeployResult('デプロイに失敗しました');
    } finally {
      setBulkDeploying(false);
    }
  };

  // Filters
  const initialStatus = searchParams.get('status') ?? '';
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [reviewFilter, setReviewFilter] = useState<'all' | 'reviewed' | 'unreviewed'>('all');
  const [keyword, setKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);

  // Sort
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE));

  // ── ステータス別件数集計 ────────────────────────────────────────────────

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    articles.forEach((a) => {
      counts[a.status] = (counts[a.status] || 0) + 1;
    });
    return counts;
  }, [articles]);

  // ── Fetch ───────────────────────────────────────────────────────────────

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (keyword) params.set('keyword', keyword);
      params.set('limit', String(PER_PAGE));
      params.set('offset', String((page - 1) * PER_PAGE));

      const res = await fetch(`/api/articles?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`記事の取得に失敗しました (${res.status})`);
      }

      const json: ArticlesResponse = await res.json();
      setArticles(json.data);
      // API が meta.total を返す場合と count を返す場合の両方に対応
      setTotalCount(json.meta?.total ?? json.count ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : '記事の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, keyword, page]);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  // ── Sort ────────────────────────────────────────────────────────────────

  const sortedArticles = useMemo(() => {
    // Apply review filter
    let filtered = articles;
    if (reviewFilter === 'reviewed') {
      filtered = articles.filter((a) => a.reviewed_at != null);
    } else if (reviewFilter === 'unreviewed') {
      filtered = articles.filter((a) => a.reviewed_at == null);
    }

    // sortKey=null の場合はAPI返却順をそのまま維持（自動ソートしない）
    if (!sortKey) return filtered;

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortKey === 'status') {
        const diff = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
        return sortDir === 'asc' ? diff : -diff;
      }
      if (sortKey === 'hallucination_score' || sortKey === 'yukiko_tone_score') {
        // null は最後に寄せる
        const av = a[sortKey];
        const bv = b[sortKey];
        const aNull = av == null;
        const bNull = bv == null;
        if (aNull && bNull) return 0;
        if (aNull) return 1;
        if (bNull) return -1;
        const diff = (av as number) - (bv as number);
        return sortDir === 'asc' ? diff : -diff;
      }
      if (sortKey === 'generation_mode') {
        const av = a.generation_mode ?? '';
        const bv = b.generation_mode ?? '';
        const diff = av.localeCompare(bv);
        return sortDir === 'asc' ? diff : -diff;
      }
      // updated_at
      const diff = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      return sortDir === 'asc' ? diff : -diff;
    });
    return sorted;
  }, [articles, reviewFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key && sortDir === 'asc') {
      // 3rd click: reset to no sort
      setSortKey(null);
      setSortDir('desc');
      return;
    }
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // 数値スコア / 日付は降順から、文字列キーは昇順から
      const startDesc =
        key === 'updated_at' ||
        key === 'hallucination_score' ||
        key === 'yukiko_tone_score';
      setSortDir(startDesc ? 'desc' : 'asc');
    }
  };

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setKeyword(searchInput);
    setPage(1);
  };

  const handleStatusFilter = (value: string) => {
    setStatusFilter(value);
    setPage(1);
  };

  const handleReviewFilter = (value: 'all' | 'reviewed' | 'unreviewed') => {
    setReviewFilter(value);
    setPage(1);
  };

  const handleRowClick = (article: ArticleItem) => {
    router.push(getArticlePath(article.id, article.status));
  };

  const handleBulkUpdateRelated = async () => {
    setBulkUpdating(true);
    setBulkUpdateResult(null);
    try {
      const res = await fetch('/api/articles/update-related', { method: 'POST' });
      if (!res.ok) {
        throw new Error(`更新に失敗しました (${res.status})`);
      }
      const json = await res.json();
      const count = json.updatedCount ?? json.updated ?? 0;
      setBulkUpdateResult(`${count} 件の記事の関連記事を更新しました`);
    } catch (err) {
      setBulkUpdateResult(err instanceof Error ? err.message : '更新に失敗しました');
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleBulkExport = async () => {
    setBulkExporting(true);
    setBulkExportResult(null);
    try {
      const res = await fetch('/api/export/article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'エクスポートに失敗しました');
      }

      // Download the ZIP file
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'all-articles.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setBulkExportResult('ZIPファイルをダウンロードしました');
    } catch (err) {
      setBulkExportResult(`エラー: ${err instanceof Error ? err.message : 'エクスポートに失敗'}`);
    } finally {
      setBulkExporting(false);
    }
  };

  // ── Helpers ─────────────────────────────────────────────────────────────

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '\u2014';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '\u2014';
    return d.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  const sortIndicator = (key: SortKey) => {
    if (!sortKey || sortKey !== key) return null;
    return sortDir === 'asc' ? ' \u2191' : ' \u2193';
  };

  // \u30cf\u30eb\u30b7\u30cd\u30fc\u30b7\u30e7\u30f3\u30b9\u30b3\u30a2\u8868\u793a\uff08\u4f4e\u3044\u307b\u3069\u826f\u3044\uff09
  const renderHallucinationScore = (score: number | null | undefined) => {
    if (score == null || isNaN(score)) {
      return <span className="text-brand-300 dark:text-brand-500">\u2014</span>;
    }
    let cls = 'text-emerald-600 dark:text-emerald-400';
    if (score >= 0.35) cls = 'text-red-600 dark:text-red-400 font-semibold';
    else if (score >= 0.15) cls = 'text-amber-600 dark:text-amber-400';
    return <span className={`tabular-nums ${cls}`}>{score.toFixed(2)}</span>;
  };

  // \u7531\u8d77\u5b50\u30c8\u30fc\u30f3\u30b9\u30b3\u30a2\u8868\u793a\uff08\u9ad8\u3044\u307b\u3069\u826f\u3044\uff09
  const renderToneScore = (score: number | null | undefined) => {
    if (score == null || isNaN(score)) {
      return <span className="text-brand-300 dark:text-brand-500">\u2014</span>;
    }
    let cls = 'text-red-600 dark:text-red-400 font-semibold';
    if (score >= 0.85) cls = 'text-emerald-600 dark:text-emerald-400';
    else if (score >= 0.7) cls = 'text-amber-600 dark:text-amber-400';
    return <span className={`tabular-nums ${cls}`}>{score.toFixed(2)}</span>;
  };

  // \u751f\u6210\u30e2\u30fc\u30c9\u8868\u793a
  const renderGenerationMode = (mode: string | null | undefined) => {
    if (!mode) {
      return <span className="text-brand-300 dark:text-brand-500">\u2014</span>;
    }
    const isZero = mode === 'zero';
    const cls = isZero
      ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
      : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300';
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
        {mode}
      </span>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-brand-800 sm:text-2xl">記事一覧</h1>
          {!loading && totalCount > 0 && (
            <p className="mt-1 text-sm text-brand-500">
              全 {totalCount} 件
              {Object.keys(statusCounts).length > 0 && (
                <span className="ml-2 text-brand-400">
                  ({Object.entries(statusCounts).map(([s, c], i) => (
                    <span key={s}>
                      {i > 0 && ' / '}
                      {STATUS_FILTERS.find((f) => f.value === s)?.label ?? s}: {c}
                    </span>
                  ))})
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button
            onClick={handleBulkExport}
            disabled={bulkExporting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-brand-300
              bg-white px-4 py-2.5 text-sm font-medium text-brand-700 transition
              hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-500/20
              disabled:opacity-50 disabled:cursor-not-allowed
              sm:w-auto sm:justify-start"
          >
            <Download className={`h-4 w-4 ${bulkExporting ? 'animate-bounce' : ''}`} />
            {bulkExporting ? 'エクスポート中...' : '全記事エクスポート'}
          </button>
          <button
            onClick={handleBulkUpdateRelated}
            disabled={bulkUpdating}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-brand-300
              bg-white px-4 py-2.5 text-sm font-medium text-brand-700 transition
              hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-500/20
              disabled:opacity-50 disabled:cursor-not-allowed
              sm:w-auto sm:justify-start"
          >
            <RefreshCw className={`h-4 w-4 ${bulkUpdating ? 'animate-spin' : ''}`} />
            {bulkUpdating ? '更新中...' : '関連記事を一括更新'}
          </button>
          <button
            onClick={handleBulkDeploy}
            disabled={bulkDeploying}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-400
              bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700 transition
              hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/20
              disabled:opacity-50 disabled:cursor-not-allowed
              sm:w-auto sm:justify-start"
          >
            <Upload className={`h-4 w-4 ${bulkDeploying ? 'animate-bounce' : ''}`} />
            {bulkDeploying ? 'デプロイ中...' : 'サーバーに更新'}
          </button>
          <button
            onClick={() => router.push('/dashboard/articles/new')}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500
              px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600
              focus:outline-none focus:ring-2 focus:ring-brand-500/20
              sm:w-auto sm:justify-start"
          >
            <Plus className="h-4 w-4" />
            新規記事作成
          </button>
        </div>
      </div>

      {/* Bulk update result */}
      {bulkUpdateResult && (
        <div className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-700">
          <span>{bulkUpdateResult}</span>
          <button
            onClick={() => setBulkUpdateResult(null)}
            className="ml-4 text-brand-400 hover:text-brand-600 transition"
          >
            &times;
          </button>
        </div>
      )}

      {/* Bulk deploy result */}
      {bulkDeployResult && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <span>{bulkDeployResult}</span>
          <button
            onClick={() => setBulkDeployResult(null)}
            className="ml-4 text-emerald-400 hover:text-emerald-600 transition"
          >
            &times;
          </button>
        </div>
      )}

      {/* Bulk export result */}
      {bulkExportResult && (
        <div className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-700">
          <span>{bulkExportResult}</span>
          <button
            onClick={() => setBulkExportResult(null)}
            className="ml-4 text-brand-400 hover:text-brand-600 transition"
          >
            &times;
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Status filter buttons */}
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((sf) => (
            <button
              key={sf.value}
              onClick={() => handleStatusFilter(sf.value)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition
                ${
                  statusFilter === sf.value
                    ? 'bg-brand-500 text-white'
                    : 'bg-white text-brand-700 hover:bg-brand-100 border border-brand-200'
                }`}
            >
              {sf.label}
            </button>
          ))}

          {/* Review filter separator */}
          <span className="hidden sm:inline-flex items-center text-brand-300">|</span>

          {/* Review filter buttons */}
          {([
            { value: 'all' as const, label: '確認: 全て' },
            { value: 'reviewed' as const, label: '確認済み' },
            { value: 'unreviewed' as const, label: '未確認' },
          ]).map((rf) => (
            <button
              key={rf.value}
              onClick={() => handleReviewFilter(rf.value)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition
                ${
                  reviewFilter === rf.value
                    ? 'bg-emerald-500 text-white'
                    : 'bg-white text-brand-700 hover:bg-brand-100 border border-brand-200'
                }`}
            >
              {rf.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="relative w-full sm:w-auto">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="キーワード検索..."
            className="w-full rounded-lg border border-brand-200 bg-white py-2.5 pl-10 pr-4
              text-sm transition focus:border-brand-500 focus:outline-none
              focus:ring-2 focus:ring-brand-500/20 sm:w-64 sm:py-2"
          />
        </form>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
          <p>{error}</p>
          <button
            onClick={() => { setError(null); fetchArticles(); }}
            className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700"
          >
            再試行
          </button>
        </div>
      )}

      {/* Sort controls (mobile) */}
      <div className="flex items-center gap-2 sm:hidden">
        <span className="text-xs text-brand-500">並び替え:</span>
        <button
          onClick={() => toggleSort('updated_at')}
          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition
            ${sortKey === 'updated_at' ? 'bg-brand-500 text-white' : 'bg-white text-brand-600 border border-brand-200'}`}
        >
          <ArrowUpDown className="h-3 w-3" />
          更新日{sortIndicator('updated_at')}
        </button>
        <button
          onClick={() => toggleSort('status')}
          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition
            ${sortKey === 'status' ? 'bg-brand-500 text-white' : 'bg-white text-brand-600 border border-brand-200'}`}
        >
          <ArrowUpDown className="h-3 w-3" />
          ステータス{sortIndicator('status')}
        </button>
      </div>

      {/* Loading / Empty states */}
      {loading && (
        <div className="rounded-xl border border-brand-200 bg-white px-4 py-12 shadow-sm">
          <div className="flex flex-col items-center gap-3">
            <div className="h-6 w-6 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-500" />
            <span className="text-sm text-brand-400">読み込み中...</span>
          </div>
        </div>
      )}

      {!loading && sortedArticles.length === 0 && (
        <div className="rounded-xl border border-brand-200 bg-white px-4 py-12 shadow-sm">
          <div className="flex flex-col items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-brand-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
            <p className="text-sm text-brand-400">
              {statusFilter || keyword || reviewFilter !== 'all'
                ? '検索条件に一致する記事が見つかりません'
                : 'まだ記事がありません'}
            </p>
            {!statusFilter && !keyword && reviewFilter === 'all' && (
              <Link
                href="/dashboard/planner"
                className="mt-1 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600"
              >
                AIプランナーで記事を作成しましょう
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Desktop Table (hidden on mobile) */}
      {!loading && sortedArticles.length > 0 && (
        <div className="hidden overflow-hidden rounded-xl border border-brand-200 bg-white shadow-sm sm:block">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-brand-100 bg-brand-50/50">
                <th className="whitespace-nowrap px-4 py-3 font-medium text-brand-600 w-16">
                  No.
                </th>
                <th className="px-4 py-3 font-medium text-brand-600">
                  タイトル / キーワード
                </th>
                <th
                  className="whitespace-nowrap px-4 py-3 font-medium text-brand-600 w-32 cursor-pointer select-none hover:text-brand-800"
                  onClick={() => toggleSort('status')}
                >
                  ステータス{sortIndicator('status')}
                </th>
                <th
                  className="whitespace-nowrap px-4 py-3 font-medium text-brand-600 w-28 cursor-pointer select-none hover:text-brand-800"
                  onClick={() => toggleSort('updated_at')}
                >
                  更新日{sortIndicator('updated_at')}
                </th>
                <th
                  title="ハルシネーションスコア（低いほど良い）"
                  className="whitespace-nowrap px-3 py-3 font-medium text-brand-600 w-20 cursor-pointer select-none hover:text-brand-800 text-center"
                  onClick={() => toggleSort('hallucination_score')}
                >
                  ハルシネ{sortIndicator('hallucination_score')}
                </th>
                <th
                  title="由起子トーンスコア（高いほど良い）"
                  className="whitespace-nowrap px-3 py-3 font-medium text-brand-600 w-20 cursor-pointer select-none hover:text-brand-800 text-center"
                  onClick={() => toggleSort('yukiko_tone_score')}
                >
                  トーン{sortIndicator('yukiko_tone_score')}
                </th>
                <th
                  title="生成モード（zero / source）"
                  className="whitespace-nowrap px-3 py-3 font-medium text-brand-600 w-20 cursor-pointer select-none hover:text-brand-800 text-center"
                  onClick={() => toggleSort('generation_mode')}
                >
                  モード{sortIndicator('generation_mode')}
                </th>
                <th className="whitespace-nowrap px-4 py-3 font-medium text-brand-600 w-20 text-center">
                  確認
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedArticles.map((article, idx) => (
                <tr
                  key={article.id}
                  onClick={() => handleRowClick(article)}
                  className="cursor-pointer border-b border-brand-50 transition
                    hover:bg-brand-50/70 last:border-b-0"
                >
                  <td className="px-4 py-3 text-brand-400 tabular-nums">
                    {(page - 1) * PER_PAGE + idx + 1}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-brand-800 truncate max-w-md flex items-center gap-1.5">
                      {article.title || '(タイトル未設定)'}
                      {Boolean(article.reviewed_at) && (
                        <span title="由起子さん確認済み" className="text-emerald-500 flex-shrink-0">✅</span>
                      )}
                    </div>
                    {article.keyword && (
                      <div className="mt-0.5 text-xs text-brand-400">
                        {article.keyword}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={article.status} />
                  </td>
                  <td className="px-4 py-3 text-brand-500 tabular-nums">
                    {formatDate(article.updated_at)}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {renderHallucinationScore(article.hallucination_score)}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {renderToneScore(article.yukiko_tone_score)}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {renderGenerationMode(article.generation_mode)}
                  </td>
                  <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    {PUBLISH_CONTROL_V2 ? (
                      <PublishButton
                        articleId={article.id}
                        articleTitle={article.title ?? '(無題)'}
                        initialState={(article.reviewed_at ? 'live' : 'hidden') as PublishButtonState}
                        onChanged={(next) => {
                          const reviewedAt =
                            next === 'live' || next === 'hub_stale' ? new Date().toISOString() : null;
                          setArticles((prev) =>
                            prev.map((a) => (a.id === article.id ? { ...a, reviewed_at: reviewedAt } : a)),
                          );
                        }}
                      />
                    ) : (
                      <input
                        type="checkbox"
                        checked={Boolean(article.reviewed_at)}
                        title={article.reviewed_at ? `確認済み (${new Date(article.reviewed_at).toLocaleDateString('ja-JP')})` : '未確認 — クリックで確認'}
                        className="h-4 w-4 cursor-pointer accent-emerald-500"
                        onChange={async (e) => {
                          e.stopPropagation();
                          const wasReviewed = Boolean(article.reviewed_at);
                          const newVal = wasReviewed ? null : new Date().toISOString();

                          if (wasReviewed && !confirm(`「${article.title}」の確認を取り消しますか？\nハブページから非表示になります。`)) return;

                          const putRes = await fetch(`/api/articles/${article.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              reviewed_at: newVal,
                              reviewed_by: newVal ? '小林由起子' : null,
                            }),
                          });

                          if (!putRes.ok) {
                            setBulkDeployResult(`確認フラグ更新失敗 (HTTP ${putRes.status})`);
                            return;
                          }

                          setArticles((prev) =>
                            prev.map((a) => (a.id === article.id ? { ...a, reviewed_at: newVal } : a))
                          );

                          setBulkDeployResult('ハブ再生成中…');
                          const hubResult = await rebuildHub();
                          setBulkDeployResult(formatHubRebuildResult(hubResult));
                        }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile Card List (hidden on desktop) */}
      {!loading && sortedArticles.length > 0 && (
        <div className="flex flex-col gap-3 sm:hidden">
          {sortedArticles.map((article, idx) => (
            <div
              key={article.id}
              onClick={() => handleRowClick(article)}
              className="cursor-pointer rounded-xl border border-brand-200 bg-white p-4
                shadow-sm transition active:bg-brand-50/70"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-brand-800 leading-snug line-clamp-2">
                    <span className="mr-1.5 text-xs text-brand-400 tabular-nums">
                      {(page - 1) * PER_PAGE + idx + 1}.
                    </span>
                    {article.title || '(タイトル未設定)'}
                  </p>
                  {article.keyword && (
                    <p className="mt-1 text-xs text-brand-400 truncate">
                      {article.keyword}
                    </p>
                  )}
                </div>
                <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-300" />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <StatusBadge status={article.status} />
                <span className="text-xs text-brand-400 tabular-nums">
                  {formatDate(article.updated_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
          <p className="text-sm text-brand-500">
            全 {totalCount} 件中 {(page - 1) * PER_PAGE + 1} -{' '}
            {Math.min(page * PER_PAGE, totalCount)} 件
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-brand-200
                bg-white px-3 py-2 text-sm text-brand-600 transition
                hover:bg-brand-50 disabled:opacity-40 disabled:cursor-not-allowed
                sm:py-1.5"
            >
              <ChevronLeft className="h-4 w-4" />
              前へ
            </button>
            <span className="px-2 text-sm text-brand-500 tabular-nums">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="inline-flex items-center gap-1 rounded-lg border border-brand-200
                bg-white px-3 py-2 text-sm text-brand-600 transition
                hover:bg-brand-50 disabled:opacity-40 disabled:cursor-not-allowed
                sm:py-1.5"
            >
              次へ
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
