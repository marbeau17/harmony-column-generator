// ============================================================================
// src/app/(dashboard)/dashboard/source-articles/page.tsx
// 元記事（アメブロ CSV）管理ページ
// ============================================================================
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/common/Modal';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

interface SourceArticle {
  id: string;
  title: string;
  content: string;
  original_url: string | null;
  published_at: string | null;
  word_count: number | null;
  is_processed: boolean;
  themes: string[];
  keywords: string[];
  emotional_tone: string | null;
  spiritual_concepts: string[];
  theme_category: string | null;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  data: SourceArticle[];
  count: number;
}

interface Stats {
  total: number;
  used: number;
  unused: number;
}

// ─── 定数 ────────────────────────────────────────────────────────────────────

const PER_PAGE = 20;

const THEME_CATEGORIES = [
  { value: '', label: 'すべてのテーマ' },
  { value: 'soul_mission', label: '魂と使命' },
  { value: 'relationships', label: '人間関係' },
  { value: 'grief_care', label: 'グリーフケア' },
  { value: 'self_growth', label: '自己成長' },
  { value: 'healing', label: '癒しと浄化' },
  { value: 'daily_awareness', label: '日常の気づき' },
  { value: 'spiritual_intro', label: 'スピリチュアル入門' },
] as const;

// ─── ページコンポーネント ────────────────────────────────────────────────────

