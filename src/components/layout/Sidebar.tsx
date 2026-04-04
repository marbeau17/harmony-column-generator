// ============================================================================
// src/components/layout/Sidebar.tsx
// ダッシュボード サイドバー — スピリチュアルブランドカラー
// ============================================================================
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Sparkles,
  FileText,
  BookOpen,
  Lightbulb,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

// ─── Navigation items ───────────────────────────────────────────────────────

const NAV = [
  { label: 'ダッシュボード', href: '/dashboard',                 icon: LayoutDashboard, badgeKey: null },
  { label: 'AIプランナー',   href: '/dashboard/planner',         icon: Lightbulb,       badgeKey: 'queue' as const },
  { label: '記事作成',       href: '/dashboard/articles/new',    icon: Sparkles,        badgeKey: null },
  { label: '記事一覧',       href: '/dashboard/articles',        icon: FileText,        badgeKey: null },
  { label: '元記事管理',     href: '/dashboard/source-articles', icon: BookOpen,        badgeKey: null },
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

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === href;
    // /dashboard/articles/new は /dashboard/articles より先にチェック
    if (href === '/dashboard/articles/new') return pathname === href;
    return pathname.startsWith(href);
  };

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex flex-col
        bg-brand-700 transition-[width] duration-300
        ${collapsed ? 'w-16' : 'w-60'}`}
    >
      {/* ── Logo ─────────────────────────────────────────────────── */}
      <div className="flex items-center h-14 px-3 border-b border-brand-600 gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gold to-sage grid place-items-center text-white text-sm font-bold shrink-0">
          H
        </div>
        {!collapsed && (
          <span className="text-[15px] font-semibold text-white tracking-wide truncate">
            Harmony
          </span>
        )}
      </div>

      {/* ── Nav ──────────────────────────────────────────────────── */}
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
              {!collapsed && <span className="flex-1">{item.label}</span>}
              {/* キューバッジ */}
              {item.badgeKey === 'queue' && queueCount > 0 && (
                <span
                  className={`inline-flex items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-amber-900
                    ${collapsed ? 'absolute -top-1 -right-1 h-4 w-4' : 'ml-auto h-5 min-w-[20px] px-1'}`}
                >
                  {queueCount > 99 ? '99+' : queueCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* ── Footer toggle ────────────────────────────────────────── */}
      <div className="border-t border-brand-600 p-1.5 flex items-center">
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
  );
}
