// ============================================================================
// src/app/(dashboard)/dashboard/source-articles/page.tsx
// 元記事（アメブロ CSV）管理ページ
// ============================================================================
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Modal from '@/components/common/Modal';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

interface SourceArticle {
  id: string;
  title: string;
  body: string;
  published_at: string | null;
  char_count: number;
  used: boolean;
}

interface PaginatedResponse {
  data: SourceArticle[];
  total: number;
  page: number;
  per_page: number;
}

interface Stats {
  total: number;
  used: number;
  unused: number;
}

// ─── 定数 ────────────────────────────────────────────────────────────────────

const PER_PAGE = 20;

// ─── ページコンポーネント ────────────────────────────────────────────────────

export default function SourceArticlesPage() {
  // 一覧系 state
  const [articles, setArticles] = useState<SourceArticle[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, used: 0, unused: 0 });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);

  // インポート系 state
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // プレビューモーダル
  const [preview, setPreview] = useState<SourceArticle | null>(null);

  // ─── データ取得 ─────────────────────────────────────────────────────────

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(PER_PAGE),
      });
      if (keyword) params.set('q', keyword);

      const res = await fetch(`/api/source-articles?${params}`);
      if (!res.ok) throw new Error('取得に失敗しました');
      const json: PaginatedResponse = await res.json();

      setArticles(json.data);
      setTotalPages(Math.max(1, Math.ceil(json.total / json.per_page)));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, keyword]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/source-articles/stats');
      if (!res.ok) return;
      const json: Stats = await res.json();
      setStats(json);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // ─── 検索 ──────────────────────────────────────────────────────────────

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setKeyword(searchInput);
  };

  // ─── CSV インポート ────────────────────────────────────────────────────

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportProgress('ファイルをアップロード中...');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/source-articles/import', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error ?? 'インポートに失敗しました');
      }

      const result = await res.json();
      setImportProgress(
        `完了: ${result.imported ?? 0} 件インポート、${result.skipped ?? 0} 件スキップ`,
      );

      // リフレッシュ
      fetchArticles();
      fetchStats();
    } catch (err: any) {
      setImportProgress(`エラー: ${err.message}`);
    } finally {
      setImporting(false);
      // ファイル入力をリセット
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ─── ページネーション ──────────────────────────────────────────────────

  const pageNumbers = () => {
    const pages: (number | '...')[] = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= page - 2 && i <= page + 2)) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== '...') {
        pages.push('...');
      }
    }
    return pages;
  };

  // ─── 日付フォーマット ──────────────────────────────────────────────────

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // ─── レンダー ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ページヘッダー */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">元記事管理</h1>
        <p className="mt-1 text-sm text-gray-500">
          アメブロ CSV からインポートした元記事を管理します
        </p>
      </div>

      {/* 統計カード */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">総記事数</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            {stats.total.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">使用済み</p>
          <p className="mt-1 text-2xl font-bold text-brand-600">
            {stats.used.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">未使用</p>
          <p className="mt-1 text-2xl font-bold text-sage">
            {stats.unused.toLocaleString()}
          </p>
        </div>
      </div>

      {/* ツールバー: 検索 + インポート */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            placeholder="キーワードで検索..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-64 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
          <button
            type="submit"
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600"
          >
            検索
          </button>
        </form>

        <div className="flex items-center gap-3">
          {importProgress && (
            <span
              className={`text-sm ${
                importProgress.startsWith('エラー')
                  ? 'text-red-500'
                  : importProgress.startsWith('完了')
                    ? 'text-emerald-600'
                    : 'text-gray-500'
              }`}
            >
              {importProgress}
            </span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleImport}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="inline-flex items-center gap-2 rounded-lg border border-brand-300 bg-white px-4 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-50 disabled:opacity-50"
          >
            {importing ? (
              <svg
                className="h-4 w-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            ) : (
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                />
              </svg>
            )}
            CSV インポート
          </button>
        </div>
      </div>

      {/* 記事一覧テーブル */}
      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-6 py-3 font-medium text-gray-500">タイトル</th>
                <th className="px-6 py-3 font-medium text-gray-500 whitespace-nowrap">
                  公開日
                </th>
                <th className="px-6 py-3 font-medium text-gray-500 whitespace-nowrap">
                  文字数
                </th>
                <th className="px-6 py-3 font-medium text-gray-500 whitespace-nowrap">
                  ステータス
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-400">
                    読み込み中...
                  </td>
                </tr>
              ) : articles.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-400">
                    {keyword
                      ? '検索条件に一致する記事がありません'
                      : '元記事がありません。CSV をインポートしてください。'}
                  </td>
                </tr>
              ) : (
                articles.map((article) => (
                  <tr
                    key={article.id}
                    onClick={() => setPreview(article)}
                    className="cursor-pointer transition-colors hover:bg-gray-50"
                  >
                    <td className="px-6 py-4">
                      <p className="truncate max-w-md font-medium text-gray-900">
                        {article.title}
                      </p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                      {formatDate(article.published_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                      {article.char_count.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          article.used
                            ? 'bg-slate-100 text-slate-600'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {article.used ? '使用済み' : '未使用'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ページネーション */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-6 py-3">
            <p className="text-xs text-gray-400">
              {page} / {totalPages} ページ
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-lg px-2.5 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-30"
              >
                前へ
              </button>
              {pageNumbers().map((p, i) =>
                p === '...' ? (
                  <span key={`dots-${i}`} className="px-1 text-gray-300">
                    ...
                  </span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`min-w-[2rem] rounded-lg px-2 py-1.5 text-sm font-medium transition-colors ${
                      p === page
                        ? 'bg-brand-500 text-white'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded-lg px-2.5 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-30"
              >
                次へ
              </button>
            </div>
          </div>
        )}
      </div>

      {/* プレビューモーダル */}
      <Modal
        isOpen={!!preview}
        onClose={() => setPreview(null)}
        title={preview?.title ?? ''}
      >
        {preview && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3 text-sm text-gray-500">
              <span>公開日: {formatDate(preview.published_at)}</span>
              <span>文字数: {preview.char_count.toLocaleString()}</span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  preview.used
                    ? 'bg-slate-100 text-slate-600'
                    : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                {preview.used ? '使用済み' : '未使用'}
              </span>
            </div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
              {preview.body}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
