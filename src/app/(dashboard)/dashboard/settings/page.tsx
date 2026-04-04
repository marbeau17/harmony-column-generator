// ============================================================================
// src/app/(dashboard)/dashboard/settings/page.tsx
// システム設定ページ — タブ構成（基本/AI/CTA/SEO）
// ============================================================================
'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

interface BasicSettings {
  site_name: string;
  author_name: string;
  author_profile: string;
}

interface AISettings {
  gemini_model: string;
  default_char_count: number;
  default_persona: string;
  default_theme: string;
}

interface CTASettings {
  cta_url: string;
  cta_intro: string;
  cta_middle: string;
  cta_ending: string;
}

interface SEOSettings {
  author_jsonld: string;
  disclaimer: string;
}

type TabKey = 'basic' | 'ai' | 'cta' | 'seo' | 'deploy';

// ─── タブ定義 ────────────────────────────────────────────────────────────────

const TABS: { key: TabKey; label: string }[] = [
  { key: 'basic', label: '基本設定' },
  { key: 'ai', label: 'AI 設定' },
  { key: 'cta', label: 'CTA 設定' },
  { key: 'seo', label: 'SEO 設定' },
  { key: 'deploy', label: 'デプロイ' },
];

// ─── Gemini モデル選択肢 ─────────────────────────────────────────────────────

