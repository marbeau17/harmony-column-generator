// ============================================================================
// src/app/(dashboard)/dashboard/articles/[id]/outline/page.tsx
// アウトライン確認・編集ページ（ウィザード Step2）
// ============================================================================
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { Article } from '@/types/article';
import type { Stage1Heading, Stage1ImagePrompt } from '@/types/ai';
import StatusBadge from '@/components/common/StatusBadge';

// ─── 見出しツリーコンポーネント ─────────────────────────────────────────────

interface HeadingNodeProps {
  heading: Stage1Heading;
  index: number;
  parentIndex?: string;
  onUpdate: (path: string, text: string) => void;
}

function HeadingNode({ heading, index, parentIndex, onUpdate }: HeadingNodeProps) {
  const path = parentIndex !== undefined ? `${parentIndex}.${index}` : `${index}`;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(heading.text);

  const handleBlur = () => {
    setEditing(false);
    if (text !== heading.text) {
      onUpdate(path, text);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLElement).blur();
    }
    if (e.key === 'Escape') {
      setText(heading.text);
      setEditing(false);
    }
  };

  const isH2 = heading.level === 'h2';

  return (
    <div className={isH2 ? 'mb-3' : 'mb-1 ml-3 sm:ml-6'}>
      <div
        className={`group flex items-start gap-2 sm:items-center sm:gap-3 rounded-lg border p-2.5 sm:p-3 transition-colors ${
          isH2
            ? 'border-brand-200 bg-white hover:border-brand-400'
            : 'border-slate-200 bg-slate-50 hover:border-slate-300'
        }`}
      >
        {/* レベルバッジ */}
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold uppercase ${
            isH2
              ? 'bg-brand-500 text-white'
              : 'bg-slate-300 text-slate-700'
          }`}
        >
          {heading.level}
        </span>

        {/* テキスト（インライン編集） */}
        {editing ? (
          <input
            className="flex-1 rounded border border-brand-400 bg-white px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-brand-300"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        ) : (
          <span
            className="flex-1 cursor-pointer text-sm text-brand-800 hover:text-brand-600"
            onClick={() => setEditing(true)}
            title="クリックして編集"
          >
            {text}
          </span>
        )}

        {/* 推定文字数 */}
        <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">
          約{heading.estimated_words}字
        </span>

        {/* 編集アイコン（モバイルでは常時表示） */}
        <button
          className="shrink-0 rounded p-1.5 text-slate-400 opacity-100 sm:opacity-0 transition-opacity hover:bg-brand-100 hover:text-brand-600 group-hover:opacity-100"
          onClick={() => setEditing(true)}
          title="編集"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </button>
      </div>

      {/* 子見出し */}
      {heading.children?.map((child, childIdx) => (
        <HeadingNode
          key={childIdx}
          heading={child}
          index={childIdx}
          parentIndex={path}
          onUpdate={onUpdate}
        />
      ))}
    </div>
  );
}

// ─── メインコンポーネント ───────────────────────────────────────────────────

export default function OutlinePage() {
  const params = useParams();
  const router = useRouter();
  const articleId = params.id as string;

  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // 編集状態
  const [editTitle, setEditTitle] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [editMeta, setEditMeta] = useState('');
  const [editingMeta, setEditingMeta] = useState(false);

  // ── ページ離脱防止（処理中） ──────────────────────────────────────────
  useEffect(() => {
    if (!submitting && !regenerating) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [submitting, regenerating]);

  // ─── データ取得 ───────────────────────────────────────────────────────

  const fetchArticle = useCallback(async () => {
    try {
      const res = await fetch(`/api/articles/${articleId}`);
      if (!res.ok) throw new Error('記事の取得に失敗しました');
      const json = await res.json();
      const data: Article = json.data;
      setArticle(data);
      setEditTitle(data.stage1_outline?.title_proposal ?? data.title ?? '');
      setEditMeta(data.stage1_outline?.meta_description ?? data.meta_description ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期せぬエラー');
    } finally {
      setLoading(false);
    }
  }, [articleId]);

  useEffect(() => {
    fetchArticle();
  }, [fetchArticle]);

  // ─── 見出し更新ハンドラ ─────────────────────────────────────────────

  const handleHeadingUpdate = (path: string, newText: string) => {
    if (!article?.stage1_outline) return;

    const indices = path.split('.').map(Number);
    const outline = JSON.parse(JSON.stringify(article.stage1_outline));

    let target: Stage1Heading[] = outline.headings;
    for (let i = 0; i < indices.length - 1; i++) {
      target = target[indices[i]].children ?? [];
    }
    target[indices[indices.length - 1]].text = newText;

    setArticle({ ...article, stage1_outline: outline });
  };

  // ─── 承認して本文生成 ─────────────────────────────────────────────────

  const handleApprove = async () => {
    if (!article) return;
    setSubmitting(true);
    try {
      // 1. フィールド更新（タイトル、メタ、構成案の編集内容を保存）
      const updateRes = await fetch(`/api/articles/${articleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle,
          meta_description: editMeta,
          stage1_outline: article.stage1_outline,
        }),
      });
      if (!updateRes.ok) throw new Error('記事の更新に失敗しました');

      // 2. ステータス遷移: outline_pending → outline_approved（既にapprovedならスキップ）
      if (article.status !== 'outline_approved') {
        const transitionRes = await fetch(`/api/articles/${articleId}/transition`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'outline_approved' }),
        });
        if (!transitionRes.ok) throw new Error('ステータス遷移に失敗しました');
      }

      // 3. 本文生成開始（generate-body が outline_approved → body_generating を内部で処理）
      const genRes = await fetch(`/api/ai/generate-body`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId }),
      });
      if (!genRes.ok) throw new Error('本文生成の開始に失敗しました');

      router.push(`/dashboard/articles/${articleId}/review`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期せぬエラー');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── アウトライン再生成 ───────────────────────────────────────────────

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/ai/generate-outline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId }),
      });
      if (!res.ok) throw new Error('アウトライン再生成に失敗しました');
      await fetchArticle();
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期せぬエラー');
    } finally {
      setRegenerating(false);
    }
  };

  // ─── ローディング / エラー ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" />
          <p className="text-sm text-brand-600">アウトラインを読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl py-10">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-700">{error}</p>
          <button
            className="mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm text-white hover:bg-brand-600"
            onClick={() => { setError(null); setLoading(true); fetchArticle(); }}
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }

  if (!article || !article.stage1_outline) {
    return (
      <div className="mx-auto max-w-3xl py-10 text-center">
        <p className="text-slate-500">アウトラインデータがありません。</p>
        <button
          className="mt-4 text-sm text-brand-500 underline hover:text-brand-700"
          onClick={() => router.back()}
        >
          戻る
        </button>
      </div>
    );
  }

  const outline = article.stage1_outline;
  const totalWords = outline.headings.reduce((sum, h) => {
    let childWords = 0;
    if (h.children) {
      childWords = h.children.reduce((cs, c) => cs + c.estimated_words, 0);
    }
    return sum + h.estimated_words + childWords;
  }, 0);

  // ─── レンダリング ─────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 sm:space-y-6 sm:px-0">
      {/* ─ ヘッダー ─ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-medium text-brand-400">STEP 2</span>
            <StatusBadge status={article.status} />
          </div>
          <h1 className="text-xl font-bold text-brand-800 sm:text-2xl">アウトライン確認</h1>
          <p className="mt-1 text-sm text-slate-500">
            キーワード:
            <span className="ml-1 font-medium text-brand-600">{article.keyword}</span>
          </p>
        </div>
        <button
          className="self-start rounded-lg border border-brand-200 px-4 py-2 text-sm text-brand-600 hover:bg-brand-50"
          onClick={() => router.back()}
        >
          ← 戻る
        </button>
      </div>

      {/* ─ タイトル案 ─ */}
      <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-500">
            タイトル案
          </h2>
          <span className="text-xs text-slate-400">{editTitle.length}文字</span>
        </div>
        {editingTitle ? (
          <input
            className="w-full rounded-lg border border-brand-300 px-3 py-2.5 text-base font-bold text-brand-800 outline-none focus:ring-2 focus:ring-brand-300 sm:px-4 sm:py-3 sm:text-lg"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={() => setEditingTitle(false)}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); }}
            autoFocus
          />
        ) : (
          <p
            className="cursor-pointer rounded-lg px-3 py-2.5 text-base font-bold text-brand-800 transition-colors hover:bg-brand-50 sm:px-4 sm:py-3 sm:text-lg"
            onClick={() => setEditingTitle(true)}
            title="クリックして編集"
          >
            {editTitle || '（未設定）'}
          </p>
        )}
      </section>

      {/* ─ メタディスクリプション ─ */}
      <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-500">
            メタディスクリプション
          </h2>
          <span className={`text-xs ${editMeta.length > 160 ? 'text-red-500' : 'text-slate-400'}`}>
            {editMeta.length}/160文字
          </span>
        </div>
        {editingMeta ? (
          <textarea
            className="w-full resize-none rounded-lg border border-brand-300 px-4 py-3 text-sm text-brand-700 outline-none focus:ring-2 focus:ring-brand-300"
            rows={3}
            value={editMeta}
            onChange={(e) => setEditMeta(e.target.value)}
            onBlur={() => setEditingMeta(false)}
            autoFocus
          />
        ) : (
          <p
            className="cursor-pointer rounded-lg px-4 py-3 text-sm text-brand-700 transition-colors hover:bg-brand-50"
            onClick={() => setEditingMeta(true)}
            title="クリックして編集"
          >
            {editMeta || '（未設定）'}
          </p>
        )}
      </section>

      {/* ─ 見出しツリー ─ */}
      <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-500">
            見出し構成
          </h2>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-medium text-brand-700">
              推定合計 {totalWords.toLocaleString()}字
            </span>
          </div>
        </div>
        <div className="space-y-1">
          {outline.headings.map((heading, idx) => (
            <HeadingNode
              key={idx}
              heading={heading}
              index={idx}
              onUpdate={handleHeadingUpdate}
            />
          ))}
        </div>
      </section>

      {/* ─ CTA / 画像配置 ─ */}
      <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
        {/* CTA配置位置 */}
        <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand-500">
            CTA配置位置
          </h2>
          {outline.cta_positions && outline.cta_positions.length > 0 ? (
            <ul className="space-y-2">
              {outline.cta_positions.map((pos, idx) => (
                <li
                  key={idx}
                  className="flex items-center gap-2 rounded-lg bg-sage/10 px-3 py-2 text-sm text-brand-700"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sage text-xs font-bold text-white">
                    {idx + 1}
                  </span>
                  {pos}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">CTA配置位置の設定なし</p>
          )}

          {outline.cta_texts && outline.cta_texts.length > 0 && (
            <div className="mt-4 border-t border-brand-100 pt-3">
              <p className="mb-2 text-xs font-medium text-slate-500">CTA文言:</p>
              {outline.cta_texts.map((text, idx) => (
                <p key={idx} className="mb-1 rounded bg-brand-50 px-3 py-2 text-sm italic text-brand-600">
                  &ldquo;{text}&rdquo;
                </p>
              ))}
            </div>
          )}
        </section>

        {/* 画像配置位置 */}
        <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand-500">
            画像配置位置
          </h2>
          {outline.image_prompts && outline.image_prompts.length > 0 ? (
            <ul className="space-y-2">
              {outline.image_prompts.map((img: Stage1ImagePrompt, idx: number) => (
                <li
                  key={idx}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <p className="text-sm font-medium text-brand-700">{img.heading_text}</p>
                  <p className="mt-1 text-xs text-slate-500 line-clamp-2">{img.prompt}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">画像配置の設定なし</p>
          )}
        </section>
      </div>

      {/* ─ FAQ プレビュー ─ */}
      {outline.faq && outline.faq.length > 0 && (
        <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand-500">
            FAQ（よくある質問）
          </h2>
          <div className="space-y-3">
            {outline.faq.map((item, idx) => (
              <div key={idx} className="rounded-lg bg-brand-50 px-4 py-3">
                <p className="text-sm font-semibold text-brand-800">Q. {item.question}</p>
                <p className="mt-1 text-sm text-brand-600">A. {item.answer}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─ アクションボタン ─ */}
      <div className="flex flex-col-reverse gap-3 rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <button
          className="w-full rounded-lg border border-amber-300 bg-amber-50 px-5 py-3 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:py-2.5"
          onClick={handleRegenerate}
          disabled={regenerating || submitting}
        >
          {regenerating ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
              再生成中...
            </span>
          ) : (
            'アウトライン再生成'
          )}
        </button>

        <button
          className="w-full rounded-lg bg-brand-500 px-6 py-3 text-sm font-bold text-white shadow-md transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:py-2.5"
          onClick={handleApprove}
          disabled={submitting || regenerating}
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              処理中...
            </span>
          ) : (
            '承認して本文生成へ →'
          )}
        </button>
      </div>
    </div>
  );
}
