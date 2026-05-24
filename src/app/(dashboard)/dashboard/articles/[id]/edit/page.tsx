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
import {
  replaceImagePlaceholders,
  type ImageFileRow,
} from '@/lib/zero-gen/replace-placeholders';
import { injectImagePlaceholders } from '@/lib/zero-gen/inject-placeholders';
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
        // P5-51: Supabase Auth cookie を同一オリジンで送信するため明示
        const res = await fetch(`/api/articles/${articleId}`, {
          method: 'PUT',
          credentials: 'same-origin',
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
        // P5-51: Supabase Auth cookie を同一オリジンで送信するため明示
        const res = await fetch(`/api/articles/${articleId}`, { credentials: 'same-origin' });
        if (!res.ok) throw new Error('記事の取得に失敗しました');
        const json = await res.json();
        const a = json.data as Article;
        setArticle(a);
        setTitle(a.title ?? '');
        setSlug(a.slug ?? '');
        setMetaDescription(a.meta_description ?? '');
        setKeyword(a.keyword ?? '');
        setTheme(a.theme ?? '');
        // P5-30: edit view は stage2_body_html のみ使用。
        // stage3_final_html は FTP エクスポート用の完全 HTML (header/sidebar/footer
        // 含む 30K chars) で、編集には不適。P5-24 で stage3 が自動生成される
        // ようになって以降、edit view が template を本文として表示する不具合が
        // 発生していた。stage3 は publish 時に必要に応じて regenerate する。
        const stage2 = (a.stage2_body_html ?? '').trim();
        let html = stage2.length > 0 ? a.stage2_body_html! : '';
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
  // P5-30: 編集された本文は stage2_body_html に保存。
  // stage3_final_html は FTP 用の完全 HTML テンプレートを保持するため、
  // ここで上書きすると template が壊れる。stage3 は publish 時の deploy step で
  // 必要に応じて regenerate する設計に変更。
  const autoSaveData = article
    ? {
        title: title || undefined,
        slug: slug || undefined,
        meta_description: metaDescription || undefined,
        keyword,
        theme,
        stage2_body_html: bodyHtml,
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
      // P5-51: Supabase Auth cookie を同一オリジンで送信するため明示
      // 注意: published_at は **意図的に送らない**。
      //   D1 invariant INV4 (articles_inv4_published_at_constrains_visibility) が
      //   「published_at IS NOT NULL ⇒ visibility_state ∈ {live, live_hub_stale, unpublished, deploying, failed}」
      //   を要求する。この時点ではまだ visibility_state は pending_review/idle 等なので
      //   published_at を先送りすると CHECK 制約違反で 500。
      //   published_at は次ステップの POST /transition が
      //   status=published / visibility_state=live / is_hub_visible=true と
      //   同時に 1 UPDATE で書き込み、INV2/INV4 を同時に満たす。
      const updateRes = await fetch(`/api/articles/${articleId}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...autoSaveData,
          published_html: bodyHtml,
        }),
      });
      if (!updateRes.ok) throw new Error('記事の保存に失敗しました');

      // 2. ステータス遷移: editing → published
      // P5-51: Supabase Auth cookie を同一オリジンで送信するため明示
      const transitionRes = await fetch(`/api/articles/${articleId}/transition`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        // guard-approved: HTTP request body の literal。サーバ側 /api/articles/[id]/transition で transition-validator (guardPublishAttempt/guardArticleTransition) が gate 検証する
        body: JSON.stringify({ status: 'published' }),
      });
      if (!transitionRes.ok) {
        const errJson = await transitionRes.json().catch(() => ({}));
        throw new Error(errJson?.error ?? 'ステータス遷移に失敗しました');
      }

      // バックグラウンドでFTPに自動アップロード（失敗しても公開は成功扱い）
      // P5-51: Supabase Auth cookie を同一オリジンで送信するため明示
      fetch(`/api/articles/${articleId}/deploy`, {
        method: 'POST',
        credentials: 'same-origin',
      }).then((res) => {
        if (res.ok) {
          console.log('[publish] FTP自動アップロード完了');
        } else {
          console.warn('[publish] FTPアップロード失敗（手動で再試行してください）');
        }
        // eslint-disable-next-line no-restricted-syntax -- FTP 自動アップロードは best-effort、失敗してもUIフローは継続
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
      // P5-51: Supabase Auth cookie を同一オリジンで送信するため明示
      const res = await fetch('/api/export/article', {
        method: 'POST',
        credentials: 'same-origin',
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

  // P5-66: handleApplyImages 完全書き直し。
  // 旧実装は (1) DB 永続化していなかったため auto-save の race で消える、
  // (2) image_files を最新化していなかったため stale データで置換していた、
  // (3) editor 同期が ambiguous で「効かない」ように見える、という 3 つの
  // バグを抱えていた。新仕様:
  //   1. service-role エンドポイント (`GET /api/articles/[id]`) から
  //      cache: 'no-store' で最新の article (image_files 含む) を取得
  //   2. 共通モジュール replaceImagePlaceholders で stage2_body_html を置換
  //   3. PUT /api/articles/[id] で stage2_body_html を即時保存（永続化）
  //   4. setBodyHtml(newHtml) でローカル state 更新
  //      → TipTapEditor の content prop watch useEffect が
  //        editor.commands.setContent(commentsToSpans(newHtml)) を呼び、
  //        editor が同期される（要件 5「editor.commands.setContent」と等価）
  //   5. toast.success(`画像 N 枚を反映しました`)
  //   6. エラー時は toast.error + console.error で可視化
  const handleApplyImages = useCallback(async () => {
    try {
      // P5-66: 最新 article をキャッシュ無視で取得（image_files が最新であることを保証）
      const res = await fetch(`/api/articles/${articleId}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!res.ok) {
        toast.error('記事の取得に失敗しました');
        return;
      }
      const json = await res.json();
      const latest = json.data as Article;
      setArticle(latest);

      const imageFiles = latest.image_files as ImageFileRow[] | null;
      if (!imageFiles || !Array.isArray(imageFiles) || imageFiles.length === 0) {
        toast.error('この記事には画像が登録されていません');
        return;
      }

      // P5-66: 共通モジュールで置換（run-completion.ts と同じ実装）。
      // 起点 HTML は最新 DB の stage2_body_html を優先し、空のときのみ
      // ローカル bodyHtml にフォールバック（未保存編集の保護）。
      const sourceHtml =
        ((latest.stage2_body_html ?? '').trim().length > 0
          ? (latest.stage2_body_html as string)
          : bodyHtml) || '';
      let workingHtml = sourceHtml;
      let replaceResult = replaceImagePlaceholders(workingHtml, imageFiles);
      let { phase1, phase2 } = replaceResult;
      let total = phase1 + phase2;
      let autoInjectInfo: { injected: string[]; skipped: string[] } | null = null;

      // P5-70: 「placeholder 0 件 + image_files >=1」 = AI が IMAGE プレースホルダを
      // 欠落させた状態。orphan 画像を防ぐため cheerio で安全位置に placeholder を
      // 自動注入し、replaceImagePlaceholders を再実行する。
      // 詳細: src/lib/zero-gen/inject-placeholders.ts の冒頭ヘッダ参照。
      if (total === 0 && imageFiles.length > 0) {
        const inject = injectImagePlaceholders(workingHtml, imageFiles);
        autoInjectInfo = { injected: inject.injected, skipped: inject.skipped };
        if (inject.injected.length > 0) {
          workingHtml = inject.html;
          replaceResult = replaceImagePlaceholders(workingHtml, imageFiles);
          phase1 = replaceResult.phase1;
          phase2 = replaceResult.phase2;
          total = phase1 + phase2;
          console.log('[handleApplyImages] image_apply.auto_inject_placeholders', {
            injected: inject.injected,
            skipped: inject.skipped,
            postReplaceTotal: total,
            imageCount: imageFiles.length,
          });
        }
      }

      if (total === 0) {
        // P5-70: auto-inject 後も置換 0 = 致命的エラー (h2 ゼロ等で安全位置なし)。
        // 旧仕様 (toast + return) ではユーザーに伝わらず orphan 確定だったため、
        // critical ログで明示する (CLAUDE.md anti-pattern「fetch エラーを catch で
        // 握り潰すな」より fallback は持たせない)。
        console.error(
          '[handleApplyImages] critical: no replacements after auto-inject',
          {
            imageFiles,
            autoInjectInfo,
            sourceHtmlLength: sourceHtml.length,
          },
        );
        toast.error('画像プレースホルダの自動注入に失敗しました（H2 見出しなし等）');
        return;
      }
      const newHtml = replaceResult.html;

      // P5-66: DB UPDATE — stage2_body_html を即座に永続化（auto-save race 回避）
      const putRes = await fetch(`/api/articles/${articleId}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage2_body_html: newHtml }),
      });
      if (!putRes.ok) {
        const errJson = (await putRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error ?? `保存失敗: HTTP ${putRes.status}`);
      }

      // P5-66: ローカル state 更新 → TipTapEditor の prop-watch useEffect が
      // editor.commands.setContent を発火し editor が同期される。
      setBodyHtml(newHtml);
      setInitialBodyHtml(newHtml);

      console.log('[handleApplyImages] applied:', {
        phase1,
        phase2,
        total,
        imageCount: imageFiles.length,
        autoInjected: autoInjectInfo?.injected ?? [],
      });
      toast.success(
        autoInjectInfo && autoInjectInfo.injected.length > 0
          ? `画像 ${imageFiles.length} 枚を反映しました（プレースホルダ自動注入: ${autoInjectInfo.injected.length} 件）`
          : `画像 ${imageFiles.length} 枚を反映しました`,
      );
    } catch (err) {
      console.error('[handleApplyImages] Error:', err);
      const msg = err instanceof Error ? err.message : '不明なエラー';
      toast.error(`画像反映に失敗しました: ${msg}`);
    }
  }, [articleId, bodyHtml]);

  // ─── P5-66: 記事ロード後の画像自動反映 ──────────────────────────────────
  // ユーザー要件: 記事生成後、毎回「画像反映」ボタンを押すのは煩雑なため
  // article ロード完了直後に handleApplyImages を自動実行する。
  // 無限ループ回避のため articleId 単位で 1 回のみ発火する。
  // 反映必要判定: image_files があり、かつ
  //   - <!--IMAGE:--> もしくは IMAGE: プレースホルダが残存している、または
  //   - <img> タグ数が image_files 件数に満たない
  // のいずれかを満たす場合のみ実行する（既に全件反映済ならスキップ）。
  const autoApplyArticleIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !article) return;
    if (autoApplyArticleIdRef.current === articleId) return;

    const imageFiles = article.image_files as ImageFileRow[] | null;
    if (!imageFiles || !Array.isArray(imageFiles) || imageFiles.length === 0) {
      // 画像なし → 以後判定しない
      autoApplyArticleIdRef.current = articleId;
      return;
    }

    const imgCount = (bodyHtml.match(/<img\b/gi) ?? []).length;
    const hasPlaceholder = /<!--\s*IMAGE:|(?<![\w:])IMAGE[：:][\w.\-]*/i.test(bodyHtml);
    const needsApply = hasPlaceholder || imgCount < imageFiles.length;

    if (!needsApply) {
      autoApplyArticleIdRef.current = articleId;
      return;
    }

    // 1 回のみ発火するよう先にフラグを立てる（handleApplyImages の setBodyHtml で
    // 再実行されるのを防ぐ）。
    autoApplyArticleIdRef.current = articleId;
    handleApplyImages();
  }, [loading, article, articleId, bodyHtml, handleApplyImages]);

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
                      // P5-51: Supabase Auth cookie を同一オリジンで送信するため明示
                      const res = await fetch(`/api/articles/${articleId}`, { credentials: 'same-origin' });
                      if (!res.ok) throw new Error('記事の取得に失敗しました');
                      const json = await res.json();
                      const a = json.data as Article;
                      setArticle(a);
                      setTitle(a.title ?? '');
                      setSlug(a.slug ?? '');
                      setMetaDescription(a.meta_description ?? '');
                      setKeyword(a.keyword ?? '');
                      setTheme(a.theme ?? '');
                      // P5-30: stage2 のみ使用 (stage3 はテンプレート込みで edit に不適)
                      const s2 = (a.stage2_body_html ?? '').trim();
                      setBodyHtml(s2.length > 0 ? a.stage2_body_html! : '');
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
                    // P5-51: Supabase Auth cookie を同一オリジンで送信するため明示
                    await fetch(`/api/articles/${articleId}`, {
                      method: 'PUT',
                      credentials: 'same-origin',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ stage2_body_html: bodyHtml, title, meta_description: metaDescription }),
                    });
                    // P5-51: Supabase Auth cookie を同一オリジンで送信するため明示
                    const res = await fetch(`/api/articles/${articleId}/quality-check`, { method: 'POST', credentials: 'same-origin' });
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
                              onAfter={async (result) => {
                                // P5-65: auto-fix が返した after_html で editor 状態を同期。
                                //        これをやらないと auto-save が古い bodyHtml で
                                //        DB を上書きし、補正が「効かない」ように見える。
                                if (result?.after_html) {
                                  setBodyHtml(result.after_html);
                                }
                                setQualityLoading(true);
                                try {
                                  // P5-51: Supabase Auth cookie を同一オリジンで送信するため明示
                                  const res = await fetch(`/api/articles/${articleId}/quality-check`, { method: 'POST', credentials: 'same-origin' });
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
                                onAfter={async (result) => {
                                  // P5-65: auto-fix が返した after_html で editor 状態を同期。
                                  if (result?.after_html) {
                                    setBodyHtml(result.after_html);
                                  }
                                  setQualityLoading(true);
                                  try {
                                    // P5-51: Supabase Auth cookie を同一オリジンで送信するため明示
                                    const res = await fetch(`/api/articles/${articleId}/quality-check`, { method: 'POST', credentials: 'same-origin' });
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

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={() => setPublishDialogOpen(false)}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                disabled={publishing}
              >
                キャンセル
              </button>
              {/* P5-31: 緊急公開 — 警告のみ無視可能。
                  ※ severity=error は frontend / backend 両方でブロックされる (公開不可)。
                  warning だけ残っている場合に限り、理由を入力して公開できる。 */}
              {(() => {
                const qc = qualityCheck as
                  | {
                      passed?: boolean;
                      errorCount?: number;
                      warningCount?: number;
                      items?: Array<{ id: string; status: string; severity: string }>;
                    }
                  | null;
                const errorCount = qc?.errorCount ?? 0;
                const warningOnly = !!qc && !qc.passed && errorCount === 0 && (qc.warningCount ?? 0) > 0;
                return warningOnly;
              })() && (
                <button
                  type="button"
                  onClick={async () => {
                    const reason = window.prompt(
                      '品質警告を無視して公開する理由を入力してください\n（監査ログに記録されます）',
                    );
                    if (!reason || reason.trim().length === 0) return;
                    // warn item のみ quality_overrides に bulk add（error は対象外）
                    const items = (qualityCheck as Record<string, unknown>).items as
                      | Array<{ id: string; status: string; severity: string }>
                      | undefined;
                    const failingItems = (items ?? []).filter(
                      (i) => (i.status === 'fail' || i.status === 'warn') && i.severity !== 'error',
                    );
                    setPublishing(true);
                    try {
                      // P5-65: bulk override の auto-fix 呼び出しでも失敗を可視化する。
                      // タイムアウト/HTTPエラー/空レスポンス/非JSON応答は toast で通知し、
                      // 後続の transition?force=true による bypass に任せる前にユーザーへ
                      // 状況を伝える (silent failure を撲滅)。processing(setPublishing) は
                      // 外側の try/finally で必ず false にリセットされる。
                      for (const it of failingItems) {
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 30_000);
                        try {
                          // P5-51: Supabase Auth cookie を同一オリジンで送信するため明示
                          const r = await fetch(`/api/articles/${articleId}/auto-fix`, {
                            method: 'POST',
                            credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              fix_strategy: 'ignore-warn',
                              check_item_id: it.id,
                              ignore_params: { reason: `[緊急公開] ${reason}` },
                            }),
                            signal: controller.signal,
                          });
                          if (!r.ok) {
                            const errJson = (await r.json().catch(() => ({}))) as { error?: string };
                            throw new Error(errJson.error ?? `HTTP ${r.status}`);
                          }
                          const text = await r.text();
                          if (!text || text.trim().length === 0) {
                            throw new Error('空レスポンス');
                          }
                          try {
                            JSON.parse(text);
                          } catch {
                            throw new Error('JSON 形式ではない応答');
                          }
                        } catch (fixErr) {
                          const reasonMsg =
                            fixErr instanceof Error
                              ? fixErr.name === 'AbortError'
                                ? 'タイムアウト (30s)'
                                : fixErr.message
                              : '不明なエラー';
                          toast.error(`補正失敗: ${reasonMsg}`);
                        } finally {
                          clearTimeout(timeoutId);
                        }
                      }
                      // P5-35: 緊急公開は transition?force=true で backend check も bypass
                      // 通常 handlePublish の transition 呼出を上書きする形で直接実行
                      try {
                        // P5-51: Supabase Auth cookie を同一オリジンで送信するため明示
                        // published_at は送らない (INV4 違反回避 — 通常 handlePublish と同様、
                        // 直後の /transition?force=true が visibility_state='live' と同時に書込む)
                        const updateRes = await fetch(`/api/articles/${articleId}`, {
                          method: 'PUT',
                          credentials: 'same-origin',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            ...autoSaveData,
                            published_html: bodyHtml,
                          }),
                        });
                        if (!updateRes.ok) throw new Error('記事保存に失敗');
                        // P5-51: Supabase Auth cookie を同一オリジンで送信するため明示
                        const transitionRes = await fetch(
                          `/api/articles/${articleId}/transition?force=true`,
                          {
                            method: 'POST',
                            credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/json' },
                            // guard-approved: HTTP request body の literal。サーバ側 /api/articles/[id]/transition で transition-validator が gate 検証する (force=true でも server 側で再検証)
                            body: JSON.stringify({ status: 'published' }),
                          },
                        );
                        if (!transitionRes.ok) {
                          const errJson = await transitionRes.json().catch(() => ({}));
                          throw new Error(errJson?.error ?? `HTTP ${transitionRes.status}`);
                        }
                        // FTP 自動アップロード (best-effort)
                        // P5-51: Supabase Auth cookie を同一オリジンで送信するため明示
                        // eslint-disable-next-line no-restricted-syntax -- FTP 自動デプロイは best-effort、失敗してもDB公開状態は維持される
                        fetch(`/api/articles/${articleId}/deploy`, { method: 'POST', credentials: 'same-origin' }).catch(() => {});
                        setPublishDialogOpen(false);
                        setPublishSuccessOpen(true);
                        toast.success('🚀 緊急公開しました');
                      } catch (e) {
                        toast.error(`緊急公開失敗: ${(e as Error).message}`);
                      }
                    } finally {
                      setPublishing(false);
                    }
                  }}
                  disabled={publishing || qualityLoading}
                  className="px-4 py-2 text-sm rounded-lg border border-orange-400 bg-orange-50 text-orange-800 hover:bg-orange-100 disabled:opacity-50 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-100"
                  title="警告のみ無視して公開（監査ログに記録）。エラーは無視できません。"
                >
                  ⚠️ 警告を無視して公開
                </button>
              )}
              {(() => {
                const qc = qualityCheck as
                  | { passed?: boolean; errorCount?: number; warningCount?: number }
                  | null;
                const errorCount = qc?.errorCount ?? 0;
                const hasError = !!qc && errorCount > 0;
                const failedNotError = !!qc && !qc.passed && !hasError; // warn 残りのみ
                const disabled =
                  publishing || qualityLoading || hasError || failedNotError;
                const label = publishing
                  ? '公開中...'
                  : hasError
                    ? `公開不可 (要修正: ${errorCount}件)`
                    : failedNotError
                      ? '警告残り — 上のボタンで公開'
                      : '公開する';
                const title = hasError
                  ? '品質チェックでエラーが検出されました。エラーを修正してください（警告はこの方法では無視できません）'
                  : failedNotError
                    ? '警告のみ残っています。「警告を無視して公開」ボタンを使用してください'
                    : '';
                return (
                  <button
                    onClick={handlePublish}
                    disabled={disabled}
                    className={`px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-50 ${
                      hasError || failedNotError
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-brand-600 text-white hover:bg-brand-700'
                    }`}
                    title={title}
                  >
                    {label}
                  </button>
                );
              })()}
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
