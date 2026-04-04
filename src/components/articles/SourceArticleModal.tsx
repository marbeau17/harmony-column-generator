// ============================================================================
// src/components/articles/SourceArticleModal.tsx
// 元記事選択モーダル — テーマフィルタ・検索・ページネーション・プレビュー
// ============================================================================
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search } from 'lucide-react';
import Modal from '@/components/common/Modal';

// ─── 型定義 ────────────────────────────────────────────────────────────────

interface SourceArticle {
  id: string;
  title: string;
  content: string;
  original_url: string | null;
  published_at: string | null;
  used: boolean;
  created_at: string;
}

interface SourceArticleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (source: { id: string; title: string }) => void;
  currentTheme?: string;
}

// ─── テーマラベル ──────────────────────────────────────────────────────────

const THEME_LABELS: Record<string, string> = {
  soul_mission: '魂と使命',
  relationships: '人間関係',
  grief_care: 'グリーフケア',
  self_growth: '自己成長',
  healing: '癒しと浄化',
  daily: '日常の気づき',
  spiritual: 'スピリチュアル入門',
};

const THEME_KEYWORDS: Record<string, string> = {
  soul_mission: '魂 使命',
  relationships: '人間関係',
  grief_care: 'グリーフ 喪失',
  self_growth: '自己成長',
  healing: '癒し 浄化',
  daily: '日常 気づき',
  spiritual: 'スピリチュアル',
};

const THEME_KEYS = Object.keys(THEME_LABELS);

const PAGE_SIZE = 20;

// ─── コンポーネント ────────────────────────────────────────────────────────

