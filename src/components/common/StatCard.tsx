'use client';

import React from 'react';
import Link from 'next/link';

interface StatCardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  trend?: string;
  href?: string;
}

export default function StatCard({ title, value, icon, trend, href }: StatCardProps) {
  const content = (
    <div className="flex items-start sm:items-center justify-between gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-xs sm:text-sm text-gray-500 truncate">{title}</p>
        <p className="mt-0.5 sm:mt-1 text-xl sm:text-2xl font-bold text-gray-900">{value}</p>
        {trend && (
          <p className="mt-1 text-[11px] sm:text-xs text-gray-400">{trend}</p>
        )}
      </div>
      <div className="flex h-9 w-9 sm:h-12 sm:w-12 items-center justify-center rounded-lg bg-brand-50 text-brand-600 flex-shrink-0 [&>svg]:h-4 [&>svg]:w-4 sm:[&>svg]:h-6 sm:[&>svg]:w-6">
        {icon}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block bg-white rounded-xl shadow-sm p-4 sm:p-6 transition-colors hover:bg-gray-50"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6">
      {content}
    </div>
  );
}
