// ============================================================================
// src/app/(dashboard)/dashboard/articles/[id]/edit/page.tsx
// 記事編集ページ（ウィザード Step4-5 統合）
// 左60%: TipTapエディタ / 右40%: リアルタイムプレビュー
// 下部: 文字数カウンタ、自動保存インジケーター
// サイドパネル: メタ情報編集
// ============================================================================

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import TipTapEditor from '@/components/editor/TipTapEditor';
import PreviewPane from '@/components/editor/PreviewPane';
import type { Article, ArticleStatus, ThemeCategory } from '@/types/article';

// ─── Theme labels ───────────────────────────────────────────────────────────

const THEME_LABELS: Record<string, string> = {
  soul_mission: '魂の使命',
  relationships: '人間関係',
  grief_care: 'グリーフケア',
  self_growth: '自己成長',
  healing: 'ヒーリング',
  daily_awareness: '日常の気づき',
  spiritual_intro: 'スピリチュアル入門',
};

// ─── Auto-save hook ─────────────────────────────────────────────────────────

function useAutoSave(
  articleId: string,
  data: Partial<Article> | null,
  enabled: boolean,
) {
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');

  const save = useCallback(
    async (payload: Partial<Article>) => {
      const json = JSON.stringify(payload);
      if (json === lastSavedRef.current) return;

      setSaveStatus('saving');
      try {
        const res = await fetch(`/api/articles/${articleId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: json,
        });
        if (!res.ok) throw new Error('Save failed');
        lastSavedRef.current = json;
        setSaveStatus('saved');
      } catch {
        setSaveStatus('error');
      }
    },
    [articleId],
  );

  useEffect(() => {
    if (!enabled || !data) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      save(data);
    }, 3000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [data, enabled, save]);

  return { saveStatus, forceSave: save };
}

// ─── Page Component ─────────────────────────────────────────────────────────

export default function ArticleEditPage() {
  const params = useParams();
  const router = useRouter();
  const articleId = params.id as string;

  // ─── State ──────────────────────────────────────────────────────────────
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editable fields
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [keyword, setKeyword] = useState('');
  const [theme, setTheme] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');

  // UI state
  const [metaPanelOpen, setMetaPanelOpen] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // ─── Fetch article ──────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const res = await fetch(`/api/articles/${articleId}`);
        if (!res.ok) throw new Error('記事の取得に失敗しました');
        const json = await res.json();
        const a = json.data as Article;
        setArticle(a);
        setTitle(a.title ?? '');
        setSlug(a.slug ?? '');
        setMetaDescription(a.meta_description ?? '');
        setKeyword(a.keyword ?? '');
        setTheme(a.theme ?? '');
        // Use stage3_final_html > stage2_body_html > content
        setBodyHtml(a.stage3_final_html ?? a.stage2_body_html ?? a.content ?? '');
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : '不明なエラー');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [articleId]);

  // ─── Auto-save data ─────────────────────────────────────────────────────
  const autoSaveData = article
    ? {
        title: title || undefined,
        slug: slug || undefined,
        meta_description: metaDescription || undefined,
        keyword,
        theme,
        content: bodyHtml,
        stage3_final_html: bodyHtml,
      }
    : null;

  const { saveStatus, forceSave } = useAutoSave(
    articleId,
    autoSaveData as Partial<Article> | null,
    !loading && !!article,
  );

  // ─── Character count ───────────────────────────────────────────────────
  const charCount = bodyHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;

  // ─── Handlers ───────────────────────────────────────────────────────────

  const handleSaveDraft = useCallback(async () => {
    if (!autoSaveData) return;
    await forceSave({ ...autoSaveData, status: 'editing' as ArticleStatus });
  }, [autoSaveData, forceSave]);

  const handlePublish = useCallback(async () => {
    setPublishing(true);
    try {
      const res = await fetch(`/api/articles/${articleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...autoSaveData,
          status: 'published' as ArticleStatus,
          published_html: bodyHtml,
          published_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error('公開に失敗しました');
      setPublishDialogOpen(false);
      router.push(`/dashboard/articles/${articleId}`);
    } catch {
      alert('公開に失敗しました。もう一度お試しください。');
    } finally {
      setPublishing(false);
    }
  }, [articleId, autoSaveData, bodyHtml, router]);

  const handlePreviewNewTab = useCallback(() => {
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title || 'プレビュー'}</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;600;700&display=swap" rel="stylesheet"/>
  <style>
    body { font-family: 'Noto Sans JP', sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.8; color: #333; }
    h1 { font-size: 1.75em; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.3em; }
    h2 { background: #f3f4f6; padding: 12px 16px; border-left: 4px solid #6366f1; }
    h3 { border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3em; }
    img { max-width: 100%; height: auto; border-radius: 8px; }
    a { color: #2563eb; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { padding: 8px 12px; border: 1px solid #e5e7eb; }
    th { background: #f9fafb; }
    blockquote { border-left: 4px solid #d1d5db; padding: 8px 16px; color: #6b7280; background: #f9fafb; }
    mark { background: #fef08a; }
  </style>
</head>
<body>
  ${title ? `<h1>${title}</h1>` : ''}
  ${bodyHtml}
</body>
</html>`);
    win.document.close();
  }, [title, bodyHtml]);

  // ─── Loading / Error ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-brand-600" />
          <p className="text-sm text-gray-500">記事を読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-red-600 font-medium">{error || '記事が見つかりません'}</p>
          <button
            onClick={() => router.push('/dashboard/articles')}
            className="mt-4 px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            記事一覧に戻る
          </button>
        </div>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* ── Top bar ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/dashboard/articles/${articleId}`)}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            &larr; 戻る
          </button>
          <h1 className="text-lg font-semibold text-gray-900 truncate max-w-md">
            {title || '無題の記事'}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Auto-save indicator */}
          <span
            className={`text-xs px-2 py-1 rounded ${
              saveStatus === 'saving'
                ? 'bg-yellow-100 text-yellow-700'
                : saveStatus === 'saved'
                  ? 'bg-green-100 text-green-700'
                  : saveStatus === 'error'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-gray-100 text-gray-500'
            }`}
          >
            {saveStatus === 'saving'
              ? '保存中...'
              : saveStatus === 'saved'
                ? '保存済み'
                : saveStatus === 'error'
                  ? '保存エラー'
                  : '自動保存'}
          </span>

          {/* Meta panel toggle */}
          <button
            onClick={() => setMetaPanelOpen(!metaPanelOpen)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            title="メタ情報"
          >
            メタ情報
          </button>

          {/* SEO Check */}
          <button
            onClick={() =>
              alert(
                `SEOチェック結果:\n- 文字数: ${charCount}文字\n- タイトル: ${title.length}文字 ${title.length >= 30 && title.length <= 60 ? '(OK)' : '(30-60文字推奨)'}\n- メタディスクリプション: ${metaDescription.length}文字 ${metaDescription.length >= 100 && metaDescription.length <= 160 ? '(OK)' : '(100-160文字推奨)'}\n- キーワード: ${keyword || '未設定'}`,
              )
            }
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            SEOチェック
          </button>

          {/* Preview in new tab */}
          <button
            onClick={handlePreviewNewTab}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            プレビュー
          </button>

          {/* Save draft */}
          <button
            onClick={handleSaveDraft}
            className="px-3 py-1.5 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            下書き保存
          </button>

          {/* Publish */}
          <button
            onClick={() => setPublishDialogOpen(true)}
            className="px-3 py-1.5 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
          >
            公開
          </button>
        </div>
      </div>

      {/* ── Main content area ──────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Editor (left 60%) */}
        <div className="w-[60%] flex flex-col overflow-hidden border-r border-gray-200">
          <div className="flex-1 overflow-y-auto">
            <TipTapEditor
              content={bodyHtml}
              onChange={setBodyHtml}
              editable
            />
          </div>
        </div>

        {/* Preview (right 40%) */}
        <div className="w-[40%] flex flex-col overflow-hidden">
          <PreviewPane content={bodyHtml} />
        </div>
      </div>

      {/* ── Bottom bar: character count ────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-500 shrink-0">
        <div className="flex items-center gap-4">
          <span>
            文字数: <strong className="text-gray-700">{charCount.toLocaleString()}</strong>
          </span>
          {article.target_word_count > 0 && (
            <span>
              目標:{' '}
              <strong className="text-gray-700">
                {article.target_word_count.toLocaleString()}
              </strong>
              文字
              {charCount >= article.target_word_count && (
                <span className="ml-1 text-green-600">(達成)</span>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span>ステータス: {article.status}</span>
          <span>
            最終更新:{' '}
            {new Date(article.updated_at).toLocaleString('ja-JP', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </div>

      {/* ── Meta info side panel (drawer) ──────────────────────────────────── */}
      {metaPanelOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => setMetaPanelOpen(false)}
          />
          {/* Panel */}
          <div className="fixed right-0 top-0 bottom-0 w-96 bg-white shadow-xl z-50 overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                メタ情報
              </h2>
              <button
                onClick={() => setMetaPanelOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="p-4 space-y-5">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  タイトル
                  <span className="ml-1 text-xs text-gray-400">
                    ({title.length}文字)
                  </span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  placeholder="記事タイトル"
                />
              </div>

              {/* Slug */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  スラッグ (URL)
                </label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) =>
                    setSlug(
                      e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]/g, '-')
                        .replace(/-+/g, '-'),
                    )
                  }
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  placeholder="article-slug"
                />
              </div>

              {/* Meta description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  メタディスクリプション
                  <span className="ml-1 text-xs text-gray-400">
                    ({metaDescription.length}文字)
                  </span>
                </label>
                <textarea
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
                  placeholder="検索結果に表示される説明文 (100-160文字推奨)"
                />
              </div>

              {/* Theme / Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  カテゴリ
                </label>
                <select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                >
                  <option value="">選択してください</option>
                  {Object.entries(THEME_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Keyword */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  キーワード
                </label>
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                  placeholder="メインキーワード"
                />
              </div>

              {/* Read-only info */}
              <div className="pt-3 border-t border-gray-100">
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  記事情報
                </h3>
                <dl className="text-xs text-gray-500 space-y-1.5">
                  <div className="flex justify-between">
                    <dt>ID</dt>
                    <dd className="font-mono text-gray-600">
                      {article.id.slice(0, 8)}...
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>ステータス</dt>
                    <dd className="text-gray-600">{article.status}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>作成日</dt>
                    <dd className="text-gray-600">
                      {new Date(article.created_at).toLocaleDateString('ja-JP')}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>ペルソナ</dt>
                    <dd className="text-gray-600">{article.persona || '-'}</dd>
                  </div>
                  {article.source_article_id && (
                    <div className="flex justify-between">
                      <dt>元記事ID</dt>
                      <dd className="font-mono text-gray-600">
                        {article.source_article_id.slice(0, 8)}...
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Publish confirmation dialog ────────────────────────────────────── */}
      {publishDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setPublishDialogOpen(false)}
          />
          <div className="relative bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              記事を公開しますか？
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              ステータスが「published」に変更されます。公開後も編集は可能です。
            </p>
            <div className="text-sm text-gray-600 mb-4 p-3 bg-gray-50 rounded-lg">
              <p>
                <strong>タイトル:</strong> {title || '(未設定)'}
              </p>
              <p>
                <strong>文字数:</strong> {charCount.toLocaleString()}文字
              </p>
              <p>
                <strong>キーワード:</strong> {keyword || '(未設定)'}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPublishDialogOpen(false)}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                disabled={publishing}
              >
                キャンセル
              </button>
              <button
                onClick={handlePublish}
                disabled={publishing}
                className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50"
              >
                {publishing ? '公開中...' : '公開する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
