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
    <div className="flex items-center justify-between">
      <div className="flex-1">
        <p className="text-sm text-gray-500">{title}</p>
        <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
        {trend && (
          <p className="mt-1 text-xs text-gray-400">{trend}</p>
        )}
      </div>
      <div className="ml-4 flex h-12 w-12 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
        {icon}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block bg-white rounded-xl shadow-sm p-6 transition-colors hover:bg-gray-50"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      {content}
    </div>
  );
}
