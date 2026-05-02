import { createServerClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';
import { createClient as createPureSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Componentからの呼び出し時は set が使えないため無視
          }
        },
      },
    }
  );
}

// Service Role用（管理操作用）
//
// バグL (2026-05-02): @supabase/ssr の createServerClient で SERVICE_ROLE_KEY を
// 渡しても cookies に anon JWT が含まれる Vercel function 環境では anon role 扱い
// になり、RLS 有効テーブル (generation_jobs 等) への INSERT が拒否されていた。
// → @supabase/supabase-js 純正 createClient に切替。これは cookie を一切見ない
// pure service role キーベースの client で、RLS バイパスが確実に効く。
//
// バグF (2026-05-02): cookies() は Next.js の request context 外で例外を投げる
// 問題は、純正クライアントを使うことで自動的に解決 (cookies に依存しない)。
// route handler / server component / CLI / cron worker 全 context で動作。
export async function createServiceRoleClient() {
  return createPureSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
