// @ts-nocheck
// ============================================================================
// src/app/(dashboard)/dashboard/articles/[id]/page.tsx
// 記事詳細/概要ページ
// ============================================================================
'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { Article, ArticleStatus } from '@/types/article';
import StatusBadge from '@/components/common/StatusBadge';
import GenerationModeBadge from '@/components/articles/GenerationModeBadge';
// P5-43 Step 2: 公開判定を visibility_state ベースに統一
import { isPubliclyVisible } from '@/lib/publish-control/visibility-predicate';

// ─── ステータスラベル ──────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ArticleStatus, string> = {
  draft: '下書き',
  outline_pending: 'アウトライン確認待ち',
  outline_approved: 'アウトライン承認済み',
  body_generating: '本文生成中',
  body_review: '本文レビュー',
  editing: '編集中',
  published: '公開済み',
};

const THEME_LABELS: Record<string, string> = {
  soul_mission: '魂の使命',
  relationships: '人間関係',
  grief_care: 'グリーフケア',
  self_growth: '自己成長',
  healing: 'ヒーリング',
  daily_awareness: '日常の気づき',
  spiritual_intro: 'スピリチュアル入門',
};

const PERSONA_LABELS: Record<string, string> = {
  spiritual_beginner: 'スピリチュアル初心者',
  self_growth_seeker: '自己成長志向の人',
  grief_sufferer: '悲嘆を抱えている人',
  meditation_practitioner: '瞑想実践者',
  energy_worker: 'エネルギーワーカー',
  life_purpose_seeker: '人生の目的を探している人',
  holistic_health_seeker: 'ホリスティック健康志向',
};

// ─── タイムライン ──────────────────────────────────────────────────────────────

const STATUS_ORDER: ArticleStatus[] = [
  'draft',
  'outline_pending',
  'outline_approved',
  'body_generating',
  'body_review',
  'editing',
  'published',
];

