// ============================================================================
// src/app/(dashboard)/layout.tsx
// ダッシュボード用レイアウト — セッション確認 + DashboardShell
// ============================================================================
import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import DashboardShell from '@/components/layout/DashboardShell';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createServerSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect('/login');
  }

  return (
    <DashboardShell
      userName={session.user.user_metadata?.name ?? session.user.email ?? 'User'}
    >
      {children}
    </DashboardShell>
  );
}