export default function SourceArticleModal({
  isOpen,
  onClose,
  onSelect,
  currentTheme,
}: SourceArticleModalProps) {
  // フィルタ状態
  const [activeTheme, setActiveTheme] = useState<string | null>(
    currentTheme && THEME_KEYS.includes(currentTheme) ? currentTheme : null,
  );
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [unusedOnly, setUnusedOnly] = useState(false);

  // データ
  const [articles, setArticles] = useState<SourceArticle[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [recommended, setRecommended] = useState<SourceArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);

  // 展開中の記事
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // currentTheme が変わったらタブをリセット
  useEffect(() => {
    if (isOpen) {
      setActiveTheme(
        currentTheme && THEME_KEYS.includes(currentTheme) ? currentTheme : null,
      );
      setSearchText('');
      setDebouncedSearch('');
      setOffset(0);
      setExpandedId(null);
    }
  }, [isOpen, currentTheme]);

  // 検索デバウンス
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchText);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  // データ取得
  const fetchArticles = useCallback(async () => {
    if (!isOpen) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);

    try {
      // キーワードの組み立て: テーマキーワード + 検索テキスト
      const parts: string[] = [];
      if (activeTheme && THEME_KEYWORDS[activeTheme]) {
        parts.push(THEME_KEYWORDS[activeTheme]);
      }
      if (debouncedSearch.trim()) {
        parts.push(debouncedSearch.trim());
      }

      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });

      if (parts.length > 0) {
        params.set('keyword', parts.join(' '));
      }

      const res = await fetch(`/api/source-articles?${params.toString()}`, {
        signal: controller.signal,
      });

      if (!res.ok) throw new Error('取得失敗');

      const json = await res.json();
      let data = (json.data ?? []) as SourceArticle[];

      // クライアント側で未使用フィルタ
      if (unusedOnly) {
        // APIで全データを正確にフィルタするのではなく、表示側でフィルタ
        // 件数はサーバー側の件数を使いつつ、表示は未使用のみ
      }

      setArticles(data);
      setTotalCount(json.count ?? 0);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('元記事取得エラー:', err);
      }
    } finally {
      setLoading(false);
    }
  }, [isOpen, activeTheme, debouncedSearch, offset, unusedOnly]);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  // おすすめ記事取得（テーマ変更時）
  useEffect(() => {
    if (!isOpen || !activeTheme) {
      setRecommended([]);
      return;
    }

    const fetchRecommended = async () => {
      try {
        const kw = THEME_KEYWORDS[activeTheme] ?? '';
        const params = new URLSearchParams({
          keyword: kw,
          limit: '10',
          offset: '0',
        });
        const res = await fetch(`/api/source-articles?${params.toString()}`);
        if (!res.ok) return;
        const json = await res.json();
        const data = (json.data ?? []) as SourceArticle[];
        // 未使用の記事からランダムに2件
        const unused = data.filter((a) => !a.used);
        const shuffled = unused.sort(() => Math.random() - 0.5);
        setRecommended(shuffled.slice(0, 2));
      } catch {
        // ignore
      }
    };

    fetchRecommended();
  }, [isOpen, activeTheme]);

  // ── ハンドラ ─────────────────────────────────────────────────────────────

  const handleSelect = (article: SourceArticle) => {
    onSelect({ id: article.id, title: article.title });
    onClose();
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  const goToPage = (page: number) => {
    setOffset((page - 1) * PAGE_SIZE);
    setExpandedId(null);
  };

  // 表示用フィルタ（未使用のみ）
  const displayArticles = unusedOnly
    ? articles.filter((a) => !a.used)
    : articles;

  // ── 日付フォーマット ──────────────────────────────────────────────────────

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch {
      return '-';
    }
  };

  const charCount = (content: string) => {
    return content.length.toLocaleString();
  };

  const preview = (content: string) => {
    const clean = content.replace(/\n+/g, ' ').trim();
    return clean.length > 200 ? clean.slice(0, 200) + '...' : clean;
  };

  // ── レンダリング ──────────────────────────────────────────────────────────

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="元記事を選択" maxWidth="4xl">
      <div className="space-y-4">
        {/* テーマフィルタタブ */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveTheme(null);
              setOffset(0);
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              activeTheme === null
                ? 'bg-brand-500 text-white'
                : 'bg-brand-100 text-brand-600 hover:bg-brand-200'
            }`}
          >
            すべて
          </button>
          {THEME_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setActiveTheme(key);
                setOffset(0);
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                activeTheme === key
                  ? 'bg-brand-500 text-white'
                  : 'bg-brand-100 text-brand-600 hover:bg-brand-200'
              }`}
            >
              {THEME_LABELS[key]}
            </button>
          ))}
        </div>

        {/* 検索バー + フィルタ */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-400" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="タイトル・本文で検索..."
              className="w-full rounded-lg border border-brand-200 bg-white py-2 pl-10 pr-4
                text-sm transition focus:border-brand-500 focus:outline-none
                focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setUnusedOnly(false);
                setOffset(0);
              }}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                !unusedOnly
                  ? 'bg-brand-500 text-white'
                  : 'bg-brand-100 text-brand-600 hover:bg-brand-200'
              }`}
            >
              すべて
            </button>
            <button
              type="button"
              onClick={() => {
                setUnusedOnly(true);
                setOffset(0);
              }}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                unusedOnly
                  ? 'bg-brand-500 text-white'
                  : 'bg-brand-100 text-brand-600 hover:bg-brand-200'
              }`}
            >
              未使用のみ
            </button>
          </div>
        </div>

        {/* おすすめ記事 */}
        {recommended.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-brand-500">
              おすすめの未使用記事
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {recommended.map((article) => (
                <button
                  key={article.id}
                  type="button"
                  onClick={() => handleSelect(article)}
                  className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-left
                    transition hover:border-brand-400 hover:shadow-sm"
                >
                  <p className="text-sm font-medium text-brand-700 line-clamp-2">
                    {article.title}
                  </p>
                  <p className="mt-1 text-xs text-brand-400">
                    {formatDate(article.published_at)} / {charCount(article.content)}文字
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 記事リスト */}
        <div className="min-h-[200px]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-300 border-t-brand-600" />
              <span className="ml-2 text-sm text-brand-500">読み込み中...</span>
            </div>
          ) : displayArticles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-brand-400">
              <p className="text-sm">該当する記事が見つかりません</p>
            </div>
          ) : (
            <div className="divide-y divide-brand-100 rounded-lg border border-brand-200">
              {displayArticles.map((article) => (
                <div
                  key={article.id}
                  className={`transition ${article.used ? 'opacity-60' : ''}`}
                >
                  {/* 記事行 */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(article.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-brand-50"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-brand-700 truncate">
                        {article.title}
                      </p>
                      <div className="mt-0.5 flex items-center gap-3 text-xs text-brand-400">
                        <span>{formatDate(article.published_at)}</span>
                        <span>{charCount(article.content)}文字</span>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        article.used
                          ? 'bg-gray-200 text-gray-500'
                          : 'bg-green-100 text-green-700'
                      }`}
                    >
                      {article.used ? '使用済み' : '未使用'}
                    </span>
                    <svg
                      className={`h-4 w-4 shrink-0 text-brand-400 transition-transform ${
                        expandedId === article.id ? 'rotate-180' : ''
                      }`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>

                  {/* 展開プレビュー */}
                  {expandedId === article.id && (
                    <div className="border-t border-brand-100 bg-brand-50/50 px-4 py-3">
                      <p className="text-xs leading-relaxed text-brand-600">
                        {preview(article.content)}
                      </p>
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => handleSelect(article)}
                          className="rounded-lg bg-brand-500 px-4 py-1.5 text-xs font-medium
                            text-white transition hover:bg-brand-600"
                        >
                          この記事を使う
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ページネーション */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-brand-400">
              {totalCount.toLocaleString()}件中{' '}
              {offset + 1}-{Math.min(offset + PAGE_SIZE, totalCount)}件
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => goToPage(currentPage - 1)}
                className="rounded-lg px-2 py-1 text-xs text-brand-600 transition
                  hover:bg-brand-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                前へ
              </button>
              {/* ページ番号（最大5つ表示） */}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let page: number;
                if (totalPages <= 5) {
                  page = i + 1;
                } else if (currentPage <= 3) {
                  page = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  page = totalPages - 4 + i;
                } else {
                  page = currentPage - 2 + i;
                }
                return (
                  <button
                    key={page}
                    type="button"
                    onClick={() => goToPage(page)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      page === currentPage
                        ? 'bg-brand-500 text-white'
                        : 'text-brand-600 hover:bg-brand-100'
                    }`}
                  >
                    {page}
                  </button>
                );
              })}
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => goToPage(currentPage + 1)}
                className="rounded-lg px-2 py-1 text-xs text-brand-600 transition
                  hover:bg-brand-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                次へ
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
