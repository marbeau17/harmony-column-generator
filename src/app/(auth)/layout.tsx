export const dynamic = 'force-dynamic';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-50 px-4 py-8">
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}
