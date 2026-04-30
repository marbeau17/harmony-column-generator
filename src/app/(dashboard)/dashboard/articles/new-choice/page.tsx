// ============================================================================
// src/app/(dashboard)/dashboard/articles/new-choice/page.tsx
// 記事生成方式の選択 UI
//   - A: 既存ソース記事から生成（従来）  → /dashboard/articles/new
//   - B: テーマ/ペルソナからゼロ生成     → /dashboard/articles/new-from-scratch
// ============================================================================
'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BookOpen, Sparkles, ArrowRight, ArrowLeft } from 'lucide-react';

export default function NewArticleChoicePage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-cream/40 dark:bg-neutral-950 py-10 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        {/* ── 見出し ───────────────────────────────────────────── */}
        <header className="mb-10 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-brand-700 dark:text-brand-200 tracking-tight">
            新規記事を作成
          </h1>
          <p className="mt-3 text-sm sm:text-base text-neutral-600 dark:text-neutral-400">
            お好みの方法で記事を作成できます
          </p>
        </header>

        {/* ── 2 つの選択カード ───────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* ── カード A: 既存ソース記事から生成 ──────────────── */}
          <article
            className="group relative flex flex-col rounded-2xl border border-neutral-200 dark:border-neutral-800
                       bg-white dark:bg-neutral-900 p-6 sm:p-7 shadow-sm
                       transition-all duration-200
                       hover:scale-[1.015] hover:shadow-lg
                       hover:border-brand-300 dark:hover:border-brand-600"
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="flex items-center justify-center w-12 h-12 rounded-xl
                           bg-brand-50 dark:bg-brand-900/40
                           text-brand-700 dark:text-brand-300"
              >
                <BookOpen className="w-6 h-6" />
              </div>
              <h2 className="text-lg sm:text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                既存ソース記事から生成
              </h2>
            </div>

            <p className="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300 mb-5">
              由起子さんのアメブロ過去記事 1,499 件をベースに、視点を変換したオリジナルコラムを生成します。
            </p>

            <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800/60 p-3 text-xs text-neutral-600 dark:text-neutral-400 mb-6">
              <span className="font-medium text-neutral-700 dark:text-neutral-300">向いているケース:</span>
              <br />
              既存記事の翻案的な再構成、安定した語り口の維持
            </div>

            <button
              type="button"
              onClick={() => router.push('/dashboard/articles/new')}
              className="mt-auto inline-flex items-center justify-center gap-2 rounded-lg
                         bg-brand-700 hover:bg-brand-800
                         dark:bg-brand-600 dark:hover:bg-brand-500
                         px-5 py-3 text-sm font-medium text-white
                         transition-colors
                         focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2
                         dark:focus:ring-offset-neutral-900"
            >
              ソース記事を選んで開始
              <ArrowRight className="w-4 h-4" />
            </button>
          </article>

          {/* ── カード B: テーマ/ペルソナからゼロ生成 ─────────── */}
          <article
            className="group relative flex flex-col rounded-2xl border-2 border-gold/60 dark:border-gold/50
                       bg-white dark:bg-neutral-900 p-6 sm:p-7 shadow-sm
                       transition-all duration-200
                       hover:scale-[1.015] hover:shadow-lg
                       hover:border-gold dark:hover:border-gold"
          >
            {/* バッジ */}
            <div className="absolute top-4 right-4 flex flex-wrap gap-1.5 justify-end">
              <span
                className="inline-flex items-center rounded-full bg-gold/90 px-2.5 py-0.5
                           text-[10px] font-bold uppercase tracking-wider text-white shadow-sm"
              >
                NEW
              </span>
              <span
                className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/50
                           px-2.5 py-0.5 text-[10px] font-semibold tracking-wide
                           text-emerald-800 dark:text-emerald-200"
              >
                ハルシネーション検証付き
              </span>
            </div>

            <div className="flex items-center gap-3 mb-4 mt-8 sm:mt-0">
              <div
                className="flex items-center justify-center w-12 h-12 rounded-xl
                           bg-gold/20 dark:bg-gold/10
                           text-brand-800 dark:text-gold"
              >
                <Sparkles className="w-6 h-6" />
              </div>
              <h2 className="text-lg sm:text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                テーマ／ペルソナからゼロ生成
              </h2>
            </div>

            <p className="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300 mb-5">
              テーマ・ペルソナ・キーワードからゼロベースで記事を生成。ハルシネーション検証も自動実行します。
            </p>

            <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800/60 p-3 text-xs text-neutral-600 dark:text-neutral-400 mb-6">
              <span className="font-medium text-neutral-700 dark:text-neutral-300">向いているケース:</span>
              <br />
              ソース記事の在庫が無いテーマ、新しい角度で書きたい時
            </div>

            <button
              type="button"
              onClick={() => router.push('/dashboard/articles/new-from-scratch')}
              className="mt-auto inline-flex items-center justify-center gap-2 rounded-lg
                         bg-gradient-to-r from-brand-700 to-brand-600
                         hover:from-brand-800 hover:to-brand-700
                         dark:from-brand-600 dark:to-brand-500
                         dark:hover:from-brand-500 dark:hover:to-brand-400
                         px-5 py-3 text-sm font-medium text-white
                         transition-colors
                         focus:outline-none focus:ring-2 focus:ring-gold focus:ring-offset-2
                         dark:focus:ring-offset-neutral-900"
            >
              ゼロ生成を開始
              <ArrowRight className="w-4 h-4" />
            </button>
          </article>
        </div>

        {/* ── 使い分けガイド (補足) ────────────────────────────── */}
        <div className="mt-8 mx-auto max-w-3xl rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 bg-white/70 dark:bg-neutral-900/40 p-4 text-xs sm:text-sm text-neutral-600 dark:text-neutral-400">
          <p className="leading-relaxed">
            <span className="font-semibold text-brand-700 dark:text-brand-300">使い分けガイド: </span>
            ソース記事の在庫が無いテーマや新しい角度で書きたい時は <strong className="text-neutral-800 dark:text-neutral-200">B（ゼロ生成）</strong>、
            既存記事の翻案的な再構成は <strong className="text-neutral-800 dark:text-neutral-200">A（ソースから生成）</strong> がおすすめです。
          </p>
        </div>

        {/* ── 戻るリンク ───────────────────────────────────────── */}
        <div className="mt-10 text-center">
          <Link
            href="/dashboard/articles"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm
                       text-neutral-500 hover:text-brand-700
                       dark:text-neutral-400 dark:hover:text-brand-300
                       transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            過去記事一覧に戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
