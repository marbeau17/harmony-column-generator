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
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <DashboardShell
      userName={user.user_metadata?.name ?? user.email ?? 'User'}
    >
      {children}
    </DashboardShell>
  );
}
