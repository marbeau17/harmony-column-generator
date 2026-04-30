// ============================================================================
// src/components/layout/Sidebar.tsx
// ダッシュボード サイドバー — スピリチュアルブランドカラー（モバイル対応）
// ============================================================================
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Sparkles,
  FileText,
  BookOpen,
  Lightbulb,
  Settings,
  Activity,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from 'lucide-react';

// ─── Navigation items ───────────────────────────────────────────────────────

const NAV = [
  { label: 'ダッシュボード', href: '/dashboard',                 icon: LayoutDashboard, badgeKey: null },
  { label: 'AIプランナー',   href: '/dashboard/planner',         icon: Lightbulb,       badgeKey: 'queue' as const },
  { label: '記事作成',       href: '/dashboard/articles/new',    icon: Sparkles,        badgeKey: null },
  { label: 'AI ゼロ生成',    href: '/dashboard/articles/new-from-scratch', icon: Sparkles, badgeKey: null },
  { label: '記事一覧',       href: '/dashboard/articles',        icon: FileText,        badgeKey: null },
  { label: '元記事管理',     href: '/dashboard/source-articles', icon: BookOpen,        badgeKey: null },
  { label: 'イベント監視',   href: '/dashboard/publish-events',  icon: Activity,        badgeKey: null },
  { label: '設定',           href: '/dashboard/settings',        icon: Settings,        badgeKey: null },
] as const;

// ─── Sidebar ────────────────────────────────────────────────────────────────

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const [queueCount, setQueueCount] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);

  // キュー件数を取得（処理待ち）
  useEffect(() => {
    let cancelled = false;
    async function fetchQueueCount() {
      try {
        const res = await fetch('/api/queue?step=pending&limit=1');
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) setQueueCount(json.meta?.total ?? 0);
        }
      } catch {
        // サイレント: サイドバーのバッジ取得失敗は無視
      }
    }
    fetchQueueCount();
    // 60秒ごとにポーリング
    const interval = setInterval(fetchQueueCount, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // ページ遷移時にモバイルサイドバーを閉じる
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // モバイルオープン時にbodyスクロールを無効化
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === href;
    // /dashboard/articles/new と /dashboard/articles/new-from-scratch は
    // /dashboard/articles より先に厳密一致でチェックする
    if (href === '/dashboard/articles/new') return pathname === href;
    if (href === '/dashboard/articles/new-from-scratch') {
      return pathname === href || pathname.startsWith(`${href}/`);
    }
    if (href === '/dashboard/articles') {
      // 記事一覧は new / new-from-scratch を含めない
      if (pathname === '/dashboard/articles/new') return false;
      if (
        pathname === '/dashboard/articles/new-from-scratch' ||
        pathname.startsWith('/dashboard/articles/new-from-scratch/')
      ) {
        return false;
      }
      return pathname.startsWith(href);
    }
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* ── Mobile hamburger button (visible < md) ─────────────── */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-3 left-3 z-50 md:hidden flex items-center justify-center w-10 h-10 rounded-lg bg-brand-700 text-white shadow-lg"
        aria-label="メニューを開く"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* ── Mobile backdrop overlay (visible < md when open) ───── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ────────────────────────────────────────────── */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex flex-col
          bg-brand-700 transition-all duration-300
          w-60
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0
          ${collapsed ? 'md:w-16' : 'md:w-60'}
        `}
      >
        {/* ── Logo ─────────────────────────────────────────────── */}
        <div className="flex items-center h-14 px-3 border-b border-brand-600 gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gold to-sage grid place-items-center text-white text-sm font-bold shrink-0">
            H
          </div>
          {/* On mobile overlay always show label; on desktop respect collapsed */}
          <span
            className={`text-[15px] font-semibold text-white tracking-wide truncate
              ${collapsed ? 'md:hidden' : ''}`}
          >
            Harmony
          </span>

          {/* Mobile close button */}
          <button
            onClick={closeMobile}
            className="ml-auto p-1.5 rounded-lg text-brand-200 hover:text-white hover:bg-brand-600 transition-colors md:hidden"
            aria-label="メニューを閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Nav ──────────────────────────────────────────────── */}
        <nav className="flex-1 py-3 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`relative flex items-center gap-3 mx-2 px-2.5 py-2 rounded-lg text-[13px]
                  transition-colors
                  ${
                    active
                      ? 'bg-brand-500 text-white font-medium'
                      : 'text-brand-100 hover:bg-brand-600 hover:text-white'
                  }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                {/* On mobile overlay always show label; on desktop respect collapsed */}
                <span className={`flex-1 ${collapsed ? 'md:hidden' : ''}`}>
                  {item.label}
                </span>
                {/* キューバッジ */}
                {item.badgeKey === 'queue' && queueCount > 0 && (
                  <span
                    className={`inline-flex items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-amber-900
                      ${collapsed ? 'md:absolute md:-top-1 md:-right-1 md:h-4 md:w-4 ml-auto h-5 min-w-[20px] px-1 md:ml-0 md:px-0' : 'ml-auto h-5 min-w-[20px] px-1'}`}
                  >
                    {queueCount > 99 ? '99+' : queueCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* ── Footer toggle (desktop only) ────────────────────── */}
        <div className="hidden md:flex border-t border-brand-600 p-1.5 items-center">
          <button
            onClick={onToggle}
            className="p-2 rounded-lg text-brand-200 hover:text-white hover:bg-brand-600 transition-colors"
            aria-label={collapsed ? 'サイドバーを展開' : 'サイドバーを折りたたむ'}
          >
            {collapsed ? (
              <ChevronRight className="w-5 h-5" />
            ) : (
              <ChevronLeft className="w-5 h-5" />
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
