// ============================================================================
// src/components/articles/SourceArticlePicker.tsx
// 元記事ピッカー — カード型選択UI + モーダル + フォールバック検索
// ============================================================================
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import SourceArticleModal from './SourceArticleModal';

// ─── 型定義 ────────────────────────────────────────────────────────────────

interface SelectedSource {
  id: string;
  title: string;
}

interface SourceArticlePickerProps {
  selectedSource: SelectedSource | null;
  onSelect: (source: SelectedSource) => void;
  onClear: () => void;
  currentTheme?: string;
}

// ─── フォールバック検索用の型 ──────────────────────────────────────────────

interface SourceSearchResult {
  id: string;
  title: string;
}

// ─── コンポーネント ────────────────────────────────────────────────────────

export default function SourceArticlePicker({
  selectedSource,
  onSelect,
  onClear,
  currentTheme,
}: SourceArticlePickerProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // フォールバック検索
  const [fallbackQuery, setFallbackQuery] = useState('');
  const [fallbackResults, setFallbackResults] = useState<SourceSearchResult[]>([]);
  const [fallbackSearching, setFallbackSearching] = useState(false);
  const [showFallbackDropdown, setShowFallbackDropdown] = useState(false);

  // フォールバック検索のデバウンス
  const searchFallback = useCallback(async (query: string) => {
    if (query.length < 2) {
      setFallbackResults([]);
      setShowFallbackDropdown(false);
      return;
    }

    setFallbackSearching(true);
    try {
      const params = new URLSearchParams({ keyword: query, limit: '8' });
      const res = await fetch(`/api/source-articles?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        const results = (json.data ?? []).map((a: { id: string; title: string }) => ({
          id: a.id,
          title: a.title,
        }));
        setFallbackResults(results);
        setShowFallbackDropdown(true);
      }
    } catch {
      // ignore
    } finally {
      setFallbackSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      searchFallback(fallbackQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [fallbackQuery, searchFallback]);

  const handleFallbackSelect = (source: SourceSearchResult) => {
    onSelect(source);
    setFallbackQuery('');
    setShowFallbackDropdown(false);
  };

  const handleModalSelect = (source: SelectedSource) => {
    onSelect(source);
  };

  // ── レンダリング ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {selectedSource ? (
        /* ── 選択済み表示 ──────────────────────────────────────────── */
        <div className="flex items-center gap-3 rounded-xl border border-brand-300 bg-brand-50 px-4 py-3 shadow-sm">
          <span className="text-lg">📖</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-brand-500">選択中の元記事</p>
            <p className="text-sm font-medium text-brand-700 truncate">
              {selectedSource.title}
            </p>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-brand-200
              bg-white px-3 py-1.5 text-xs font-medium text-brand-600 transition
              hover:bg-red-50 hover:border-red-200 hover:text-red-600"
          >
            <X className="h-3 w-3" />
            解除
          </button>
        </div>
      ) : (
        /* ── 未選択時のカード型ボタン ──────────────────────────────── */
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="group flex w-full items-center gap-4 rounded-xl border border-dashed
            border-brand-300 bg-white px-4 py-4 text-left transition
            hover:border-brand-500 hover:bg-brand-50 hover:shadow-sm"
        >
          <span className="text-2xl">📖</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-brand-700 group-hover:text-brand-800">
              元記事を選択する
            </p>
            <p className="text-xs text-brand-400">
              アメブロ記事から選べます
            </p>
          </div>
          <span
            className="shrink-0 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium
              text-white transition group-hover:bg-brand-600"
          >
            選択...
          </span>
        </button>
      )}

      {/* フォールバック: テキスト検索 */}
      {!selectedSource && (
        <div>
          <p className="mb-1 text-xs text-brand-400">またはテキスト検索:</p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-400" />
            <input
              type="text"
              value={fallbackQuery}
              onChange={(e) => setFallbackQuery(e.target.value)}
              onFocus={() => {
                if (fallbackResults.length > 0) setShowFallbackDropdown(true);
              }}
              onBlur={() => {
                setTimeout(() => setShowFallbackDropdown(false), 200);
              }}
              placeholder="元記事をタイトルで検索..."
              className="w-full rounded-lg border border-brand-200 bg-white py-2 pl-10 pr-4
                text-sm transition focus:border-brand-500 focus:outline-none
                focus:ring-2 focus:ring-brand-500/20"
            />

            {/* ドロップダウン */}
            {showFallbackDropdown && fallbackResults.length > 0 && (
              <ul
                className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg
                  border border-brand-200 bg-white shadow-lg"
              >
                {fallbackResults.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onMouseDown={() => handleFallbackSelect(s)}
                      className="block w-full px-4 py-2 text-left text-sm text-brand-700
                        transition hover:bg-brand-50"
                    >
                      {s.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {showFallbackDropdown &&
              fallbackQuery.length >= 2 &&
              fallbackResults.length === 0 &&
              !fallbackSearching && (
                <div
                  className="absolute z-20 mt-1 w-full rounded-lg border border-brand-200
                    bg-white px-4 py-3 text-sm text-brand-400 shadow-lg"
                >
                  該当する元記事が見つかりません
                </div>
              )}
          </div>
        </div>
      )}

      {/* モーダル */}
      <SourceArticleModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSelect={handleModalSelect}
        currentTheme={currentTheme}
      />
    </div>
  );
}