function StatusTimeline({ currentStatus }: { currentStatus: ArticleStatus }) {
  const currentIndex = STATUS_ORDER.indexOf(currentStatus);

  return (
    <div className="flex items-center gap-1 overflow-x-auto py-2">
      {STATUS_ORDER.map((status, idx) => {
        const isCompleted = idx < currentIndex;
        const isCurrent = idx === currentIndex;

        return (
          <div key={status} className="flex items-center">
            {idx > 0 && (
              <div
                className={`h-0.5 w-6 ${
                  isCompleted ? 'bg-brand-500' : 'bg-slate-200'
                }`}
              />
            )}
            <div className="flex flex-col items-center">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                  isCurrent
                    ? 'bg-brand-500 text-white ring-4 ring-brand-100'
                    : isCompleted
                      ? 'bg-brand-500 text-white'
                      : 'bg-slate-200 text-slate-400'
                }`}
              >
                {isCompleted ? (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  idx + 1
                )}
              </div>
              <span
                className={`mt-1 max-w-[70px] text-center text-[10px] leading-tight ${
                  isCurrent
                    ? 'font-bold text-brand-700'
                    : isCompleted
                      ? 'text-brand-500'
                      : 'text-slate-400'
                }`}
              >
                {STATUS_LABELS[status]}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── メインコンポーネント ─────────────────────────────────────────────────────

export default function ArticleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const articleId = params.id as string;

  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [imagePromptLoading, setImagePromptLoading] = useState(false);
  const [imageGenLoading, setImageGenLoading] = useState(false);
  const [ftpUploading, setFtpUploading] = useState(false);
  const [ftpResult, setFtpResult] = useState<string | null>(null);
  const [qualityCheck, setQualityCheck] = useState<Record<string, unknown> | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [revisions, setRevisions] = useState<Array<{
    id: string;
    created_at: string;
    change_type: string;
    html_snapshot?: string;
  }>>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // ─── データ取得 ─────────────────────────────────────────────────────────

  const fetchArticle = useCallback(async () => {
    try {
      const res = await fetch(`/api/articles/${articleId}`);
      if (!res.ok) throw new Error('記事の取得に失敗しました');
      const json = await res.json();
      setArticle(json.data as Article);
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期せぬエラー');
    } finally {
      setLoading(false);
    }
  }, [articleId]);

  const fetchRevisions = useCallback(async () => {
    setRevisionsLoading(true);
    try {
      const res = await fetch(`/api/articles/${articleId}/revisions`);
      if (!res.ok) return;
      const json = await res.json();
      setRevisions((json.data ?? json.revisions ?? json) as typeof revisions);
    } catch {
      // リビジョン取得エラーは無視
    } finally {
      setRevisionsLoading(false);
    }
  }, [articleId]);

  const handleRestore = async (revisionId: string) => {
    if (!window.confirm('このバージョンに復元しますか？現在の内容は上書きされます。')) return;
    setRestoreLoading(revisionId);
    try {
      const res = await fetch(`/api/articles/${articleId}/revisions/${revisionId}/restore`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('復元に失敗しました');
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '復元エラー');
    } finally {
      setRestoreLoading(null);
    }
  };

  useEffect(() => {
    fetchArticle();
    fetchRevisions();
  }, [fetchArticle, fetchRevisions]);

  // ─── 仕上げ中ポーリング (P5-25) ────────────────────────────────────────
  // body_generating だけでなく、zero-gen 記事で「Stage2 完了済だが画像未反映」
  // のとき (= runZeroGenCompletion が裏で走っている期間) も自動更新する。
  // 条件: generation_mode='zero' AND stage2 あり AND image_files 空 AND
  //       作成 5 分以内
  useEffect(() => {
    if (!article) return;
    const isBodyGenerating = article.status === 'body_generating';
    const imageCount = Array.isArray(article.image_files)
      ? (article.image_files as unknown[]).length
      : 0;
    const createdMs = article.created_at
      ? Date.now() - new Date(article.created_at).getTime()
      : Infinity;
    const isFinalizingZeroGen =
      article.generation_mode === 'zero' &&
      Boolean(article.stage2_body_html) &&
      imageCount === 0 &&
      createdMs < 5 * 60 * 1000;

    if (isBodyGenerating || isFinalizingZeroGen) {
      pollingRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/articles/${articleId}`);
          if (!res.ok) return;
          const json = await res.json();
          const updated = json.data as Article;
          setArticle(updated);
          const newImageCount = Array.isArray(updated.image_files)
            ? (updated.image_files as unknown[]).length
            : 0;
          // 終了条件: status が body_generating でなくなった OR 画像が登録された
          if (
            updated.status !== 'body_generating' &&
            (newImageCount > 0 || !isFinalizingZeroGen)
          ) {
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
          }
        } catch {
          // ポーリング中のエラーは無視
        }
      }, 5000);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [article?.status, articleId]);

  // ─── アウトライン生成 ───────────────────────────────────────────────────

  const handleGenerateOutline = async () => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/ai/generate-outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId }),
      });
      if (!res.ok) throw new Error('アウトライン生成に失敗しました');
      await fetchArticle();
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期せぬエラー');
    } finally {
      setActionLoading(false);
    }
  };

  // ─── 本文生成 ───────────────────────────────────────────────────────────

  const handleGenerateBody = async () => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/ai/generate-body', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId }),
      });
      if (!res.ok) throw new Error('本文生成の開始に失敗しました');
      await fetchArticle();
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期せぬエラー');
    } finally {
      setActionLoading(false);
    }
  };

  // ─── 画像プロンプト生成 ─────────────────────────────────────────────────

  const handleGenerateImagePrompts = async () => {
    setImagePromptLoading(true);
    try {
      const res = await fetch('/api/ai/generate-image-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleId }),
      });
      if (!res.ok) throw new Error('画像プロンプト生成に失敗しました');
      await fetchArticle();
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期せぬエラー');
    } finally {
      setImagePromptLoading(false);
    }
  };

  // ─── 画像生成（プロンプトから画像を生成） ────────────────────────────────

  const handleGenerateImages = async () => {
    setImageGenLoading(true);
    console.log('[image-gen] Starting image generation for article:', articleId);
    try {
      const res = await fetch(`/api/articles/${articleId}/generate-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = await res.json().catch(() => ({}));
      console.log('[image-gen] Response:', { status: res.status, body });
      if (!res.ok) {
        const errMsg = body.error || body.message || '画像生成に失敗しました';
        console.error('[image-gen] Error:', errMsg);
        throw new Error(errMsg);
      }
      console.log('[image-gen] Success:', body);
      alert(`画像生成完了: ${body.images?.length ?? 0}枚の画像を生成しました`);
      await fetchArticle();
    } catch (err) {
      console.error('[image-gen] Exception:', err);
      setError(err instanceof Error ? err.message : '予期せぬエラー');
    } finally {
      setImageGenLoading(false);
    }
  };

  // ─── FTPアップロード ────────────────────────────────────────────────────

  const handleFtpUpload = async () => {
    setFtpUploading(true);
    setFtpResult(null);
    console.log('[ftp] Starting FTP upload for article:', articleId);
    try {
      const res = await fetch(`/api/articles/${articleId}/deploy`, { method: 'POST' });
      const data = await res.json();
      console.log('[ftp] Response:', data);
      if (!res.ok) throw new Error(data.error || 'FTPアップロードに失敗しました');
      setFtpResult(`✓ ${data.message}`);
      setTimeout(() => setFtpResult(null), 5000);
    } catch (err) {
      console.error('[ftp] Error:', err);
      setFtpResult(`✗ ${err instanceof Error ? err.message : 'エラー'}`);
      setTimeout(() => setFtpResult(null), 8000);
    } finally {
      setFtpUploading(false);
    }
  };

  // ─── 品質チェック実行 ────────────────────────────────────────────────────

  const handleQualityCheck = async () => {
    setQualityLoading(true);
    try {
      const res = await fetch(`/api/articles/${articleId}/quality-check`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '品質チェックに失敗しました');
      setQualityCheck(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期せぬエラー');
    } finally {
      setQualityLoading(false);
    }
  };

  // ─── ローディング / エラー ──────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-500" />
          <p className="text-sm text-brand-600">記事情報を読み込み中...</p>
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
            onClick={() => {
              setError(null);
              setLoading(true);
              fetchArticle();
            }}
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="mx-auto max-w-3xl py-10 text-center">
        <p className="text-slate-500">記事が見つかりません。</p>
        <button
          className="mt-4 text-sm text-brand-500 underline hover:text-brand-700"
          onClick={() => router.push('/dashboard/articles')}
        >
          記事一覧へ戻る
        </button>
      </div>
    );
  }

  const outline = article.stage1_outline;
  const seoScore = article.seo_score as Record<string, unknown> | null;

  // ─── アクションボタン ───────────────────────────────────────────────────

  function renderActionButton(): JSX.Element | null {
    if (!article) return null;

    switch (article.status) {
      case 'draft':
        return (
          <button
            className="w-full rounded-lg bg-brand-500 px-6 py-3 text-sm font-bold text-white shadow-md transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:py-2.5"
            onClick={handleGenerateOutline}
            disabled={actionLoading}
          >
            {actionLoading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                生成中...
              </span>
            ) : (
              'アウトライン生成'
            )}
          </button>
        );

      case 'outline_pending':
        return (
          <button
            className="w-full rounded-lg bg-brand-500 px-6 py-3 text-sm font-bold text-white shadow-md transition-colors hover:bg-brand-600 sm:w-auto sm:py-2.5"
            onClick={() => router.push(`/dashboard/articles/${articleId}/outline`)}
          >
            アウトラインを確認 →
          </button>
        );

      case 'outline_approved':
        return (
          <button
            className="w-full rounded-lg bg-brand-500 px-6 py-3 text-sm font-bold text-white shadow-md transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:py-2.5"
            onClick={handleGenerateBody}
            disabled={actionLoading}
          >
            {actionLoading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                生成開始中...
              </span>
            ) : (
              '本文生成'
            )}
          </button>
        );

      case 'body_generating':
        return (
          <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-5 py-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600" />
            <div>
              <p className="text-sm font-medium text-amber-800">本文を生成しています...</p>
              <p className="text-xs text-amber-600">完了すると自動で更新されます</p>
            </div>
          </div>
        );

      case 'body_review':
        return (
          <button
            className="w-full rounded-lg bg-brand-500 px-6 py-3 text-sm font-bold text-white shadow-md transition-colors hover:bg-brand-600 sm:w-auto sm:py-2.5"
            onClick={() => router.push(`/dashboard/articles/${articleId}/review`)}
          >
            レビュー →
          </button>
        );

      case 'editing':
        return (
          <button
            className="w-full rounded-lg bg-brand-500 px-6 py-3 text-sm font-bold text-white shadow-md transition-colors hover:bg-brand-600 sm:w-auto sm:py-2.5"
            onClick={() => router.push(`/dashboard/articles/${articleId}/edit`)}
          >
            編集 →
          </button>
        );

      case 'published':
        return (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
            {article.published_url && (
              <a
                href={article.published_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-500 px-6 py-3 text-sm font-bold text-white shadow-md transition-colors hover:bg-green-600 sm:py-2.5"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                公開URLを開く
              </a>
            )}
            <button
              className="w-full rounded-lg border border-brand-200 px-5 py-3 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-50 sm:w-auto sm:py-2.5"
              onClick={() => router.push(`/dashboard/articles/${articleId}/edit`)}
            >
              再編集
            </button>
            {!article.published_url && (
              <span className="text-sm text-green-600 font-medium">公開済み</span>
            )}
          </div>
        );

      default:
        return null;
    }
  }

  // ─── レンダリング ───────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 sm:space-y-6 sm:px-0">
      {/* ─ ヘッダー ─ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={article.status} />
            <span className="text-xs text-slate-400">
              作成: {new Date(article.created_at).toLocaleDateString('ja-JP')}
            </span>
            <span className="text-xs text-slate-400">
              更新: {new Date(article.updated_at).toLocaleDateString('ja-JP')}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-brand-800 sm:text-2xl">
              {article.title || '（タイトル未設定）'}
            </h1>
            <GenerationModeBadge mode={article.generation_mode} size="md" />
          </div>
        </div>
        <button
          className="shrink-0 self-start rounded-lg border border-brand-200 px-4 py-2 text-sm text-brand-600 hover:bg-brand-50"
          onClick={() => router.push('/dashboard/articles')}
        >
          ← 一覧へ戻る
        </button>
      </div>

      {/* P5-33: ステータス遷移 + 次のアクションは legacy 7 ステップ
          (draft → outline_pending → outline_approved → body_generating →
           body_review → editing → published) で source-base 記事用。
          zero-gen は INSERT 時に draft、生成完了後も draft、publish で published と
          直接遷移するため、legacy stepper に当てはまらない。
          generation_mode='zero' のときは zero-gen 専用の簡潔ステータス表示に置換。 */}
      {article.generation_mode === 'zero' ? (
        <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand-500">
            ステータス
          </h2>
          {(() => {
            const status = article.status;
            const imageCount = Array.isArray(article.image_files)
              ? (article.image_files as unknown[]).length
              : 0;
            const hasStage2 = Boolean(article.stage2_body_html);
            const hasStage3 = Boolean(article.stage3_final_html);
            const isFullyReady = hasStage2 && hasStage3 && imageCount >= 1;
            const stages = [
              { key: 'draft', label: '下書き', done: true },
              { key: 'generated', label: '本文生成', done: hasStage2 },
              { key: 'images', label: '画像生成', done: imageCount >= 1 },
              { key: 'finalized', label: '仕上げ完了', done: isFullyReady && status !== 'body_generating' },
              { key: 'published', label: '公開済み', done: status === 'published' },
            ];
            return (
              <div className="flex flex-wrap items-center gap-3">
                {stages.map((s, i) => (
                  <div key={s.key} className="flex items-center gap-2">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                        s.done
                          ? 'bg-brand-500 text-white'
                          : 'bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                      }`}
                    >
                      {s.done ? '✓' : i + 1}
                    </span>
                    <span
                      className={`text-xs ${s.done ? 'font-medium text-gray-700 dark:text-gray-200' : 'text-gray-400'}`}
                    >
                      {s.label}
                    </span>
                    {i < stages.length - 1 && (
                      <span className="text-gray-300 dark:text-gray-600">—</span>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            ゼロ生成は Stage1〜Stage4 (画像/Stage3) を一気通貫で実行します。
            完了後は「公開」ボタンで即公開可能です。
          </p>
          {/* P5-41: ゼロ生成記事にも編集/公開導線を追加。
              これが無いと品質チェック不合格時に詳細画面から脱出できなくなる。 */}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => router.push(`/dashboard/articles/${articleId}/edit`)}
              className="rounded-lg bg-brand-500 px-5 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-600"
            >
              編集 / 公開へ →
            </button>
            {article.status === 'published' && article.published_url && (
              <a
                href={article.published_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-green-500 px-5 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-green-600"
              >
                公開URLを開く
              </a>
            )}
          </div>
        </section>
      ) : (
        <>
          {/* ─ Legacy ステータスタイムライン (source-base 記事用) ─ */}
          <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand-500">
              ステータス遷移
            </h2>
            <StatusTimeline currentStatus={article.status} />
          </section>

          {/* ─ 次のアクション (source-base 記事用) ─ */}
          <section className="flex flex-col gap-4 rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-500">
                次のアクション
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                現在のステータス: {String(STATUS_LABELS[article.status as keyof typeof STATUS_LABELS] ?? article.status)}
              </p>
            </div>
            <div className="w-full sm:w-auto">{renderActionButton()}</div>
          </section>
        </>
      )}

      {/* ─ FTPデプロイ ─ */}
      {article.status === 'published' && (
        <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-500">FTPデプロイ</h2>
              <p className="text-xs text-gray-400 mt-1">この記事をFTPサーバーにアップロードします（index.html更新含む）</p>
            </div>
            <button
              onClick={handleFtpUpload}
              disabled={ftpUploading}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {ftpUploading ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  アップロード中...
                </>
              ) : (
                '🚀 FTPアップロード'
              )}
            </button>
          </div>
          {ftpResult && (
            <p className={`mt-2 text-xs ${ftpResult.startsWith('✓') ? 'text-emerald-600' : 'text-red-500'}`}>
              {ftpResult}
            </p>
          )}
        </section>
      )}

      {/* ─ 由起子さん確認 ─ */}
      {article.status === 'published' && (
        <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-500">由起子さん確認</h2>
              {/* P5-43 Step 2: 「公開中」表示判定を visibility_state ベース (isPubliclyVisible) に変更。日時表示は audit 目的で reviewed_at をそのまま表示 */}
              {isPubliclyVisible(article as { visibility_state?: string | null }) ? (
                <p className="text-xs text-emerald-600 mt-1">
                  ✅ 確認済み（{(article as Record<string, unknown>).reviewed_at ? new Date(String((article as Record<string, unknown>).reviewed_at)).toLocaleDateString('ja-JP') : '—'}）
                  {(article as Record<string, unknown>).reviewed_by && ` by ${(article as Record<string, unknown>).reviewed_by}`}
                </p>
              ) : (
                <p className="text-xs text-amber-500 mt-1">⏳ 未確認</p>
              )}
            </div>
            <button
              onClick={async () => {
                // P5-43 Step 3 (writers migration): PUT /api/articles/[id] による
                // reviewed_at 直接更新を廃止し、新 review API へ切替。
                // 状態判定は visibility_state ベース (isPubliclyVisible)、
                // approve/reject は publish-control state-machine が遷移可否を保証する。
                const reviewed = isPubliclyVisible(article as { visibility_state?: string | null });
                const action = reviewed ? 'reject' : 'approve';
                // ULID (Crockford base32 / 26 chars) — PublishButton.tsx と同一実装
                const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
                const encodeCrockford = (num: number, len: number): string => {
                  let s = '';
                  for (let i = 0; i < len; i++) {
                    s = CROCKFORD[num % 32] + s;
                    num = Math.floor(num / 32);
                  }
                  return s;
                };
                const ulid = (): string => {
                  const t = encodeCrockford(Date.now(), 10);
                  const r = Array.from({ length: 16 }, () =>
                    CROCKFORD.charAt(Math.floor(Math.random() * 32)),
                  ).join('');
                  return (t + r).slice(0, 26);
                };
                try {
                  const res = await fetch(`/api/articles/${articleId}/review`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action, requestId: ulid() }),
                  });
                  if (res.ok) await fetchArticle();
                } catch { /* ignore */ }
              }}
              className={`rounded-lg px-4 py-2 text-xs font-medium flex items-center gap-2 ${
                isPubliclyVisible(article as { visibility_state?: string | null })
                  ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700'
              }`}
            >
              {isPubliclyVisible(article as { visibility_state?: string | null }) ? '確認を取消' : '✅ 確認済みにする'}
            </button>
          </div>
        </section>
      )}

      {/* ─ バージョン履歴 ─ */}
      <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand-500">
          バージョン履歴（直近3件）
        </h2>

        {revisionsLoading ? (
          <div className="flex items-center gap-2 py-4">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-500" />
            <span className="text-xs text-slate-400">読み込み中...</span>
          </div>
        ) : revisions.length === 0 ? (
          <p className="text-sm text-slate-400">バージョン履歴はまだありません。</p>
        ) : (
          <div className="divide-y divide-brand-100 rounded-lg border border-brand-100 overflow-hidden">
            {revisions.slice(0, 3).map((rev, idx) => {
              const revNumber = revisions.length - idx;
              const dateStr = new Date(rev.created_at).toLocaleString('ja-JP', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              });
              const changeTypeLabels: Record<string, string> = {
                manual: '手動保存',
                auto: '自動',
                ai_generated: 'AI生成',
                restore: '復元',
                publish: '公開',
              };
              const changeLabel = changeTypeLabels[rev.change_type] ?? rev.change_type ?? '不明';
              const changeBadgeColor: Record<string, string> = {
                manual: 'bg-blue-100 text-blue-700',
                auto: 'bg-slate-100 text-slate-600',
                ai_generated: 'bg-purple-100 text-purple-700',
                restore: 'bg-amber-100 text-amber-700',
                publish: 'bg-green-100 text-green-700',
              };
              const badgeClass = changeBadgeColor[rev.change_type] ?? 'bg-slate-100 text-slate-600';

              // Strip HTML tags for preview
              const plainText = rev.html_snapshot
                ? rev.html_snapshot.replace(/<[^>]*>/g, '').slice(0, 100)
                : '';

              return (
                <div key={rev.id} className="px-4 py-3 hover:bg-brand-50/50 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-brand-700">#{revNumber}</span>
                      <span className="text-xs text-slate-500">{dateStr}</span>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${badgeClass}`}>
                        {changeLabel}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRestore(rev.id)}
                      disabled={restoreLoading === rev.id}
                      className="shrink-0 rounded-lg border border-brand-200 px-3 py-1.5 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {restoreLoading === rev.id ? (
                        <span className="flex items-center gap-1">
                          <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-300 border-t-brand-600" />
                          復元中...
                        </span>
                      ) : (
                        '復元'
                      )}
                    </button>
                  </div>
                  {plainText && (
                    <p className="mt-1 text-xs text-slate-400 line-clamp-1">{plainText}...</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ─ 品質チェックリスト ─ */}
      {(article.stage2_body_html || article.published_html) && (
        <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-500">
                品質チェックリスト
              </h2>
              {qualityCheck && (
                <p className="text-xs mt-1">
                  <span className={`font-bold ${(qualityCheck as Record<string, unknown>).passed ? 'text-emerald-600' : 'text-red-500'}`}>
                    {(qualityCheck as Record<string, unknown>).passed ? '合格' : '不合格'}
                  </span>
                  <span className="text-slate-400 ml-2">
                    スコア: {String((qualityCheck as Record<string, unknown>).score)}/100
                    {' | '}エラー: {String((qualityCheck as Record<string, unknown>).errorCount)}件
                    {' | '}警告: {String((qualityCheck as Record<string, unknown>).warningCount)}件
                  </span>
                </p>
              )}
            </div>
            <button
              onClick={handleQualityCheck}
              disabled={qualityLoading}
              className="rounded-lg bg-brand-500 px-4 py-2 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {qualityLoading ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  チェック中...
                </>
              ) : (
                'チェック実行'
              )}
            </button>
          </div>

          {qualityCheck && (
            <div className="space-y-3">
              {/* サマリ */}
              <div className={`rounded-lg px-4 py-3 text-sm ${(qualityCheck as Record<string, unknown>).passed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {String((qualityCheck as Record<string, unknown>).summary)}
              </div>

              {/* チェック項目一覧 */}
              {(() => {
                const items = (qualityCheck as Record<string, unknown>).items as Array<{
                  id: string; category: string; label: string;
                  status: string; severity: string; detail?: string; value?: string | number;
                }>;
                if (!items) return null;

                // カテゴリ別にグループ化
                const groups: Record<string, typeof items> = {};
                for (const item of items) {
                  if (!groups[item.category]) groups[item.category] = [];
                  groups[item.category].push(item);
                }

                return Object.entries(groups).map(([category, groupItems]) => (
                  <div key={category} className="rounded-lg border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 px-4 py-2">
                      <span className="text-xs font-semibold text-slate-600">{category}</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {groupItems.map((item) => (
                        <div key={item.id} className="flex items-start gap-3 px-4 py-2.5">
                          <span className="mt-0.5 shrink-0 text-base">
                            {item.status === 'pass' ? '\u2705' : item.status === 'warn' ? '\u26A0\uFE0F' : '\u274C'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-slate-700">{item.label}</p>
                            {item.detail && (
                              <p className={`text-xs mt-0.5 ${
                                item.status === 'fail' ? 'text-red-500' : item.status === 'warn' ? 'text-amber-600' : 'text-slate-400'
                              }`}>
                                {item.detail}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}

              {/* チェック日時 */}
              <p className="text-xs text-slate-400 text-right">
                チェック日時: {new Date(String((qualityCheck as Record<string, unknown>).checkedAt)).toLocaleString('ja-JP')}
              </p>
            </div>
          )}

          {!qualityCheck && (
            <p className="text-sm text-slate-400">「チェック実行」ボタンを押すと、17項目の品質チェックを実行します。</p>
          )}
        </section>
      )}

      {/* ─ メタ情報 ─ */}
      <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-brand-500">
          メタ情報
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-slate-400">キーワード</p>
            <p className="mt-1 text-sm font-medium text-brand-700">{article.keyword}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400">テーマ</p>
            <p className="mt-1 text-sm font-medium text-brand-700">
              {THEME_LABELS[article.theme] ?? article.theme}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400">ペルソナ</p>
            <p className="mt-1 text-sm font-medium text-brand-700">
              {PERSONA_LABELS[article.persona] ?? article.persona}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-400">目標文字数</p>
            <p className="mt-1 text-sm font-medium text-brand-700">
              {article.target_word_count?.toLocaleString() ?? '---'}字
            </p>
          </div>
          {article.perspective_type && (
            <div>
              <p className="text-xs font-medium text-slate-400">視点タイプ</p>
              <p className="mt-1 text-sm font-medium text-brand-700">{article.perspective_type}</p>
            </div>
          )}
          {article.slug && (
            <div>
              <p className="text-xs font-medium text-slate-400">スラッグ</p>
              <p className="mt-1 text-sm font-mono text-brand-700">{article.slug}</p>
            </div>
          )}
        </div>
      </section>

      {/* ─ SEO / AIO スコア ─ */}
      {seoScore && (
        <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-brand-500">
            SEO / AIO スコア
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            {Object.entries(seoScore).map(([key, value]) => (
              <div key={key} className="rounded-lg bg-brand-50 p-3 text-center">
                <p className="text-[10px] text-slate-500 sm:text-xs">{key}</p>
                <p className="mt-1 text-base font-bold text-brand-700 sm:text-lg">
                  {typeof value === 'number' ? value : String(value)}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─ CTA文言プレビュー ─ */}
      {article.cta_texts && Array.isArray(article.cta_texts) && (article.cta_texts as string[]).length > 0 && (
        <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand-500">
            CTA文言
          </h2>
          <div className="space-y-2">
            {(article.cta_texts as string[]).map((text, idx) => (
              <p
                key={idx}
                className="rounded-lg bg-brand-50 px-4 py-3 text-sm italic text-brand-600"
              >
                &ldquo;{text}&rdquo;
              </p>
            ))}
          </div>
        </section>
      )}

      {/* ─ アウトラインからのCTA文言（stage1_outline） ─ */}
      {outline?.cta_texts && outline.cta_texts.length > 0 && !article.cta_texts && (
        <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand-500">
            CTA文言（アウトライン）
          </h2>
          <div className="space-y-2">
            {outline.cta_texts.map((text, idx) => (
              <p
                key={idx}
                className="rounded-lg bg-brand-50 px-4 py-3 text-sm italic text-brand-600"
              >
                &ldquo;{text}&rdquo;
              </p>
            ))}
          </div>
        </section>
      )}

      {/* ─ 画像プロンプト ─ */}
      <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-500">
            画像プロンプト
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-lg border border-brand-200 px-4 py-2 text-xs font-medium text-brand-600 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleGenerateImagePrompts}
              disabled={imagePromptLoading || imageGenLoading}
            >
              {imagePromptLoading ? (
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-300 border-t-brand-600" />
                  生成中...
                </span>
              ) : (
                '画像プロンプト生成'
              )}
            </button>
            {/* 画像プロンプトが存在する場合のみ画像生成ボタンを表示 */}
            {(article.image_prompts && Array.isArray(article.image_prompts) && (article.image_prompts as unknown[]).length > 0) && (
              <button
                className="rounded-lg bg-brand-500 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleGenerateImages}
                disabled={imageGenLoading || imagePromptLoading}
              >
                {imageGenLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    画像生成中...
                  </span>
                ) : (
                  '画像を生成'
                )}
              </button>
            )}
          </div>
        </div>

        {/* 記事直下の画像プロンプト */}
        {article.image_prompts && Array.isArray(article.image_prompts) && (article.image_prompts as unknown[]).length > 0 ? (
          <ul className="space-y-2">
            {(article.image_prompts as Array<{ heading_text?: string; prompt?: string; section_id?: string }>).map((img, idx) => (
              <li
                key={idx}
                className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
              >
                {img.heading_text && (
                  <p className="text-sm font-medium text-brand-700">{img.heading_text}</p>
                )}
                {img.prompt && (
                  <p className="mt-1 text-xs text-slate-500">{img.prompt}</p>
                )}
              </li>
            ))}
          </ul>
        ) : outline?.image_prompts && outline.image_prompts.length > 0 ? (
          <div>
            <p className="mb-2 text-xs text-slate-400">アウトラインの画像プロンプト:</p>
            <ul className="space-y-2">
              {outline.image_prompts.map((img, idx) => (
                <li
                  key={idx}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <p className="text-sm font-medium text-brand-700">{img.heading_text}</p>
                  <p className="mt-1 text-xs text-slate-500">{img.prompt}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-slate-400">画像プロンプトはまだありません。</p>
        )}
      </section>

      {/* ─ P5-25: 仕上げ中のヒント表示 ─ */}
      {(() => {
        const imageCount = Array.isArray(article.image_files) ? (article.image_files as unknown[]).length : 0;
        const createdMs = article.created_at ? Date.now() - new Date(article.created_at).getTime() : Infinity;
        const isFinalizing =
          article.generation_mode === 'zero' &&
          Boolean(article.stage2_body_html) &&
          imageCount === 0 &&
          createdMs < 5 * 60 * 1000;
        if (!isFinalizing) return null;
        return (
          <section className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 shadow-sm dark:border-amber-700 dark:bg-amber-950/30">
            <div className="flex items-center gap-3">
              <span className="inline-block h-3 w-3 shrink-0 animate-pulse rounded-full bg-amber-500" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
                  🎨 画像/Stage3 仕上げ中
                </p>
                <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-200">
                  バックグラウンドで実画像 3 枚を生成中です。約 1-2 分でこの画面に自動反映されます。
                </p>
              </div>
            </div>
          </section>
        );
      })()}

      {/* ─ 生成済み画像 ─ */}
      {article.image_files && Array.isArray(article.image_files) && (article.image_files as Array<{ url: string; alt?: string; position?: string }>).length > 0 && (
        <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand-500">
            生成済み画像
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {(article.image_files as Array<{ url: string; alt?: string; position?: string }>).map((img, idx) => (
              <div key={idx} className="overflow-hidden rounded-lg border border-brand-100">
                <img
                  src={img.url}
                  alt={img.alt || img.position || ''}
                  className="h-40 w-full object-cover"
                  loading="lazy"
                />
                <div className="px-3 py-2">
                  <span className="text-xs font-medium text-brand-500 uppercase">{img.position}</span>
                  {img.alt && <p className="mt-1 text-xs text-slate-500 line-clamp-2">{img.alt}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─ FAQ ─ */}
      {(article.faq_data || outline?.faq) && (
        <section className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand-500">
            FAQ（よくある質問）
          </h2>
          <div className="space-y-3">
            {(() => {
              const faqItems = (article.faq_data as Array<{ question: string; answer: string }>) ?? outline?.faq ?? [];
              return faqItems.map((item, idx) => (
                <div key={idx} className="rounded-lg bg-brand-50 px-4 py-3">
                  <p className="text-sm font-semibold text-brand-800">Q. {item.question}</p>
                  <p className="mt-1 text-sm text-brand-600">A. {item.answer}</p>
                </div>
              ));
            })()}
          </div>
        </section>
      )}
    </div>
  );
}