export default function SourceArticlesPage() {
  const router = useRouter();

  // 一覧系 state
  const [articles, setArticles] = useState<SourceArticle[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState<Stats>({ total: 0, used: 0, unused: 0 });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [themeFilter, setThemeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // インポート系 state
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const [importToast, setImportToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importToastTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // デバウンス用 ref
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // プレビューモーダル
  const [preview, setPreview] = useState<SourceArticle | null>(null);

  // ─── データ取得 ─────────────────────────────────────────────────────────

  // NOTE: /api/source-articles/stats エンドポイントは未実装のため、
  // 一覧取得結果から簡易的に統計を算出する。
  // 将来 stats API が実装されたらそちらに切り替える。
  const updateStatsFromArticles = useCallback(
    (allArticles: SourceArticle[], count: number) => {
      // 現在ページの記事から processed 数を取得（概算）
      // 正確な統計は stats API 実装後に対応
      const used = allArticles.filter((a) => a.is_processed).length;
      setStats({ total: count, used, unused: count - used });
    },
    [],
  );

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const offset = (page - 1) * PER_PAGE;
      const params = new URLSearchParams({
        limit: String(PER_PAGE),
        offset: String(offset),
      });
      if (keyword) params.set('keyword', keyword);
      if (themeFilter) params.set('theme_category', themeFilter);

      const res = await fetch(`/api/source-articles?${params}`);
      if (!res.ok) throw new Error('元記事の取得に失敗しました');
      const json: ListResponse = await res.json();

      setArticles(json.data);
      setTotalCount(json.count);
      setTotalPages(Math.max(1, Math.ceil(json.count / PER_PAGE)));
      updateStatsFromArticles(json.data, json.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : '元記事の取得に失敗しました');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, keyword, themeFilter, updateStatsFromArticles]);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  // ─── デバウンス検索 ────────────────────────────────────────────────────

  const handleSearchInputChange = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      setKeyword(value);
    }, 300);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setPage(1);
    setKeyword(searchInput);
  };

  // ─── テーマフィルタ ───────────────────────────────────────────────────

  const handleThemeChange = (value: string) => {
    setThemeFilter(value);
    setPage(1);
  };

  // ─── CSV インポート ────────────────────────────────────────────────────

  const showImportToast = (message: string, type: 'success' | 'error') => {
    if (importToastTimeoutRef.current) clearTimeout(importToastTimeoutRef.current);
    setImportToast({ message, type });
    importToastTimeoutRef.current = setTimeout(() => setImportToast(null), 6000);
  };

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
      const importedCount = result.imported ?? 0;
      const skippedCount = result.skipped ?? 0;
      const progressMsg = `完了: ${importedCount.toLocaleString()} 件インポート、${skippedCount.toLocaleString()} 件スキップ`;
      setImportProgress(progressMsg);

      // トースト通知
      showImportToast(
        `${importedCount.toLocaleString()}件をインポートしました`,
        'success',
      );

      // リフレッシュ
      fetchArticles();
    } catch (err: any) {
      setImportProgress(`エラー: ${err.message}`);
      showImportToast(`インポート失敗: ${err.message}`, 'error');
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

  // 表示範囲計算
  const rangeStart = totalCount === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const rangeEnd = Math.min(page * PER_PAGE, totalCount);

  // ─── 日付フォーマット ──────────────────────────────────────────────────

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // ─── 記事から新規コラム作成 ────────────────────────────────────────────

  const handleCreateFromArticle = (articleId: string) => {
    setPreview(null);
    router.push(`/dashboard/articles/new?source_article_id=${articleId}`);
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
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="rounded-xl bg-white px-3 py-4 shadow-sm sm:p-5">
          <p className="text-xs text-gray-500 sm:text-sm">総記事数</p>
          <p className="mt-1 text-lg font-bold text-gray-900 sm:text-2xl">
            {stats.total.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl bg-white px-3 py-4 shadow-sm sm:p-5">
          <p className="text-xs text-gray-500 sm:text-sm">使用済み</p>
          <p className="mt-1 text-lg font-bold text-brand-600 sm:text-2xl">
            {stats.used.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl bg-white px-3 py-4 shadow-sm sm:p-5">
          <p className="text-xs text-gray-500 sm:text-sm">未使用</p>
          <p className="mt-1 text-lg font-bold text-sage sm:text-2xl">
            {stats.unused.toLocaleString()}
          </p>
        </div>
      </div>

      {/* ツールバー: 検索 + テーマフィルタ + インポート */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <form onSubmit={handleSearch} className="flex w-full gap-2 sm:w-auto">
            <input
              type="text"
              placeholder="キーワードで検索..."
              value={searchInput}
              onChange={(e) => handleSearchInputChange(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-100 sm:w-64 sm:flex-none sm:py-2"
            />
            <button
              type="submit"
              className="shrink-0 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 sm:py-2"
            >
              検索
            </button>
          </form>
          {/* テーマ別フィルタ */}
          <select
            value={themeFilter}
            onChange={(e) => handleThemeChange(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-100 sm:w-auto sm:py-2"
          >
            {THEME_CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3 sm:self-end">
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

      {/* エラー表示 */}
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

      {/* 記事一覧: モバイルはカード、sm以上はテーブル */}
      <div className="overflow-hidden rounded-xl bg-white shadow-sm">
        {/* ローディング / 空状態 */}
        {loading ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-3 border-gray-200 border-t-brand-500" />
            <span className="text-sm text-gray-400">読み込み中...</span>
          </div>
        ) : articles.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className="text-sm text-gray-400">
              {keyword || themeFilter
                ? '検索条件に一致する記事がありません'
                : 'まだ元記事がありません。CSVインポートで始めましょう'}
            </p>
            {!keyword && !themeFilter && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-1 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-600"
              >
                CSV インポート
              </button>
            )}
          </div>
        ) : (
          <>
            {/* モバイルカードビュー */}
            <div className="divide-y divide-gray-100 sm:hidden">
              {articles.map((article) => (
                <button
                  key={article.id}
                  onClick={() => setPreview(article)}
                  className="block w-full px-4 py-4 text-left active:bg-gray-50"
                >
                  <p className="line-clamp-2 text-sm font-medium leading-snug text-gray-900">
                    {article.title}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {article.theme_category && (
                      <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
                        {THEME_CATEGORIES.find((c) => c.value === article.theme_category)?.label ?? article.theme_category}
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        article.is_processed
                          ? 'bg-slate-100 text-slate-600'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {article.is_processed ? '使用済み' : '未使用'}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-400">
                    <span>{formatDate(article.published_at)}</span>
                    <span>{(article.word_count ?? 0).toLocaleString()}文字</span>
                  </div>
                </button>
              ))}
            </div>

            {/* デスクトップテーブルビュー */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-6 py-3 font-medium text-gray-500">タイトル</th>
                    <th className="px-6 py-3 font-medium text-gray-500 whitespace-nowrap">
                      テーマ
                    </th>
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
                  {articles.map((article) => (
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
                      <td className="px-6 py-4 whitespace-nowrap">
                        {article.theme_category ? (
                          <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
                            {THEME_CATEGORIES.find((c) => c.value === article.theme_category)?.label ?? article.theme_category}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">--</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                        {formatDate(article.published_at)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-gray-500">
                        {(article.word_count ?? 0).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            article.is_processed
                              ? 'bg-slate-100 text-slate-600'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {article.is_processed ? '使用済み' : '未使用'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ページネーション */}
        {totalPages >= 1 && !loading && articles.length > 0 && (
          <div className="flex flex-col items-center gap-2 border-t border-gray-100 px-4 py-3 sm:flex-row sm:justify-between sm:px-6">
            <p className="text-xs text-gray-400">
              {totalCount > 0
                ? `${rangeStart.toLocaleString()}-${rangeEnd.toLocaleString()}件 / 全${totalCount.toLocaleString()}件`
                : '0件'}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-lg px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-30 sm:px-2.5 sm:py-1.5"
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
                    className={`min-w-[2.5rem] rounded-lg px-2 py-2 text-sm font-medium transition-colors sm:min-w-[2rem] sm:py-1.5 ${
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
                className="rounded-lg px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-30 sm:px-2.5 sm:py-1.5"
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
            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
              <span>公開日: {formatDate(preview.published_at)}</span>
              <span>文字数: {(preview.word_count ?? 0).toLocaleString()}</span>
              {preview.theme_category && (
                <span className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
                  {THEME_CATEGORIES.find((c) => c.value === preview.theme_category)?.label ?? preview.theme_category}
                </span>
              )}
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  preview.is_processed
                    ? 'bg-slate-100 text-slate-600'
                    : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                {preview.is_processed ? '使用済み' : '未使用'}
              </span>
            </div>

            {/* この記事から新しいコラムを作成 */}
            <div className="flex justify-end">
              <button
                onClick={() => handleCreateFromArticle(preview.id)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 sm:w-auto sm:py-2"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                この記事からコラムを作成
              </button>
            </div>

            <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 max-h-[60vh] overflow-y-auto">
              {preview.content}
            </div>
          </div>
        )}
      </Modal>

      {/* インポート完了トースト */}
      {importToast && (
        <div className="fixed bottom-4 left-4 right-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300 sm:left-auto sm:right-6 sm:bottom-6">
          <div
            className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
              importToast.type === 'success'
                ? 'bg-emerald-600 text-white'
                : 'bg-red-600 text-white'
            }`}
          >
            {importToast.type === 'success' ? (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            )}
            {importToast.message}
            <button onClick={() => setImportToast(null)} className="ml-2 opacity-70 hover:opacity-100">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
