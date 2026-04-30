// ============================================================================
// src/app/(dashboard)/dashboard/articles/new-from-scratch/loading.tsx
// ローディング・スケルトン UI（dark: 対応）
// ============================================================================
export default function Loading() {
  const pulse = 'animate-pulse rounded-md bg-gray-200 dark:bg-gray-800';
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* ヘッダー */}
      <div className="mb-6 space-y-2">
        <div className={`h-7 w-64 ${pulse}`} />
        <div className={`h-4 w-96 max-w-full ${pulse}`} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* 左フォーム 60% */}
        <div className="space-y-4 lg:col-span-3">
          <div
            className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm
              dark:border-gray-700 dark:bg-gray-900"
          >
            <div className="space-y-5">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className={`h-4 w-32 ${pulse}`} />
                  <div className={`h-10 w-full ${pulse}`} />
                </div>
              ))}
              <div className={`h-12 w-full ${pulse}`} />
            </div>
          </div>
        </div>

        {/* 右プレビュー 40% */}
        <div className="space-y-4 lg:col-span-2">
          <div
            className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm
              dark:border-gray-700 dark:bg-gray-900"
          >
            <div className={`mb-4 h-5 w-40 ${pulse}`} />
            <div className="space-y-2">
              <div className={`h-4 w-full ${pulse}`} />
              <div className={`h-4 w-5/6 ${pulse}`} />
              <div className={`h-4 w-3/4 ${pulse}`} />
              <div className={`h-4 w-2/3 ${pulse}`} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
