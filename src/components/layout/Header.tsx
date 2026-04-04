// ============================================================================
// src/components/layout/Header.tsx
// ダッシュボード ヘッダー — ページタイトル + ユーザーメニュー
// ============================================================================
'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, User } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

// ─── pathname → タイトル マッピング ─────────────────────────────────────────

const TITLES: Record<string, string> = {
  '/dashboard':              'ダッシュボード',
  '/dashboard/articles/new': '記事作成',
  '/dashboard/articles':     '記事一覧',
  '/dashboard/source-articles': '元記事管理',
  '/dashboard/settings':     '設定',
};

function resolveTitle(pathname: string): string {
  // 完全一致を優先、次にプレフィックス一致
  if (TITLES[pathname]) return TITLES[pathname];
  const match = Object.entries(TITLES)
    .filter(([key]) => key !== '/dashboard' && pathname.startsWith(key))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return match?.[1] ?? 'ダッシュボード';
}

// ─── Header ─────────────────────────────────────────────────────────────────

interface HeaderProps {
  userName: string;
}

export default function Header({ userName }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 外側クリックでメニューを閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  const title = resolveTitle(pathname);

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between h-14 px-6 bg-white border-b border-slate-200">
      {/* Page title */}
      <h1 className="text-base font-semibold text-slate-800 truncate">
        {title}
      </h1>

      {/* User menu */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 transition-colors"
        >
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-gold to-sage grid place-items-center text-white text-xs font-semibold">
            {userName[0]?.toUpperCase() ?? 'U'}
          </div>
          <span className="text-sm text-slate-700 font-medium hidden sm:inline">
            {userName}
          </span>
          <svg
            className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50">
            <div className="px-4 py-2 border-b border-slate-100">
              <p className="text-sm font-medium text-slate-800 truncate">{userName}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              サインアウト
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
