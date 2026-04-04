// ============================================================================
// src/components/layout/Header.tsx
// ダッシュボード ヘッダー — ページタイトル + ユーザーメニュー
// ============================================================================
'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, User, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

// ─── pathname → タイトル マッピング ─────────────────────────────────────────

const TITLES: Record<string, string> = {
  '/dashboard':                 'ダッシュボード',
  '/dashboard/planner':         'AIプランナー',
  '/dashboard/articles/new':    '記事作成',
  '/dashboard/articles':        '記事一覧',
  '/dashboard/source-articles': '元記事管理',
  '/dashboard/settings':        '設定',
};

function resolveTitle(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  // 記事個別ページの判定
  if (/^\/dashboard\/articles\/[^/]+\/edit$/.test(pathname)) return '記事編集';
  if (/^\/dashboard\/articles\/[^/]+\/outline$/.test(pathname)) return '構成案レビュー';
  if (/^\/dashboard\/articles\/[^/]+\/review$/.test(pathname)) return '本文レビュー';
  if (/^\/dashboard\/articles\/[^/]+$/.test(pathname)) return '記事詳細';
  const match = Object.entries(TITLES)
    .filter(([key]) => key !== '/dashboard' && pathname.startsWith(key))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return match?.[1] ?? 'ダッシュボード';
}

// ─── パンくずリスト生成 ─────────────────────────────────────────────────────

interface Breadcrumb {
  label: string;
  href?: string;
}

function buildBreadcrumbs(pathname: string): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [{ label: 'ダッシュボード', href: '/dashboard' }];

  if (pathname === '/dashboard') return crumbs;

  if (pathname.startsWith('/dashboard/planner')) {
    crumbs.push({ label: 'AIプランナー' });
    return crumbs;
  }

  if (pathname.startsWith('/dashboard/source-articles')) {
    crumbs.push({ label: '元記事管理' });
    return crumbs;
  }

  if (pathname.startsWith('/dashboard/settings')) {
    crumbs.push({ label: '設定' });
    return crumbs;
  }

  if (pathname.startsWith('/dashboard/articles')) {
    if (pathname === '/dashboard/articles') {
      crumbs.push({ label: '記事一覧' });
    } else if (pathname === '/dashboard/articles/new') {
      crumbs.push({ label: '記事一覧', href: '/dashboard/articles' });
      crumbs.push({ label: '記事作成' });
    } else {
      crumbs.push({ label: '記事一覧', href: '/dashboard/articles' });
      const title = resolveTitle(pathname);
      crumbs.push({ label: title });
    }
    return crumbs;
  }

  return crumbs;
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
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch (e) {
      console.error('サインアウトに失敗しました', e);
    } finally {
      router.push('/login');
    }
  };

  const title = resolveTitle(pathname);
  const breadcrumbs = buildBreadcrumbs(pathname);

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between h-14 px-6 bg-white border-b border-slate-200">
      {/* Breadcrumb + Page title */}
      <div className="min-w-0 flex-1">
        {breadcrumbs.length > 1 && (
          <nav aria-label="パンくずリスト" className="flex items-center gap-1 text-xs text-slate-400 mb-0.5">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="w-3 h-3" />}
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-slate-600 transition-colors">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-slate-500 font-medium">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-base font-semibold text-slate-800 truncate leading-tight">
          {title}
        </h1>
      </div>

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
