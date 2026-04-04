'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
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
  count: number;
}

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

// ─── Component ──────────────────────────────────────────────────────────────

export default function ArticlesPage() {
  const router = useRouter();

  const [articles, setArticles] = useState<ArticleItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE));

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
      setTotalCount(json.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : '記事の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, keyword, page]);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

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
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-800">記事一覧</h1>
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
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600">
          {error}
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
              <th className="whitespace-nowrap px-4 py-3 font-medium text-brand-600 w-32">
                ステータス
              </th>
              <th className="whitespace-nowrap px-4 py-3 font-medium text-brand-600 w-28">
                更新日
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-brand-400">
                  読み込み中...
                </td>
              </tr>
            ) : articles.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-brand-400">
                  記事が見つかりません
                </td>
              </tr>
            ) : (
              articles.map((article, idx) => (
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
