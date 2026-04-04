import Link from 'next/link';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import StatCard from '@/components/common/StatCard';
import StatusBadge from '@/components/common/StatusBadge';

// --- アイコン SVG コンポーネント ---

function IconGlobe() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5a17.92 17.92 0 0 1-8.716-2.247m0 0A8.966 8.966 0 0 1 3 12c0-1.264.26-2.466.73-3.558" />
    </svg>
  );
}

function IconPencil() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931ZM16.862 4.487 19.5 7.125" />
    </svg>
  );
}

function IconDocument() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

function IconSparkles() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
    </svg>
  );
}

// --- ダッシュボードページ ---

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();

  // 並列でデータ取得
  const [
    publishedResult,
    draftResult,
    sourceCountResult,
    generatedResult,
    recentArticlesResult,
    queuePendingResult,
  ] = await Promise.all([
    // 公開記事数
    supabase
      .from('articles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published'),
    // 下書き数
    supabase
      .from('articles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'draft'),
    // 元記事数
    supabase
      .from('source_articles')
      .select('id', { count: 'exact', head: true }),
    // 生成済み数 (body_review, editing, published)
    supabase
      .from('articles')
      .select('id', { count: 'exact', head: true })
      .in('status', ['body_review', 'editing', 'published']),
    // 最近の記事5件
    supabase
      .from('articles')
      .select('id, title, status, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(5),
    // キュー処理中の件数
    supabase
      .from('generation_queue')
      .select('id', { count: 'exact', head: true })
      .not('step', 'in', '("completed","failed")'),
  ]);

  const publishedCount = publishedResult.count ?? 0;
  const draftCount = draftResult.count ?? 0;
  const sourceCount = sourceCountResult.count ?? 0;
  const generatedCount = generatedResult.count ?? 0;
  const recentArticles = recentArticlesResult.data ?? [];
  const queuePendingCount = queuePendingResult.count ?? 0;

  return (
    <div className="space-y-8">
      {/* ページタイトル */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ダッシュボード</h1>
        <p className="mt-1 text-sm text-gray-500">
          Harmony Column Generator の概要
        </p>
      </div>

      {/* キュー処理中インジケーター */}
      {queuePendingCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
          </span>
          <p className="text-sm text-amber-800">
            <span className="font-medium">{queuePendingCount}件</span>の記事がキュー処理中です
          </p>
          <Link
            href="/dashboard/planner"
            className="ml-auto text-sm font-medium text-amber-700 hover:text-amber-900"
          >
            確認する &rarr;
          </Link>
        </div>
      )}

      {/* StatCard 4つ横並び */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="公開記事数"
          value={publishedCount}
          icon={<IconGlobe />}
          href="/dashboard/articles?status=published"
        />
        <StatCard
          title="下書き数"
          value={draftCount}
          icon={<IconPencil />}
          href="/dashboard/articles?status=draft"
        />
        <StatCard
          title="元記事数"
          value={sourceCount.toLocaleString()}
          icon={<IconDocument />}
          href="/dashboard/source-articles"
        />
        <StatCard
          title="生成済み数"
          value={generatedCount}
          icon={<IconSparkles />}
          href="/dashboard/articles"
        />
      </div>

      {/* 最近の記事一覧 */}
      <div className="rounded-xl bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">最近の記事</h2>
          <Link
            href="/dashboard/articles"
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            すべて表示 &rarr;
          </Link>
        </div>

        {recentArticles.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
            <p className="mt-3 text-sm text-gray-400">まだ記事がありません</p>
            <Link
              href="/dashboard/planner"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600"
            >
              AIプランナーで始めましょう
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {recentArticles.map((article: any) => (
              <li key={article.id}>
                <Link
                  href={`/dashboard/articles/${article.id}`}
                  className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {article.title || '(タイトル未設定)'}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {article.updated_at
                        ? new Date(article.updated_at).toLocaleDateString('ja-JP', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })
                        : '—'}
                    </p>
                  </div>
                  <div className="ml-4 flex-shrink-0">
                    <StatusBadge status={article.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* CTA バナー */}
      <Link
        href="/dashboard/articles/new"
        className="block rounded-xl bg-brand-500 px-6 py-6 text-center shadow-sm transition-colors hover:bg-brand-600"
      >
        <p className="text-lg font-bold text-white">
          新しいコラムを作成
        </p>
        <p className="mt-1 text-sm text-white/80">
          元記事から AI でスピリチュアルコラムを自動生成します
        </p>
      </Link>
    </div>
  );
}
