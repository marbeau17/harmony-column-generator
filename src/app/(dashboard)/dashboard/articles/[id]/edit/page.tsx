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
import type { Article } from '@/types/article';
import QualityFixMenu from '@/components/articles/QualityFixMenu';
import type { CheckItem } from '@/lib/content/quality-checklist';
import toast from 'react-hot-toast';

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
  const [initialBodyHtml, setInitialBodyHtml] = useState(''); // 変更検知用

  // UI state
  const [metaPanelOpen, setMetaPanelOpen] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishSuccessOpen, setPublishSuccessOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [qualityCheck, setQualityCheck] = useState<Record<string, unknown> | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<'success' | 'error' | null>(null);
  const [mobileView, setMobileView] = useState<'editor' | 'preview'>('editor');

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
        // Use stage3_final_html > stage2_body_html, replace image placeholders.
        // バグG (2026-05-02): `??` は空文字を fallback しないため、generation 失敗で
        // 空文字保存された記事 (バグD 系統) が「本文がありません」表示になっていた。
        // 空文字も明示的にスキップするよう変更。
        const stage3 = (a.stage3_final_html ?? '').trim();
        const stage2 = (a.stage2_body_html ?? '').trim();
        let html = stage3.length > 0 ? a.stage3_final_html! : (stage2.length > 0 ? a.stage2_body_html! : '');
        // Replace <!--IMAGE:position:filename--> placeholders with actual images
        const imageFiles = a.image_files as { position: string; url: string; alt: string }[] | null;
        if (imageFiles && Array.isArray(imageFiles)) {
          for (const img of imageFiles) {
            const imgTag = `<img src="${img.url}" alt="${img.alt || ''}" style="max-width:100%;border-radius:8px;margin:1em 0" />`;
            // Match various placeholder formats including TipTap-stripped versions
            const patterns = [
              new RegExp(`<!--\\s*IMAGE:${img.position}:[^-]*-->`, 'g'),
              new RegExp(`<div[^>]*>\\s*<!--\\s*IMAGE:${img.position}:[^-]*-->\\s*</div>`, 'g'),
              new RegExp(`IMAGE:${img.position}:[\\w.-]+`, 'g'),
              new RegExp(`<p[^>]*>\\s*IMAGE:${img.position}\\s*</p>`, 'g'),
              new RegExp(`(?<![\\w:])IMAGE:${img.position}(?![\\w:])`, 'g'),
              new RegExp(`<(?:div|span|p)[^>]*class="[^"]*placeholder[^"]*"[^>]*>[^<]*IMAGE:${img.position}[^<]*</(?:div|span|p)>`, 'g'),
            ];
            for (const pattern of patterns) {
              html = html.replace(pattern, imgTag);
            }
          }
        }
        setBodyHtml(html);
        setInitialBodyHtml(html);
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
        stage3_final_html: bodyHtml,
      }
    : null;

  const { saveStatus, forceSave } = useAutoSave(
    articleId,
    autoSaveData as Partial<Article> | null,
    !loading && !!article,
  );

  // ─── ページ離脱防止（未保存の変更がある場合） ─────────────────────────
  useEffect(() => {
    if (!article) return;
    const hasUnsaved = saveStatus === 'saving' || publishing;
    if (!hasUnsaved) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [article, saveStatus, publishing]);

  // ─── Character count ───────────────────────────────────────────────────
  const charCount = bodyHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;

  // ─── Handlers ───────────────────────────────────────────────────────────

  const handleSaveDraft = useCallback(async () => {
    if (!autoSaveData) return;
    await forceSave(autoSaveData);
  }, [autoSaveData, forceSave]);

  const handlePublish = useCallback(async () => {
    setPublishing(true);
    try {
      // 1. フィールド更新（最終HTML・メタ情報を保存）
      const updateRes = await fetch(`/api/articles/${articleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...autoSaveData,
          published_html: bodyHtml,
          published_at: new Date().toISOString(),
        }),
      });
      if (!updateRes.ok) throw new Error('記事の保存に失敗しました');

      // 2. ステータス遷移: editing → published
      const transitionRes = await fetch(`/api/articles/${articleId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'published' }),
      });
      if (!transitionRes.ok) {
        const errJson = await transitionRes.json().catch(() => ({}));
        throw new Error(errJson?.error ?? 'ステータス遷移に失敗しました');
      }

      // バックグラウンドでFTPに自動アップロード（失敗しても公開は成功扱い）
      fetch(`/api/articles/${articleId}/deploy`, {
        method: 'POST',
      }).then((res) => {
        if (res.ok) {
          console.log('[publish] FTP自動アップロード完了');
        } else {
          console.warn('[publish] FTPアップロード失敗（手動で再試行してください）');
        }
      }).catch(() => {});

      setPublishDialogOpen(false);
      setPublishSuccessOpen(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : '公開に失敗しました';
      toast.error(`公開失敗: ${message}`, { duration: 8000 });
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

  const handleReExport = useCallback(async () => {
    setExporting(true);
    setExportResult(null);
    try {
      const res = await fetch('/api/export/article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Export failed');
      }

      // Download the ZIP file
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `article-${articleId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportResult('success');
      setTimeout(() => setExportResult(null), 3000);
    } catch {
      setExportResult('error');
      setTimeout(() => setExportResult(null), 5000);
    } finally {
      setExporting(false);
    }
  }, [articleId]);

  const handleApplyImages = useCallback(async () => {
    try {
      const res = await fetch(`/api/articles/${articleId}`);
      if (!res.ok) {
        toast.error('記事の取得に失敗しました');
        return;
      }
      const json = await res.json();
      const a = json.data as Article;
      setArticle(a);

      let html = bodyHtml;
      const imageFiles = a.image_files as
        | { position: string; url: string; alt: string }[]
        | null;

      if (!imageFiles || !Array.isArray(imageFiles) || imageFiles.length === 0) {
        toast.error('この記事には画像が登録されていません');
        return;
      }

      const imgTagFor = (img: { url: string; alt: string }) =>
        `<img src="${img.url}" alt="${img.alt || ''}" style="max-width:100%;border-radius:8px;margin:1em 0" />`;

      // ── Phase 1: 位置名付きパターン (旧形式 IMAGE:hero / IMAGE:body) ─────
      const matchedPositions = new Set<string>();
      let phase1Replacements = 0;
      for (const img of imageFiles) {
        const tag = imgTagFor(img);
        const patterns = [
          new RegExp(`<p>\\s*IMAGE:${img.position}[^<]*<\\/p>`, 'g'),
          new RegExp(`IMAGE:${img.position}(?::[^\\s<]*)?`, 'g'),
          new RegExp(`<!--\\s*IMAGE:${img.position}:[^-]*-->`, 'g'),
          new RegExp(`<div[^>]*>\\s*<!--\\s*IMAGE:${img.position}:[^-]*-->\\s*</div>`, 'g'),
        ];
        for (const p of patterns) {
          const before = html;
          html = html.replace(p, tag);
          if (before !== html) {
            matchedPositions.add(img.position);
            phase1Replacements += (before.match(p) || []).length;
          }
        }
      }

      // ── Phase 2: 位置情報なし IMAGE プレースホルダの順序割当 fallback ────
      // 例: <!--IMAGE: 縁側で温かいお茶を-->  / IMAGE: 説明文-->  / <p>IMAGE: ...</p>
      // バグ (2026-05-02): 位置名なしの残骸が残っている記事で「画像を反映」が無反応だった
      const orderedPositions = ['hero', 'body', 'summary'];
      const unmatched = orderedPositions.filter((p) => !matchedPositions.has(p));
      const imageByPos = new Map(imageFiles.map((f) => [f.position, f]));
      let phase2Replacements = 0;

      if (unmatched.length > 0) {
        // 3 種類の loose パターンを document 順で消費
        const fallbackPatterns: RegExp[] = [
          /(?:<!--\s*)?IMAGE[：:]\s*[^<>\n]*?-->/g, // HTML コメント形式 (最優先)
          /<p[^>]*>\s*IMAGE[：:]\s*[^<]*<\/p>/g, // <p> 包み (TipTap)
          /(?<![A-Za-z_])IMAGE[：:]\s*[^\n<]{1,200}/g, // bare text 末尾
        ];
        let unmatchedIdx = 0;
        for (const fp of fallbackPatterns) {
          if (unmatchedIdx >= unmatched.length) break;
          html = html.replace(fp, (match) => {
            if (unmatchedIdx >= unmatched.length) return match;
            const pos = unmatched[unmatchedIdx];
            const img = imageByPos.get(pos);
            unmatchedIdx++;
            phase2Replacements++;
            return img ? imgTagFor(img) : match;
          });
        }
      }

      const total = phase1Replacements + phase2Replacements;
      if (total === 0) {
        const imageOccurrences = html.match(/IMAGE[：:][^\n<]{0,100}/gi);
        console.warn('[handleApplyImages] no replacements; remaining IMAGE patterns:', imageOccurrences);
        toast.error('画像プレースホルダが見つかりませんでした');
      } else {
        console.log('[handleApplyImages] replacements:', {
          phase1: phase1Replacements,
          phase2: phase2Replacements,
          matchedPositions: Array.from(matchedPositions),
        });
        toast.success(
          `画像を反映しました（位置名一致 ${phase1Replacements} 件 / 順序割当 ${phase2Replacements} 件）`,
        );
      }
      setBodyHtml(html);
    } catch (err) {
      console.error('[handleApplyImages] Error:', err);
      toast.error('画像反映に失敗しました');
    }
  }, [articleId, bodyHtml]);

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
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center max-w-md">
          <p className="text-red-700 font-medium">{error || '記事が見つかりません'}</p>
          <div className="mt-4 flex items-center justify-center gap-3">
            {error && (
              <button
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  const load = async () => {
                    try {
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
                      // 空文字も skip (バグG 同様)
                      const s3 = (a.stage3_final_html ?? '').trim();
                      const s2 = (a.stage2_body_html ?? '').trim();
                      setBodyHtml(s3.length > 0 ? a.stage3_final_html! : (s2.length > 0 ? a.stage2_body_html! : ''));
                    } catch (err: unknown) {
                      setError(err instanceof Error ? err.message : '不明なエラー');
                    } finally {
                      setLoading(false);
                    }
                  };
                  load();
                }}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors"
              >
                再試行
              </button>
            )}
            <button
              onClick={() => router.push('/dashboard/articles')}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              記事一覧に戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* ── Top bar ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => router.push(`/dashboard/articles/${articleId}`)}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors shrink-0"
          >
            &larr; 戻る
          </button>
          <h1 className="text-base lg:text-lg font-semibold text-gray-900 truncate max-w-[150px] sm:max-w-xs lg:max-w-md">
            {title || '無題の記事'}
          </h1>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
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
            className="px-2 sm:px-3 py-1.5 text-xs sm:text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
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
            className="hidden sm:inline-flex px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            SEOチェック
          </button>

          {/* Preview in new tab */}
          <button
            onClick={handlePreviewNewTab}
            className="hidden sm:inline-flex px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            プレビュー
          </button>

          {/* Apply images */}
          <button
            onClick={handleApplyImages}
            className="rounded-lg border border-brand-200 px-3 py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-50"
          >
            画像を反映
          </button>

          {/* Save draft */}
          <button
            onClick={handleSaveDraft}
            className="px-2 sm:px-3 py-1.5 text-xs sm:text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            保存
          </button>

          {/* Publish */}
          {(() => {
            const hasChanges = bodyHtml !== initialBodyHtml || title !== (article.title ?? '') || metaDescription !== (article.meta_description ?? '');
            const isAlreadyPublished = article.status === 'published';
            const isDisabled = isAlreadyPublished && !hasChanges;
            return (
              <button
                onClick={async () => {
                  if (charCount === 0) {
                    toast.error('本文が空です。公開するには本文を入力してください。');
                    return;
                  }
                  // 公開ダイアログを開くと同時に品質チェックを実行
                  setPublishDialogOpen(true);
                  setQualityLoading(true);
                  setQualityCheck(null);
                  try {
                    // まず最新の本文を保存
                    await fetch(`/api/articles/${articleId}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ stage2_body_html: bodyHtml, title, meta_description: metaDescription }),
                    });
                    const res = await fetch(`/api/articles/${articleId}/quality-check`, { method: 'POST' });
                    const data = await res.json();
                    setQualityCheck(data);
                  } catch {
                    setQualityCheck(null);
                  } finally {
                    setQualityLoading(false);
                  }
                }}
                disabled={isDisabled}
                className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm rounded-lg transition-colors ${
                  isDisabled
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-brand-600 text-white hover:bg-brand-700'
                }`}
                title={isDisabled ? '変更がありません' : '記事を公開します'}
              >
                {isAlreadyPublished && !hasChanges ? '変更なし' : '公開'}
              </button>
            );
          })()}

          {/* Re-export (published articles only) */}
          {article.status === 'published' && (
            <button
              onClick={handleReExport}
              disabled={exporting}
              className="px-2 sm:px-3 py-1.5 text-xs sm:text-sm border border-brand-300 text-brand-700 rounded-lg hover:bg-brand-50 transition-colors disabled:opacity-50"
              title="out/ ディレクトリに再エクスポート"
            >
              {exporting
                ? 'エクスポート中...'
                : exportResult === 'success'
                  ? 'エクスポート完了'
                  : exportResult === 'error'
                    ? 'エクスポート失敗'
                    : '再エクスポート'}
            </button>
          )}
        </div>
      </div>

      {/* ── Mobile view toggle tabs (visible only on < lg) ─────────────────── */}
      <div className="flex lg:hidden border-b border-gray-200 bg-white shrink-0">
        <button
          onClick={() => setMobileView('editor')}
          className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors ${
            mobileView === 'editor'
              ? 'text-brand-700 border-b-2 border-brand-600 bg-brand-50/50'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          編集
        </button>
        <button
          onClick={() => setMobileView('preview')}
          className={`flex-1 py-2.5 text-sm font-medium text-center transition-colors ${
            mobileView === 'preview'
              ? 'text-brand-700 border-b-2 border-brand-600 bg-brand-50/50'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          プレビュー
        </button>
      </div>

      {/* ── Main content area ──────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Editor (mobile: full width, toggled / desktop: left 60%) */}
        <div
          className={`flex flex-col overflow-hidden border-r border-gray-200 ${
            mobileView === 'editor' ? 'flex' : 'hidden'
          } w-full lg:!flex lg:w-[60%]`}
        >
          <div className="flex-1 overflow-y-auto">
            <TipTapEditor
              content={bodyHtml}
              onChange={setBodyHtml}
              editable
            />
          </div>
        </div>

        {/* Preview (mobile: full width, toggled / desktop: right 40%) */}
        <div
          className={`flex flex-col overflow-hidden ${
            mobileView === 'preview' ? 'flex' : 'hidden'
          } w-full lg:!flex lg:w-[40%]`}
        >
          <PreviewPane content={bodyHtml} />
        </div>
      </div>

      {/* ── Bottom bar: character count ────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-500 shrink-0">
        <div className="flex items-center gap-4">
          <span>
            文字数: <strong className="text-gray-700">{charCount.toLocaleString()}</strong>
          </span>
          {article.target_word_count != null && article.target_word_count > 0 && (
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
          <div className="fixed right-0 top-0 bottom-0 w-full sm:w-96 bg-white shadow-xl z-50 overflow-y-auto">
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
            onClick={() => !publishing && setPublishDialogOpen(false)}
          />
          <div className="relative bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              記事を公開しますか？
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              ステータスが「published」に変更されます。公開後も編集は可能です。
            </p>
            {!title && (
              <p className="text-sm text-amber-600 mb-2">
                タイトルが未設定です。公開前に設定を推奨します。
              </p>
            )}
            <div className="text-sm text-gray-600 mb-4 p-3 bg-gray-50 rounded-lg">
              <p><strong>タイトル:</strong> {title || '(未設定)'}</p>
              <p><strong>文字数:</strong> {charCount.toLocaleString()}文字</p>
              <p><strong>キーワード:</strong> {keyword || '(未設定)'}</p>
            </div>

            {/* 品質チェック結果 */}
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-2">品質チェック結果</h3>
              {qualityLoading && (
                <div className="flex items-center gap-2 text-sm text-gray-500 py-3">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
                  品質チェック実行中...
                </div>
              )}
              {qualityCheck && !qualityLoading && (
                <div className="space-y-2">
                  {/* 合否バナー */}
                  <div className={`rounded-lg px-3 py-2 text-sm font-medium ${
                    (qualityCheck as Record<string, unknown>).passed
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-red-50 text-red-700 border border-red-200'
                  }`}>
                    {(qualityCheck as Record<string, unknown>).passed ? '\u2705 ' : '\u274C '}
                    {String((qualityCheck as Record<string, unknown>).summary)}
                  </div>

                  {/* エラー項目のみ表示（不合格時） */}
                  {!(qualityCheck as Record<string, unknown>).passed && (
                    <div className="rounded-lg border border-red-200 divide-y divide-red-100">
                      {((qualityCheck as Record<string, unknown>).items as CheckItem[])
                        ?.filter(i => i.status === 'fail' && i.severity === 'error')
                        .map(item => (
                          <div key={item.id} className="px-3 py-2 flex items-start gap-2">
                            <span className="text-red-500 shrink-0">{'\u274C'}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-gray-700">{item.label}</p>
                              {item.detail && <p className="text-xs text-red-500">{item.detail}</p>}
                            </div>
                            <QualityFixMenu
                              articleId={articleId}
                              item={item}
                              onAfter={async () => {
                                setQualityLoading(true);
                                try {
                                  const res = await fetch(`/api/articles/${articleId}/quality-check`, { method: 'POST' });
                                  const data = await res.json();
                                  setQualityCheck(data);
                                } finally {
                                  setQualityLoading(false);
                                }
                              }}
                              onManualEdit={() => setPublishDialogOpen(false)}
                            />
                          </div>
                        ))}
                    </div>
                  )}

                  {/* 警告項目（折りたたみ） */}
                  {((qualityCheck as Record<string, unknown>).warningCount as number) > 0 && (
                    <details className="text-xs text-gray-500">
                      <summary className="cursor-pointer hover:text-gray-700">
                        警告 {String((qualityCheck as Record<string, unknown>).warningCount)}件を表示
                      </summary>
                      <div className="mt-1 rounded-lg border border-amber-200 divide-y divide-amber-100">
                        {((qualityCheck as Record<string, unknown>).items as CheckItem[])
                          ?.filter(i => i.status === 'warn' || (i.status === 'fail' && i.severity === 'warning'))
                          .map(item => (
                            <div key={item.id} className="px-3 py-1.5 flex items-start gap-2">
                              <span className="shrink-0">{'\u26A0\uFE0F'}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-gray-600">{item.label}</p>
                                {item.detail && <p className="text-xs text-amber-600">{item.detail}</p>}
                              </div>
                              <QualityFixMenu
                                articleId={articleId}
                                item={item}
                                onAfter={async () => {
                                  setQualityLoading(true);
                                  try {
                                    const res = await fetch(`/api/articles/${articleId}/quality-check`, { method: 'POST' });
                                    const data = await res.json();
                                    setQualityCheck(data);
                                  } finally {
                                    setQualityLoading(false);
                                  }
                                }}
                                onManualEdit={() => setPublishDialogOpen(false)}
                              />
                            </div>
                          ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
              {!qualityCheck && !qualityLoading && (
                <p className="text-xs text-gray-400">品質チェックを読み込めませんでした。</p>
              )}
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
                disabled={publishing || qualityLoading || (qualityCheck ? !(qualityCheck as Record<string, unknown>).passed : false)}
                className={`px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-50 ${
                  qualityCheck && !(qualityCheck as Record<string, unknown>).passed
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-brand-600 text-white hover:bg-brand-700'
                }`}
                title={qualityCheck && !(qualityCheck as Record<string, unknown>).passed ? '品質チェックに合格してから公開してください' : ''}
              >
                {publishing ? '公開中...' : qualityCheck && !(qualityCheck as Record<string, unknown>).passed ? '品質チェック不合格' : '公開する'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Publish success dialog ─────────────────────────────────────────── */}
      {publishSuccessOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              記事を公開しました
            </h2>
            <p className="text-sm text-gray-500 mb-2">
              「{title || '無題の記事'}」が正常に公開されました。
            </p>
            <p className="text-xs text-gray-400 mb-6">
              静的ファイルを out/ ディレクトリにエクスポートしました。
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => router.push(`/dashboard/articles/${articleId}`)}
                className="w-full px-4 py-2.5 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
              >
                記事を見る
              </button>
              <button
                onClick={() => router.push('/dashboard/articles')}
                className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                ダッシュボードに戻る
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
