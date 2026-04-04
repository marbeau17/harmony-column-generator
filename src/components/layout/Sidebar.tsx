// ============================================================================
// src/components/layout/Sidebar.tsx
// ダッシュボード サイドバー — スピリチュアルブランドカラー
// ============================================================================
'use client';

import { useState } from 'react';
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
  { label: 'ダッシュボード', href: '/dashboard',              icon: LayoutDashboard },
  { label: '記事作成',       href: '/dashboard/articles/new', icon: Sparkles },
  { label: 'AIプランナー',   href: '/dashboard/planner',      icon: Lightbulb },
  { label: '記事一覧',       href: '/dashboard/articles',     icon: FileText },
  { label: '元記事管理',     href: '/dashboard/source-articles', icon: BookOpen },
  { label: '設定',           href: '/dashboard/settings',     icon: Settings },
] as const;

// ─── Sidebar ────────────────────────────────────────────────────────────────

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === href : pathname.startsWith(href);

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
              className={`flex items-center gap-3 mx-2 px-2.5 py-2 rounded-lg text-[13px]
                transition-colors
                ${
                  active
                    ? 'bg-brand-500 text-white font-medium'
                    : 'text-brand-100 hover:bg-brand-600 hover:text-white'
                }`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
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
