// ============================================================================
// src/components/articles/IntentRadioCard.tsx
// 意図タイプ Radio Card — info / empathy / solve / introspect の 4 タイプ
// dark: クラスでダークモード対応（global CLAUDE.md ルール準拠）
// ============================================================================
'use client';

import { Info, HeartHandshake, Wrench, Eye } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type IntentType = 'info' | 'empathy' | 'solve' | 'introspect';

interface IntentDef {
  value: IntentType;
  label: string;
  description: string;
  icon: LucideIcon;
}

const INTENTS: readonly IntentDef[] = [
  {
    value: 'info',
    label: '情報提供',
    description: '事実・知識・概念を整理して伝える',
    icon: Info,
  },
  {
    value: 'empathy',
    label: '共感',
    description: '読者の気持ちに寄り添い、安心を届ける',
    icon: HeartHandshake,
  },
  {
    value: 'solve',
    label: '課題解決',
    description: '具体的な悩みに対する手順・ワークを示す',
    icon: Wrench,
  },
  {
    value: 'introspect',
    label: '内省促進',
    description: '読み手自身の内側へ問いを向けさせる',
    icon: Eye,
  },
] as const;

interface Props {
  value: IntentType | '';
  onChange: (next: IntentType) => void;
  disabled?: boolean;
}

export default function IntentRadioCard({ value, onChange, disabled = false }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="記事の意図タイプ"
      className="grid grid-cols-1 gap-2 sm:grid-cols-2"
    >
      {INTENTS.map((it) => {
        const Icon = it.icon;
        const selected = value === it.value;
        return (
          <button
            key={it.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(it.value)}
            className={`group relative flex items-start gap-3 rounded-xl border p-3 text-left transition
              active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed
              focus:outline-none focus:ring-2 focus:ring-brand-500/40
              ${
                selected
                  ? 'border-brand-500 bg-brand-50 shadow-sm dark:border-brand-400 dark:bg-brand-900/30'
                  : 'border-gray-200 bg-white hover:border-brand-300 hover:bg-brand-50/50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-brand-500 dark:hover:bg-gray-800'
              }`}
          >
            <span
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg
                ${
                  selected
                    ? 'bg-brand-500 text-white dark:bg-brand-400 dark:text-brand-900'
                    : 'bg-brand-100 text-brand-700 group-hover:bg-brand-200 dark:bg-gray-800 dark:text-brand-300'
                }`}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span className="flex flex-col gap-0.5">
              <span
                className={`text-sm font-semibold
                  ${selected ? 'text-brand-800 dark:text-brand-50' : 'text-gray-800 dark:text-gray-100'}`}
              >
                {it.label}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{it.description}</span>
            </span>
            {selected && (
              <span
                aria-hidden
                className="absolute right-2 top-2 h-2 w-2 rounded-full bg-brand-500 dark:bg-brand-400"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export const INTENT_OPTIONS = INTENTS;
