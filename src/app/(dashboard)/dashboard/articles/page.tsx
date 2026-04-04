'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Plus, ChevronLeft, ChevronRight, ArrowUpDown } from 'lucide-react';
import StatusBadge from '@/components/common/StatusBadge';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ArticleItem {
  id: string;
  title: string | null;
  keyword: string;
  status: string;
  updated_at: string;
}

interface ArticlesResponse {
  data: ArticleItem[];
  meta?: { total: number };
  /** @deprecated 後方互換 */
  count?: number;
}

type SortKey = 'updated_at' | 'status';
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
      return `/dashboard/articles/${id}`;
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

  // Filters
  const initialStatus = searchParams.get('status') ?? '';
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [keyword, setKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>('updated_at');
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
    const sorted = [...articles];
    sorted.sort((a, b) => {
      if (sortKey === 'status') {
        const diff = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
        return sortDir === 'asc' ? diff : -diff;
      }
      // updated_at
      const diff = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      return sortDir === 'asc' ? diff : -diff;
    });
    return sorted;
  }, [articles, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'updated_at' ? 'desc' : 'asc');
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

  const handleRowClick = (article: ArticleItem) => {
    router.push(getArticlePath(article.id, article.status));
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
    if (sortKey !== key) return null;
    return sortDir === 'asc' ? ' \u2191' : ' \u2193';
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-800">記事一覧</h1>
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
        <button
          onClick={() => router.push('/dashboard/articles/new')}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5
            text-sm font-medium text-white transition hover:bg-brand-600
            focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          <Plus className="h-4 w-4" />
          新規記事作成
        </button>
      </div>

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
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="キーワード検索..."
            className="w-full rounded-lg border border-brand-200 bg-white py-2 pl-10 pr-4
              text-sm transition focus:border-brand-500 focus:outline-none
              focus:ring-2 focus:ring-brand-500/20 sm:w-64"
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

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-brand-200 bg-white shadow-sm">
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
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="h-6 w-6 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-500" />
                    <span className="text-sm text-brand-400">読み込み中...</span>
                  </div>
                </td>
              </tr>
            ) : sortedArticles.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-brand-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                    </svg>
                    <p className="text-sm text-brand-400">
                      {statusFilter || keyword
                        ? '検索条件に一致する記事が見つかりません'
                        : 'まだ記事がありません'}
                    </p>
                    {!statusFilter && !keyword && (
                      <Link
                        href="/dashboard/planner"
                        className="mt-1 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600"
                      >
                        AIプランナーで記事を作成しましょう
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              sortedArticles.map((article, idx) => (
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
                    <div className="font-medium text-brand-800 truncate max-w-md">
                      {article.title || '(タイトル未設定)'}
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
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-brand-500">
            全 {totalCount} 件中 {(page - 1) * PER_PAGE + 1} -{' '}
            {Math.min(page * PER_PAGE, totalCount)} 件
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-brand-200
                bg-white px-3 py-1.5 text-sm text-brand-600 transition
                hover:bg-brand-50 disabled:opacity-40 disabled:cursor-not-allowed"
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
                bg-white px-3 py-1.5 text-sm text-brand-600 transition
                hover:bg-brand-50 disabled:opacity-40 disabled:cursor-not-allowed"
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