const GEMINI_MODELS = [
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { value: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
  { value: 'gemini-2.5-flash-preview-04-17', label: 'Gemini 2.5 Flash Preview' },
  { value: 'gemini-2.5-pro-preview-03-25', label: 'Gemini 2.5 Pro Preview' },
];

// ─── デフォルト値 ─────────────────────────────────────────────────────────────

const DEFAULT_BASIC: BasicSettings = {
  site_name: '',
  author_name: '',
  author_profile: '',
};

const DEFAULT_AI: AISettings = {
  gemini_model: 'gemini-2.0-flash',
  default_char_count: 2000,
  default_persona: '',
  default_theme: '',
};

const DEFAULT_CTA: CTASettings = {
  cta_url: 'https://harmony-booking.web.app/',
  cta_intro: '',
  cta_middle: '',
  cta_ending: '',
};

const DEFAULT_SEO: SEOSettings = {
  author_jsonld: '',
  disclaimer: '',
};

// ─── ページコンポーネント ────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('basic');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 各タブのフォーム state
  const [basic, setBasic] = useState<BasicSettings>(DEFAULT_BASIC);
  const [ai, setAI] = useState<AISettings>(DEFAULT_AI);
  const [cta, setCTA] = useState<CTASettings>(DEFAULT_CTA);
  const [seo, setSEO] = useState<SEOSettings>(DEFAULT_SEO);

  // デプロイタブ用 state
  const [deploying, setDeploying] = useState<'idle' | 'rebuild' | 'ftp'>('idle');
  const [deployMessage, setDeployMessage] = useState<string | null>(null);

  const handleRebuild = async () => {
    setDeploying('rebuild');
    setDeployMessage(null);
    try {
      const res = await fetch('/api/hub/rebuild', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'ハブページ再生成に失敗しました');
      setDeployMessage(`ハブページ再生成完了: ${data?.generated ?? 0} ファイル生成`);
    } catch (err: any) {
      setDeployMessage(`エラー: ${err.message}`);
    } finally {
      setDeploying('idle');
    }
  };

  const handleFtpDeploy = async () => {
    setDeploying('ftp');
    setDeployMessage(null);
    try {
      const res = await fetch('/api/hub/deploy', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'FTPデプロイに失敗しました');
      setDeployMessage(
        `FTPデプロイ完了: ${data?.uploaded ?? 0} ファイルアップロード`,
      );
    } catch (err: any) {
      setDeployMessage(`エラー: ${err.message}`);
    } finally {
      setDeploying('idle');
    }
  };

  // ─── 設定読み込み ──────────────────────────────────────────────────────

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return;
      const data = await res.json();

      // API は { basic: {...}, ai: {...}, cta: {...}, seo: {...} } を返す
      // 各 value は JSONB なのでオブジェクトとして取得済み
      if (data.basic && typeof data.basic === 'object') {
        setBasic({ ...DEFAULT_BASIC, ...data.basic });
      }
      if (data.ai && typeof data.ai === 'object') {
        setAI({ ...DEFAULT_AI, ...data.ai });
      }
      if (data.cta && typeof data.cta === 'object') {
        setCTA({ ...DEFAULT_CTA, ...data.cta });
      }
      if (data.seo && typeof data.seo === 'object') {
        setSEO({ ...DEFAULT_SEO, ...data.seo });
      }
    } catch {
      // ignore — use defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // ─── 保存 ──────────────────────────────────────────────────────────────

  const handleSave = async (tab: TabKey) => {
    setSaving(true);
    setSaveMessage(null);

    const payloads: Record<TabKey, unknown> = {
      basic,
      ai,
      cta,
      seo,
      deploy: null, // デプロイタブは個別ボタンで操作するため保存対象外
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: tab, data: payloads[tab] }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? '保存に失敗しました');
      }

      setSaveMessage('保存しました');
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err: any) {
      setSaveMessage(`エラー: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ─── 共通スタイル ──────────────────────────────────────────────────────

  const labelClass = 'block text-sm font-medium text-gray-700 mb-1';
  const inputClass =
    'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-100';
  const textareaClass = `${inputClass} resize-y`;

  // ─── レンダー ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <p className="text-sm text-gray-400">設定を読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ページヘッダー */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">設定</h1>
        <p className="mt-1 text-sm text-gray-500">
          システム全体の設定を管理します
        </p>
      </div>

      {/* タブナビゲーション */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                setSaveMessage(null);
              }}
              className={`whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'border-brand-500 text-brand-700'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* タブコンテンツ */}
      <div className="rounded-xl bg-white p-6 shadow-sm">
        {/* ─── 基本設定 ─── */}
        {activeTab === 'basic' && (
          <div className="space-y-5 max-w-xl">
            <div>
              <label className={labelClass}>サイト名</label>
              <input
                type="text"
                value={basic.site_name}
                onChange={(e) =>
                  setBasic({ ...basic, site_name: e.target.value })
                }
                placeholder="Harmony Column"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>著者名</label>
              <input
                type="text"
                value={basic.author_name}
                onChange={(e) =>
                  setBasic({ ...basic, author_name: e.target.value })
                }
                placeholder="著者の表示名"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>著者プロフィール</label>
              <textarea
                rows={4}
                value={basic.author_profile}
                onChange={(e) =>
                  setBasic({ ...basic, author_profile: e.target.value })
                }
                placeholder="著者の紹介文"
                className={textareaClass}
              />
            </div>
          </div>
        )}

        {/* ─── AI 設定 ─── */}
        {activeTab === 'ai' && (
          <div className="space-y-5 max-w-xl">
            <div>
              <label className={labelClass}>Gemini モデル</label>
              <select
                value={ai.gemini_model}
                onChange={(e) =>
                  setAI({ ...ai, gemini_model: e.target.value })
                }
                className={inputClass}
              >
                {GEMINI_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>
                デフォルト文字数:{' '}
                <span className="text-brand-600 font-semibold">
                  {(ai.default_char_count ?? 2000).toLocaleString()}
                </span>
              </label>
              <input
                type="range"
                min={500}
                max={5000}
                step={100}
                value={ai.default_char_count}
                onChange={(e) =>
                  setAI({
                    ...ai,
                    default_char_count: Number(e.target.value),
                  })
                }
                className="w-full accent-brand-500"
              />
              <div className="mt-1 flex justify-between text-xs text-gray-400">
                <span>500</span>
                <span>5,000</span>
              </div>
            </div>
            <div>
              <label className={labelClass}>デフォルトペルソナ</label>
              <textarea
                rows={3}
                value={ai.default_persona}
                onChange={(e) =>
                  setAI({ ...ai, default_persona: e.target.value })
                }
                placeholder="記事を書く際のペルソナ設定..."
                className={textareaClass}
              />
            </div>
            <div>
              <label className={labelClass}>デフォルトテーマ</label>
              <input
                type="text"
                value={ai.default_theme}
                onChange={(e) =>
                  setAI({ ...ai, default_theme: e.target.value })
                }
                placeholder="スピリチュアル・ヒーリング..."
                className={inputClass}
              />
            </div>
          </div>
        )}

        {/* ─── CTA 設定 ─── */}
        {activeTab === 'cta' && (
          <div className="space-y-5 max-w-xl">
            <div>
              <label className={labelClass}>CTA URL</label>
              <input
                type="url"
                value={cta.cta_url}
                onChange={(e) =>
                  setCTA({ ...cta, cta_url: e.target.value })
                }
                placeholder="https://harmony-booking.web.app/"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>CTA 文言 - 導入部</label>
              <textarea
                rows={3}
                value={cta.cta_intro}
                onChange={(e) =>
                  setCTA({ ...cta, cta_intro: e.target.value })
                }
                placeholder="記事の導入部分に挿入する CTA テキスト..."
                className={textareaClass}
              />
            </div>
            <div>
              <label className={labelClass}>CTA 文言 - 中盤</label>
              <textarea
                rows={3}
                value={cta.cta_middle}
                onChange={(e) =>
                  setCTA({ ...cta, cta_middle: e.target.value })
                }
                placeholder="記事の中盤に挿入する CTA テキスト..."
                className={textareaClass}
              />
            </div>
            <div>
              <label className={labelClass}>CTA 文言 - 末尾</label>
              <textarea
                rows={3}
                value={cta.cta_ending}
                onChange={(e) =>
                  setCTA({ ...cta, cta_ending: e.target.value })
                }
                placeholder="記事の末尾に挿入する CTA テキスト..."
                className={textareaClass}
              />
            </div>
          </div>
        )}

        {/* ─── SEO 設定 ─── */}
        {activeTab === 'seo' && (
          <div className="space-y-5 max-w-xl">
            <div>
              <label className={labelClass}>著者プロフィール JSON-LD</label>
              <textarea
                rows={8}
                value={seo.author_jsonld}
                onChange={(e) =>
                  setSEO({ ...seo, author_jsonld: e.target.value })
                }
                placeholder='{"@type": "Person", "name": "...", ...}'
                className={`${textareaClass} font-mono text-xs`}
              />
              <p className="mt-1 text-xs text-gray-400">
                JSON-LD 形式で著者情報を記述します（構造化データ用）
              </p>
            </div>
            <div>
              <label className={labelClass}>免責事項テキスト</label>
              <textarea
                rows={4}
                value={seo.disclaimer}
                onChange={(e) =>
                  setSEO({ ...seo, disclaimer: e.target.value })
                }
                placeholder="本サイトの内容は情報提供を目的としています..."
                className={textareaClass}
              />
            </div>
          </div>
        )}

        {/* ─── デプロイ ─── */}
        {activeTab === 'deploy' && (
          <div className="space-y-6 max-w-xl">
            <div>
              <h3 className="text-sm font-semibold text-gray-800 mb-1">
                FTP 接続情報
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                FTP設定は .env.local で管理しています。変更する場合はサーバー側の環境変数を更新してください。
              </p>
              <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
                <dt className="text-gray-500">ホスト</dt>
                <dd className="text-gray-800 font-mono text-xs">FTP_HOST (env)</dd>
                <dt className="text-gray-500">ポート</dt>
                <dd className="text-gray-800 font-mono text-xs">FTP_PORT (env)</dd>
                <dt className="text-gray-500">リモートパス</dt>
                <dd className="text-gray-800 font-mono text-xs">FTP_REMOTE_PATH (env)</dd>
              </dl>
            </div>

            <hr className="border-gray-100" />

            {/* ハブページ再生成 */}
            <div>
              <h3 className="text-sm font-semibold text-gray-800 mb-1">
                ハブページ再生成
              </h3>
              <p className="text-xs text-gray-500 mb-3">
                公開済み記事の一覧からハブページ（index.html）を再生成します。記事公開時にも自動実行されます。
              </p>
              <button
                onClick={handleRebuild}
                disabled={deploying !== 'idle'}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {deploying === 'rebuild' && (
                  <svg
                    className="h-4 w-4 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                )}
                ハブページ再生成
              </button>
            </div>

            <hr className="border-gray-100" />

            {/* FTPデプロイ */}
            <div>
              <h3 className="text-sm font-semibold text-gray-800 mb-1">
                FTP デプロイ
              </h3>
              <p className="text-xs text-gray-500 mb-3">
                生成済みのハブページおよび記事HTMLをFTPサーバーにアップロードします。
              </p>
              <button
                onClick={handleFtpDeploy}
                disabled={deploying !== 'idle'}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                {deploying === 'ftp' && (
                  <svg
                    className="h-4 w-4 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                )}
                FTP デプロイ
              </button>
            </div>

            {/* 結果表示 */}
            {deployMessage && (
              <div
                className={`mt-2 rounded-lg p-3 text-sm ${
                  deployMessage.startsWith('エラー')
                    ? 'bg-red-50 text-red-700'
                    : 'bg-emerald-50 text-emerald-700'
                }`}
              >
                {deployMessage}
              </div>
            )}
          </div>
        )}

        {/* 保存ボタン（デプロイタブ以外） */}
        {activeTab !== 'deploy' && <div className="mt-8 flex items-center gap-3">
          <button
            onClick={() => handleSave(activeTab)}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
          >
            {saving && (
              <svg
                className="h-4 w-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            )}
            保存
          </button>
          {saveMessage && (
            <span
              className={`text-sm ${
                saveMessage.startsWith('エラー')
                  ? 'text-red-500'
                  : 'text-emerald-600'
              }`}
            >
              {saveMessage}
            </span>
          )}
        </div>}
      </div>
    </div>
  );
}
