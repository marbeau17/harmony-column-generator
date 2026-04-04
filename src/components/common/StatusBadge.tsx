'use client';

import React from 'react';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft: {
    label: '下書き',
    className: 'bg-slate-100 text-slate-700',
  },
  outline_pending: {
    label: '構成案確認中',
    className: 'bg-amber-100 text-amber-700',
  },
  outline_approved: {
    label: '構成案承認済',
    className: 'bg-sky-100 text-sky-700',
  },
  body_generating: {
    label: 'AI生成中',
    className: 'bg-violet-100 text-violet-700 animate-pulse',
  },
  body_review: {
    label: '生成レビュー',
    className: 'bg-orange-100 text-orange-700',
  },
  editing: {
    label: '編集中',
    className: 'bg-blue-100 text-blue-700',
  },
  published: {
    label: '公開済',
    className: 'bg-emerald-100 text-emerald-700',
  },
};

export default function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    className: 'bg-gray-100 text-gray-700',
  };

  const sizeClass = size === 'md' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs';

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${sizeClass} ${config.className}`}
    >
      {config.label}
    </span>
  );
}
