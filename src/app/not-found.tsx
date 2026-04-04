import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-brand-50">
      <h1 className="text-6xl font-bold text-brand-700">404</h1>
      <p className="mt-4 text-lg text-brand-600">ページが見つかりません</p>
      <Link
        href="/dashboard"
        className="mt-8 rounded-lg bg-brand-500 px-6 py-2.5 text-sm font-medium
          text-white transition hover:bg-brand-600"
      >
        ダッシュボードへ戻る
      </Link>
    </div>
  )
}
