import { createServerClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';
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
// バグF (2026-05-02): cookies() は Next.js の request context 外（CLI / cron worker /
// background fetch）で必ず例外を投げる。Service role はそもそも auth セッションを
// 必要としないので、request 外で呼ばれた場合は cookies を空配列で fallback して
// 同じ client を返す。これで route handler / server component / CLI 全 context で
// 同一関数を使い回せる。
export async function createServiceRoleClient() {
  let cookieStore: Awaited<ReturnType<typeof cookies>> | null = null;
  try {
    cookieStore = await cookies();
  } catch {
    // CLI / non-request context — service role なので cookies は不要
    cookieStore = null;
  }
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore ? cookieStore.getAll() : [];
        },
        setAll() {
          // Service Role では cookie 書き込み不要 + CLI では cookieStore が null
        },
      },
    }
  );
}
