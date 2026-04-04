// ============================================================================
// src/components/layout/DashboardShell.tsx
// ダッシュボード画面シェル — Sidebar + Header + メインコンテンツ
// ============================================================================
'use client';

import { useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';

interface DashboardShellProps {
  children: React.ReactNode;
  userName: string;
}

export default function DashboardShell({ children, userName }: DashboardShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-brand-50">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />

      {/* Main area — offset by sidebar width */}
      <div
        className={`transition-[padding] duration-300 ${
          collapsed ? 'pl-16' : 'pl-60'
        }`}
      >
        <Header userName={userName} />
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
