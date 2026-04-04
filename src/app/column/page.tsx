// ============================================================================
// src/app/column/page.tsx
// 公開コラム一覧ページ（サーバーコンポーネント）
// ============================================================================

import type { Metadata } from 'next';
import Link from 'next/link';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { Article, ThemeCategory } from '@/types/article';

// ─── 定数 ───────────────────────────────────────────────────────────────────

const SITE_URL = 'https://harmony-mc.com';
const PER_PAGE = 12;

const THEME_TABS: { value: ThemeCategory | 'all'; label: string }[] = [
  { value: 'all',              label: '全て' },
  { value: 'soul_mission',     label: '魂と使命' },
  { value: 'relationships',    label: '人間関係' },
  { value: 'grief_care',       label: 'グリーフケア' },
  { value: 'self_growth',      label: '自己成長' },
  { value: 'healing',          label: '癒しと浄化' },
  { value: 'daily_awareness',  label: '日常の気づき' },
  { value: 'spiritual_intro',  label: 'スピリチュアル入門' },
];

// ─── メタデータ ─────────────────────────────────────────────────────────────

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'スピリチュアルコラム | Harmony',
    description:
      'スピリチュアルカウンセラー小林由起子が贈る、魂の成長と癒しのコラム集。霊視・前世リーディング・チャクラなど、スピリチュアルな視点から人生をサポートする記事をお届けします。',
    openGraph: {
      title: 'スピリチュアルコラム | Harmony',
      description:
        'スピリチュアルカウンセラー小林由起子が贈る、魂の成長と癒しのコラム集。',
      url: `${SITE_URL}/column`,
      type: 'website',
      siteName: 'Harmony スピリチュアルコラム',
      locale: 'ja_JP',
    },
    alternates: {
      canonical: `${SITE_URL}/column`,
    },
  };
}

// ─── データ取得 ─────────────────────────────────────────────────────────────

type ArticleSummary = Pick<
  Article,
  'id' | 'title' | 'slug' | 'keyword' | 'theme' | 'meta_description' | 'image_files' | 'published_at'
>;

async function getPublishedArticles(
  page: number,
  theme: ThemeCategory | 'all',
): Promise<{ articles: ArticleSummary[]; total: number }> {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return { articles: [], total: 0 };
  }

  try {
    const supabase = await createServiceRoleClient();
    const from = (page - 1) * PER_PAGE;
    const to = from + PER_PAGE - 1;

    let query = supabase
      .from('articles')
      .select(
        'id, title, slug, keyword, theme, meta_description, image_files, published_at',
        { count: 'exact' },
      )
      .eq('status', 'published')
      .order('published_at', { ascending: false });

    if (theme !== 'all') {
      query = query.eq('theme', theme);
    }

    const { data, count, error } = await query.range(from, to);

    if (error) {
      console.error('Failed to fetch articles:', error.message);
      return { articles: [], total: 0 };
    }

    return {
      articles: (data ?? []) as ArticleSummary[],
      total: count ?? 0,
    };
  } catch {
    return { articles: [], total: 0 };
  }
}

// ─── ヘルパー ───────────────────────────────────────────────────────────────

function getThumbnailUrl(article: ArticleSummary): string | null {
  if (!article.image_files) return null;
  try {
    const files = Array.isArray(article.image_files)
      ? article.image_files
      : JSON.parse(String(article.image_files));
    if (Array.isArray(files) && files.length > 0) {
      const first = files[0] as Record<string, string>;
      return first.url ?? first.src ?? null;
    }
  } catch {
    // ignore
  }
  return null;
}

function getExcerpt(text: string | null, maxLen = 80): string {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

function getThemeLabel(themeValue: string): string {
  const tab = THEME_TABS.find((t) => t.value === themeValue);
  return tab?.label ?? themeValue;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ─── ページコンポーネント ───────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<{ page?: string; theme?: string }>;
}

export default async function ColumnListPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const currentPage = Math.max(1, Number(params.page) || 1);
  const currentTheme = (params.theme ?? 'all') as ThemeCategory | 'all';

  const { articles, total } = await getPublishedArticles(
    currentPage,
    currentTheme,
  );

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      {/* ヘッダー */}
      <header className="border-b border-[#b39578]/20 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
          <nav className="mb-4 text-sm text-[#b39578]" aria-label="パンくずリスト">
            <ol className="flex items-center gap-1">
              <li>
                <a href={SITE_URL} className="hover:underline">
                  ホーム
                </a>
              </li>
              <li aria-hidden="true">/</li>
              <li className="text-[#53352b]" aria-current="page">
                コラム
              </li>
            </ol>
          </nav>
          <h1 className="text-2xl font-bold text-[#53352b] sm:text-3xl">
            スピリチュアルコラム
          </h1>
          <p className="mt-2 text-sm text-[#b39578]">
            魂の成長と癒しのための、スピリチュアルな視点からのコラム集
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* テーマフィルタタブ */}
        <div className="mb-8 flex flex-wrap gap-2">
          {THEME_TABS.map((tab) => {
            const isActive = currentTheme === tab.value;
            const href =
              tab.value === 'all'
                ? '/column'
                : `/column?theme=${tab.value}`;

            return (
              <Link
                key={tab.value}
                href={href}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'bg-[#53352b] text-white shadow-sm'
                    : 'bg-white text-[#53352b] border border-[#b39578]/30 hover:bg-[#b39578]/10'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>

        {/* 記事一覧 */}
        {articles.length === 0 ? (
          <div className="py-20 text-center">
            <p className="mb-2 text-4xl">&#x1F4DD;</p>
            <p className="text-lg text-[#b39578]">
              {currentTheme !== 'all'
                ? `「${getThemeLabel(currentTheme)}」のコラムはまだありません。`
                : 'まだ公開されたコラムがありません。'}
            </p>
            {currentTheme !== 'all' && (
              <Link
                href="/column"
                className="mt-4 inline-block rounded-full border border-[#b39578]/30 px-5 py-2 text-sm text-[#53352b] hover:bg-[#b39578]/10 transition"
              >
                全てのコラムを見る
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {articles.map((article) => {
                const thumbnail = getThumbnailUrl(article);
                const slug = article.slug ?? article.id;

                return (
                  <Link
                    key={article.id}
                    href={`/column/${slug}`}
                    className="group block overflow-hidden rounded-xl border border-[#b39578]/20 bg-white shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-1"
                  >
                    {/* サムネイル */}
                    <div className="relative aspect-[16/9] w-full overflow-hidden">
                      {thumbnail ? (
                        <img
                          src={thumbnail}
                          alt={article.title ?? ''}
                          className="h-full w-full object-cover transition group-hover:scale-105"
                          loading="lazy"
                        />
                      ) : (
                        <div
                          className="flex h-full w-full items-center justify-center"
                          style={{
                            background:
                              'linear-gradient(135deg, #b39578 0%, #53352b 100%)',
                          }}
                        >
                          <span className="text-3xl text-white/60">&#x2728;</span>
                        </div>
                      )}
                    </div>

                    {/* カード本文 */}
                    <div className="p-4">
                      {/* カテゴリバッジ */}
                      <span className="mb-2 inline-block rounded-full bg-[#b39578]/15 px-2.5 py-0.5 text-xs font-medium text-[#53352b]">
                        {getThemeLabel(article.theme)}
                      </span>

                      {/* タイトル（2行clamp） */}
                      <h2
                        className="mb-2 text-base font-bold leading-snug text-[#53352b] group-hover:text-[#b39578] transition"
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {article.title}
                      </h2>

                      {/* 抜粋 */}
                      <p className="mb-3 text-sm leading-relaxed text-[#b39578]">
                        {getExcerpt(article.meta_description)}
                      </p>

                      {/* 公開日 */}
                      {article.published_at && (
                        <time
                          dateTime={article.published_at}
                          className="text-xs text-[#b39578]/70"
                        >
                          {formatDate(article.published_at)}
                        </time>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* ページネーション */}
            {totalPages > 1 && (
              <nav className="mt-12 flex items-center justify-center gap-2" aria-label="ページナビゲーション">
                {/* 前ページ */}
                {currentPage > 1 && (
                  <Link
                    href={`/column?page=${currentPage - 1}${currentTheme !== 'all' ? `&theme=${currentTheme}` : ''}`}
                    className="rounded-lg border border-[#b39578]/30 px-4 py-2 text-sm text-[#53352b] hover:bg-[#b39578]/10 transition"
                  >
                    前へ
                  </Link>
                )}

                {/* ページ番号（省略表示対応） */}
                {(() => {
                  const pages: (number | '...')[] = [];
                  if (totalPages <= 7) {
                    for (let i = 1; i <= totalPages; i++) pages.push(i);
                  } else {
                    pages.push(1);
                    if (currentPage > 3) pages.push('...');
                    for (
                      let i = Math.max(2, currentPage - 1);
                      i <= Math.min(totalPages - 1, currentPage + 1);
                      i++
                    ) {
                      pages.push(i);
                    }
                    if (currentPage < totalPages - 2) pages.push('...');
                    pages.push(totalPages);
                  }
                  return pages.map((pageNum, idx) =>
                    pageNum === '...' ? (
                      <span
                        key={`ellipsis-${idx}`}
                        className="px-2 py-2 text-sm text-[#b39578]"
                      >
                        ...
                      </span>
                    ) : (
                      <Link
                        key={pageNum}
                        href={`/column?page=${pageNum}${currentTheme !== 'all' ? `&theme=${currentTheme}` : ''}`}
                        className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                          pageNum === currentPage
                            ? 'bg-[#53352b] text-white'
                            : 'border border-[#b39578]/30 text-[#53352b] hover:bg-[#b39578]/10'
                        }`}
                        aria-current={pageNum === currentPage ? 'page' : undefined}
                      >
                        {pageNum}
                      </Link>
                    ),
                  );
                })()}

                {/* 次ページ */}
                {currentPage < totalPages && (
                  <Link
                    href={`/column?page=${currentPage + 1}${currentTheme !== 'all' ? `&theme=${currentTheme}` : ''}`}
                    className="rounded-lg border border-[#b39578]/30 px-4 py-2 text-sm text-[#53352b] hover:bg-[#b39578]/10 transition"
                  >
                    次へ
                  </Link>
                )}
              </nav>
            )}
          </>
        )}
      </main>

      {/* フッター */}
      <footer className="site-copyright">
        Copyright &copy; スピリチュアルハーモニー All Rights Reserved.
      </footer>
    </div>
  );
}
