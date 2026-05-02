// ============================================================================
// src/app/(dashboard)/dashboard/settings/page.tsx
// システム設定ページ — タブ構成（基本/AI/CTA/SEO）
// ============================================================================
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
// P5-44: ハードコード URL を env 駆動の単一ソースに統一
import { getSiteUrl, getHubPath } from '@/lib/config/public-urls';

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

interface CtaItemSettings {
  url: string;
  buttonText: string;
  catchText: string;
  subText: string;
}

interface CTASettings {
  cta2: CtaItemSettings;
  cta3: CtaItemSettings;
}

interface SEOSettings {
  // ─── サイト基本 ─────────────────
  site_url: string;
  site_name: string;
  site_logo_url: string;
  og_default_image_url: string;

  // ─── 著者 (Person) ──────────────
  author_name: string;
  author_job_title: string;
  author_profile_url: string;
  author_image_url: string;
  author_bio: string;
  author_same_as: string[];      // 1 行 1 URL
  author_knows_about: string[];  // 1 行 1 タグ

  // ─── 発行元 (Organization) ──────
  publisher_name: string;
  publisher_url: string;
  publisher_logo_url: string;

  // ─── パンくず ──────────────────
  breadcrumb_home_label: string;
  breadcrumb_section_label: string;
  breadcrumb_section_url: string;

  // ─── スキーマ ON/OFF ────────────
  enable_article_schema: boolean;
  enable_faq_schema: boolean;
  enable_breadcrumb_schema: boolean;
  enable_person_schema: boolean;

  // ─── 後方互換 ──────────────────
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
  { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro（推奨・記事生成）', desc: '最高品質 / 速度:中 / コスト:高', tier: 'recommended' as const },
  { value: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro（画像生成）', desc: '画像生成専用 / 速度:遅 / コスト:高', tier: 'special' as const },
  { value: 'gemini-pro-latest', label: 'Gemini Pro Latest', desc: '安定版 / 速度:中 / コスト:中', tier: 'standard' as const },
  { value: 'gemini-2.5-pro-preview-05-06', label: 'Gemini 2.5 Pro Preview', desc: '高品質 / 速度:中 / コスト:中', tier: 'standard' as const },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash（高速・低コスト）', desc: '高速応答 / 速度:速 / コスト:低', tier: 'budget' as const },
];

// ─── デフォルト値 ─────────────────────────────────────────────────────────────

const DEFAULT_BASIC: BasicSettings = {
  site_name: '',
  author_name: '',
  author_profile: '',
};

const DEFAULT_AI: AISettings = {
  gemini_model: 'gemini-3.1-pro-preview',
  default_char_count: 2000,
  default_persona: '',
  default_theme: '',
};

const DEFAULT_CTA_ITEM: CtaItemSettings = {
  url: '',
  buttonText: '',
  catchText: '',
  subText: '',
};

const DEFAULT_CTA: CTASettings = {
  cta2: {
    ...DEFAULT_CTA_ITEM,
    url: 'https://harmony-mc.com/system/',
    buttonText: 'ご予約の流れを確認する',
  },
  cta3: {
    ...DEFAULT_CTA_ITEM,
    url: 'https://harmony-booking.web.app/',
    buttonText: 'カウンセリングを予約する',
  },
};

const DEFAULT_SEO: SEOSettings = {
  // 既定値は src/lib/seo/seo-settings.ts の DEFAULT_SEO_SETTINGS と同期
  site_url: getSiteUrl(), // P5-44: env 駆動
  site_name: 'Harmony スピリチュアルコラム',
  site_logo_url: `${getSiteUrl()}/logo.png`, // P5-44: env 駆動
  og_default_image_url: `${getSiteUrl()}/og-default.jpg`, // P5-44: env 駆動
  author_name: '小林由起子',
  author_job_title: 'スピリチュアルカウンセラー',
  author_profile_url: `${getSiteUrl()}/profile`, // P5-44: env 駆動
  author_image_url: '',
  author_bio: '',
  author_same_as: [],
  author_knows_about: ['霊視', '前世リーディング', 'カルマ', 'チャクラ', 'エネルギーワーク'],
  publisher_name: 'Harmony スピリチュアルコラム',
  publisher_url: getSiteUrl(), // P5-44: env 駆動
  publisher_logo_url: `${getSiteUrl()}/logo.png`, // P5-44: env 駆動
  breadcrumb_home_label: 'ホーム',
  breadcrumb_section_label: 'コラム',
  breadcrumb_section_url: getHubPath(), // P5-44: env 駆動
  enable_article_schema: true,
  enable_faq_schema: true,
  enable_breadcrumb_schema: true,
  enable_person_schema: true,
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

  // P5-37: workflow.zero_gen_auto_approve トグル
  const [zeroGenAutoApprove, setZeroGenAutoApprove] = useState(false);
  const [savingWorkflow, setSavingWorkflow] = useState(false);

  // 未保存変更の追跡（タブごと）
  const [dirty, setDirty] = useState<Record<TabKey, boolean>>({
    basic: false, ai: false, cta: false, seo: false, deploy: false,
  });
  const markDirty = (tab: TabKey) => setDirty((d) => ({ ...d, [tab]: true }));
  const clearDirty = (tab: TabKey) => setDirty((d) => ({ ...d, [tab]: false }));

  // Dirty-tracking wrappers for CTA / SEO (these have many onChange handlers)
  const updateCTA = (updater: CTASettings | ((prev: CTASettings) => CTASettings)) => {
    setCTA(updater);
    markDirty('cta');
  };
  const updateSEO = (updater: SEOSettings | ((prev: SEOSettings) => SEOSettings)) => {
    setSEO(updater);
    markDirty('seo');
  };

  // トースト通知
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });
    toastTimeoutRef.current = setTimeout(() => setToast(null), 4000);
  };

  // デプロイタブ用 state
  const [deploying, setDeploying] = useState<'idle' | 'rebuild' | 'ftp'>('idle');
  const [deployMessage, setDeployMessage] = useState<string | null>(null);
  const [deployProgress, setDeployProgress] = useState(0); // 0-100

  // ハイライト一括適用 state
  const [highlightRunning, setHighlightRunning] = useState(false);
  const [highlightMessage, setHighlightMessage] = useState<string | null>(null);

  // P5-37: zero-gen auto-approve toggle 保存
  const handleToggleAutoApprove = async (next: boolean) => {
    setSavingWorkflow(true);
    const prev = zeroGenAutoApprove;
    setZeroGenAutoApprove(next); // optimistic
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'workflow',
          data: { zero_gen_auto_approve: next },
        }),
      });
      if (!res.ok) throw new Error('保存に失敗しました');
      showToast(next ? 'ゼロ生成記事を自動承認に切替えました' : '由起子さん手動確認に切替えました', 'success');
    } catch (e: any) {
      setZeroGenAutoApprove(prev);
      showToast(`エラー: ${e.message}`, 'error');
    } finally {
      setSavingWorkflow(false);
    }
  };

  const handleRebuild = async () => {
    setDeploying('rebuild');
    setDeployMessage(null);
    setDeployProgress(0);
    // Simulate progress (actual API is synchronous)
    const progressInterval = setInterval(() => {
      setDeployProgress((p) => Math.min(p + 8, 90));
    }, 300);
    try {
      const res = await fetch('/api/hub/rebuild', { method: 'POST' });
      const data = await res.json().catch(() => null);
      clearInterval(progressInterval);
      setDeployProgress(100);
      if (!res.ok) throw new Error(data?.error ?? 'ハブページ再生成に失敗しました');
      setDeployMessage(`ハブページ再生成完了: ${data?.generated ?? 0} ファイル生成`);
    } catch (err: any) {
      clearInterval(progressInterval);
      setDeployProgress(0);
      setDeployMessage(`エラー: ${err.message}`);
    } finally {
      setTimeout(() => { setDeploying('idle'); setDeployProgress(0); }, 1500);
    }
  };

  const handleFtpDeploy = async () => {
    setDeploying('ftp');
    setDeployMessage(null);
    setDeployProgress(0);
    const progressInterval = setInterval(() => {
      setDeployProgress((p) => Math.min(p + 5, 90));
    }, 400);
    try {
      const res = await fetch('/api/hub/deploy', { method: 'POST' });
      const data = await res.json().catch(() => null);
      clearInterval(progressInterval);
      setDeployProgress(100);
      if (!res.ok) throw new Error(data?.error ?? 'FTPデプロイに失敗しました');
      setDeployMessage(
        `FTPデプロイ完了: ${data?.uploaded ?? 0} ファイルアップロード`,
      );
    } catch (err: any) {
      clearInterval(progressInterval);
      setDeployProgress(0);
      setDeployMessage(`エラー: ${err.message}`);
    } finally {
      setTimeout(() => { setDeploying('idle'); setDeployProgress(0); }, 1500);
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
        setCTA({
          cta2: { ...DEFAULT_CTA.cta2, ...(data.cta.cta2 || {}) },
          cta3: { ...DEFAULT_CTA.cta3, ...(data.cta.cta3 || {}) },
        });
      }
      if (data.seo && typeof data.seo === 'object') {
        setSEO({ ...DEFAULT_SEO, ...data.seo });
      }
      if (data.workflow && typeof data.workflow === 'object') {
        setZeroGenAutoApprove(Boolean(data.workflow.zero_gen_auto_approve));
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
      showToast('保存しました', 'success');
      clearDirty(tab);
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err: any) {
      setSaveMessage(`エラー: ${err.message}`);
      showToast(`エラー: ${err.message}`, 'error');
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
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-brand-500" />
          <p className="text-sm text-gray-400">設定を読み込み中...</p>
        </div>
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
      <div className="border-b border-gray-200 -mx-1 px-1 overflow-x-auto">
        <nav className="-mb-px flex gap-3 sm:gap-6 min-w-max">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                if (dirty[activeTab] && activeTab !== 'deploy') {
                  const ok = window.confirm('未保存の変更があります。破棄してタブを切り替えますか？');
                  if (!ok) return;
                }
                setActiveTab(tab.key);
                setSaveMessage(null);
              }}
              className={`relative whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'border-brand-500 text-brand-700'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {dirty[tab.key] && tab.key !== 'deploy' && (
                <span className="absolute -top-0.5 -right-1.5 h-2 w-2 rounded-full bg-amber-400" />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* タブコンテンツ */}
      <div className="rounded-xl bg-white p-4 sm:p-6 shadow-sm">
        {/* ─── 基本設定 ─── */}
        {activeTab === 'basic' && (
          <div className="space-y-5 w-full max-w-xl">
            <div>
              <label className={labelClass}>サイト名</label>
              <input
                type="text"
                value={basic.site_name}
                onChange={(e) => {
                  setBasic({ ...basic, site_name: e.target.value });
                  markDirty('basic');
                }}
                placeholder="Harmony Column"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>著者名</label>
              <input
                type="text"
                value={basic.author_name}
                onChange={(e) => {
                  setBasic({ ...basic, author_name: e.target.value });
                  markDirty('basic');
                }}
                placeholder="著者の表示名"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>著者プロフィール</label>
              <textarea
                rows={4}
                value={basic.author_profile}
                onChange={(e) => {
                  setBasic({ ...basic, author_profile: e.target.value });
                  markDirty('basic');
                }}
                placeholder="著者の紹介文"
                className={textareaClass}
              />
            </div>
          </div>
        )}

        {/* ─── AI 設定 ─── */}
        {activeTab === 'ai' && (
          <div className="space-y-5 w-full max-w-xl">
            <div>
              <label className={labelClass}>Gemini モデル</label>
              <select
                value={ai.gemini_model}
                onChange={(e) => {
                  setAI({ ...ai, gemini_model: e.target.value });
                  markDirty('ai');
                }}
                className={inputClass}
              >
                {GEMINI_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              {/* 選択中モデルの説明 */}
              {(() => {
                const selected = GEMINI_MODELS.find((m) => m.value === ai.gemini_model);
                if (!selected) return null;
                const tierColors: Record<string, string> = {
                  recommended: 'bg-brand-50 text-brand-700 border-brand-200',
                  special: 'bg-purple-50 text-purple-700 border-purple-200',
                  standard: 'bg-gray-50 text-gray-700 border-gray-200',
                  budget: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                };
                return (
                  <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${tierColors[selected.tier]}`}>
                    {selected.desc}
                  </div>
                );
              })()}
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
                onChange={(e) => {
                  setAI({ ...ai, default_char_count: Number(e.target.value) });
                  markDirty('ai');
                }}
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
                onChange={(e) => {
                  setAI({ ...ai, default_persona: e.target.value });
                  markDirty('ai');
                }}
                placeholder="記事を書く際のペルソナ設定..."
                className={textareaClass}
              />
            </div>
            <div>
              <label className={labelClass}>デフォルトテーマ</label>
              <input
                type="text"
                value={ai.default_theme}
                onChange={(e) => {
                  setAI({ ...ai, default_theme: e.target.value });
                  markDirty('ai');
                }}
                placeholder="スピリチュアル・ヒーリング..."
                className={inputClass}
              />
            </div>
          </div>
        )}

        {/* ─── CTA 設定 ─── */}
        {activeTab === 'cta' && (
          <div className="space-y-8 w-full max-w-2xl">
            {/* CTA2: 予約の流れページ */}
            <div className="rounded-lg border-2 border-amber-200 bg-amber-50/30 p-3 sm:p-5 space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">2</span>
                  <h3 className="text-sm font-semibold text-gray-800">
                    中盤（予約の流れページ）
                  </h3>
                </div>
                <span className="self-start text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded font-medium sm:self-auto">検討促進</span>
              </div>
              <div>
                <label className={labelClass}>リンク先 URL</label>
                <input
                  type="url"
                  value={cta.cta2.url}
                  onChange={(e) =>
                    updateCTA({ ...cta, cta2: { ...cta.cta2, url: e.target.value } })
                  }
                  placeholder="https://harmony-mc.com/system/"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>ボタンテキスト</label>
                <input
                  type="text"
                  value={cta.cta2.buttonText}
                  onChange={(e) =>
                    updateCTA({ ...cta, cta2: { ...cta.cta2, buttonText: e.target.value } })
                  }
                  placeholder="ご予約の流れを確認する"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>キャッチコピー（上書き用・空欄でテーマ別自動選択）</label>
                <textarea
                  rows={2}
                  value={cta.cta2.catchText}
                  onChange={(e) =>
                    updateCTA({ ...cta, cta2: { ...cta.cta2, catchText: e.target.value } })
                  }
                  placeholder="テーマ別テンプレートから自動選択されます"
                  className={textareaClass}
                />
              </div>
              <div>
                <label className={labelClass}>サブテキスト（上書き用・空欄でテーマ別自動選択）</label>
                <textarea
                  rows={2}
                  value={cta.cta2.subText}
                  onChange={(e) =>
                    updateCTA({ ...cta, cta2: { ...cta.cta2, subText: e.target.value } })
                  }
                  placeholder="テーマ別テンプレートから自動選択されます"
                  className={textareaClass}
                />
              </div>
            </div>

            {/* CTA3: 予約ページ */}
            <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50/30 p-3 sm:p-5 space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white">3</span>
                  <h3 className="text-sm font-semibold text-gray-800">
                    末尾（予約ページ）
                  </h3>
                </div>
                <span className="self-start text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded font-medium sm:self-auto">コンバージョン</span>
              </div>
              <div>
                <label className={labelClass}>リンク先 URL</label>
                <input
                  type="url"
                  value={cta.cta3.url}
                  onChange={(e) =>
                    updateCTA({ ...cta, cta3: { ...cta.cta3, url: e.target.value } })
                  }
                  placeholder="https://harmony-booking.web.app/"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>ボタンテキスト</label>
                <input
                  type="text"
                  value={cta.cta3.buttonText}
                  onChange={(e) =>
                    updateCTA({ ...cta, cta3: { ...cta.cta3, buttonText: e.target.value } })
                  }
                  placeholder="カウンセリングを予約する"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>キャッチコピー（上書き用・空欄でテーマ別自動選択）</label>
                <textarea
                  rows={2}
                  value={cta.cta3.catchText}
                  onChange={(e) =>
                    updateCTA({ ...cta, cta3: { ...cta.cta3, catchText: e.target.value } })
                  }
                  placeholder="テーマ別テンプレートから自動選択されます"
                  className={textareaClass}
                />
              </div>
              <div>
                <label className={labelClass}>サブテキスト（上書き用・空欄でテーマ別自動選択）</label>
                <textarea
                  rows={2}
                  value={cta.cta3.subText}
                  onChange={(e) =>
                    updateCTA({ ...cta, cta3: { ...cta.cta3, subText: e.target.value } })
                  }
                  placeholder="テーマ別テンプレートから自動選択されます"
                  className={textareaClass}
                />
              </div>
            </div>

            {/* アクションボタン */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={() => setCTA(DEFAULT_CTA)}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                デフォルトに戻す
              </button>
              <button
                onClick={async () => {
                  try {
                    setSaving(true);
                    setSaveMessage('全記事のCTAを更新中...');
                    const res = await fetch('/api/articles/batch-update-cta', { method: 'POST' });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data?.error ?? 'CTA一括更新に失敗しました');
                    const errorInfo = data.errors?.length ? ` (${data.errors.length}件エラー)` : '';
                    setSaveMessage(`CTA更新完了: ${data.updated ?? 0}件更新、${data.skipped ?? 0}件スキップ${errorInfo}`);
                    showToast(`${data.updated ?? 0}件のCTAを更新しました`, 'success');
                    setTimeout(() => setSaveMessage(null), 8000);
                  } catch (err: any) {
                    setSaveMessage(`エラー: ${err.message}`);
                    showToast(`エラー: ${err.message}`, 'error');
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
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
                全記事のCTAを更新
              </button>
            </div>
          </div>
        )}

        {/* ─── SEO 設定（schema.org 構造化データ）─── */}
        {activeTab === 'seo' && (
          <div className="space-y-6 w-full max-w-2xl">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              全フィールド任意。空欄のまま保存するとデフォルト値が JSON-LD に反映されます。
              出力された @graph は Google Rich Results Test で検証してください。
            </p>

            {/* ── サイト基本 ── */}
            <fieldset className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <legend className="px-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                サイト基本
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>サイト URL</label>
                  <input
                    type="url"
                    value={seo.site_url}
                    onChange={(e) => updateSEO({ ...seo, site_url: e.target.value })}
                    placeholder="https://harmony-mc.com"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>サイト名</label>
                  <input
                    type="text"
                    value={seo.site_name}
                    onChange={(e) => updateSEO({ ...seo, site_name: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>サイトロゴ URL</label>
                  <input
                    type="url"
                    value={seo.site_logo_url}
                    onChange={(e) => updateSEO({ ...seo, site_logo_url: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>OG 既定画像 URL</label>
                  <input
                    type="url"
                    value={seo.og_default_image_url}
                    onChange={(e) => updateSEO({ ...seo, og_default_image_url: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
            </fieldset>

            {/* ── 著者 (Person) ── */}
            <fieldset className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <legend className="px-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                著者 (Person)
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>著者名</label>
                  <input
                    type="text"
                    value={seo.author_name}
                    onChange={(e) => updateSEO({ ...seo, author_name: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>職業</label>
                  <input
                    type="text"
                    value={seo.author_job_title}
                    onChange={(e) => updateSEO({ ...seo, author_job_title: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>プロフィール URL</label>
                  <input
                    type="url"
                    value={seo.author_profile_url}
                    onChange={(e) => updateSEO({ ...seo, author_profile_url: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>著者画像 URL（任意）</label>
                  <input
                    type="url"
                    value={seo.author_image_url}
                    onChange={(e) => updateSEO({ ...seo, author_image_url: e.target.value })}
                    placeholder="https://..."
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className={labelClass}>自己紹介（任意）</label>
                <textarea
                  rows={3}
                  value={seo.author_bio}
                  onChange={(e) => updateSEO({ ...seo, author_bio: e.target.value })}
                  className={textareaClass}
                />
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>
                    sameAs（1 行に 1 URL — Twitter / Ameblo 等）
                  </label>
                  <textarea
                    rows={3}
                    value={seo.author_same_as.join('\n')}
                    onChange={(e) =>
                      updateSEO({
                        ...seo,
                        author_same_as: e.target.value
                          .split('\n')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="https://twitter.com/...&#10;https://ameblo.jp/..."
                    className={`${textareaClass} font-mono text-xs`}
                  />
                </div>
                <div>
                  <label className={labelClass}>
                    専門分野 (knowsAbout)（1 行 1 タグ）
                  </label>
                  <textarea
                    rows={3}
                    value={seo.author_knows_about.join('\n')}
                    onChange={(e) =>
                      updateSEO({
                        ...seo,
                        author_knows_about: e.target.value
                          .split('\n')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="霊視&#10;前世リーディング"
                    className={`${textareaClass} text-xs`}
                  />
                </div>
              </div>
            </fieldset>

            {/* ── 発行元 (Organization) ── */}
            <fieldset className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <legend className="px-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                発行元 (Organization)
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>発行元名</label>
                  <input
                    type="text"
                    value={seo.publisher_name}
                    onChange={(e) => updateSEO({ ...seo, publisher_name: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>発行元 URL</label>
                  <input
                    type="url"
                    value={seo.publisher_url}
                    onChange={(e) => updateSEO({ ...seo, publisher_url: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>発行元ロゴ URL</label>
                  <input
                    type="url"
                    value={seo.publisher_logo_url}
                    onChange={(e) => updateSEO({ ...seo, publisher_logo_url: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
            </fieldset>

            {/* ── パンくず ── */}
            <fieldset className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <legend className="px-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                パンくずリスト
              </legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className={labelClass}>ホームラベル</label>
                  <input
                    type="text"
                    value={seo.breadcrumb_home_label}
                    onChange={(e) => updateSEO({ ...seo, breadcrumb_home_label: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>セクションラベル</label>
                  <input
                    type="text"
                    value={seo.breadcrumb_section_label}
                    onChange={(e) => updateSEO({ ...seo, breadcrumb_section_label: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>セクション URL</label>
                  <input
                    type="text"
                    value={seo.breadcrumb_section_url}
                    onChange={(e) => updateSEO({ ...seo, breadcrumb_section_url: e.target.value })}
                    placeholder="/column"
                    className={inputClass}
                  />
                </div>
              </div>
            </fieldset>

            {/* ── スキーマ ON/OFF ── */}
            <fieldset className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <legend className="px-2 text-sm font-semibold text-gray-800 dark:text-gray-100">
                出力する schema (ON/OFF)
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {([
                  ['enable_article_schema', 'Article'],
                  ['enable_faq_schema', 'FAQPage'],
                  ['enable_breadcrumb_schema', 'BreadcrumbList'],
                  ['enable_person_schema', 'Person'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-100">
                    <input
                      type="checkbox"
                      checked={seo[key]}
                      onChange={(e) => updateSEO({ ...seo, [key]: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            {/* ── 詳細（折りたたみ）── */}
            <details className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-gray-200">
                詳細: カスタム JSON-LD / 免責事項
              </summary>
              <div className="mt-3 space-y-3">
                <div>
                  <label className={labelClass}>カスタム JSON-LD（override 用、任意）</label>
                  <textarea
                    rows={6}
                    value={seo.author_jsonld}
                    onChange={(e) => updateSEO({ ...seo, author_jsonld: e.target.value })}
                    placeholder='{"@type": "Person", "name": "...", ...}'
                    className={`${textareaClass} font-mono text-xs`}
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    指定があれば Person schema を完全に上書きします（互換用、通常は空のまま）
                  </p>
                </div>
                <div>
                  <label className={labelClass}>免責事項テキスト</label>
                  <textarea
                    rows={4}
                    value={seo.disclaimer}
                    onChange={(e) => updateSEO({ ...seo, disclaimer: e.target.value })}
                    placeholder="本サイトの内容は情報提供を目的としています..."
                    className={textareaClass}
                  />
                </div>
              </div>
            </details>
          </div>
        )}

        {/* ─── デプロイ ─── */}
        {activeTab === 'deploy' && (
          <div className="space-y-6 w-full max-w-xl">
            {/* P5-37: ゼロ生成記事 自動承認トグル */}
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-amber-900 mb-1">
                    ゼロ生成記事の由起子さん確認
                  </h3>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    {zeroGenAutoApprove ? (
                      <>
                        <strong>自動承認 ON:</strong> ゼロ生成完了時に
                        <code className="px-1 bg-amber-100 rounded">reviewed_at</code>
                        を自動セット。FTP デプロイが即可能になります（由起子さん確認をスキップ）。
                      </>
                    ) : (
                      <>
                        <strong>手動確認:</strong> ゼロ生成完了後、記事詳細で
                        「由起子さん確認」ボタンを実行しないと FTP デプロイできません（推奨・デフォルト）。
                      </>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => handleToggleAutoApprove(!zeroGenAutoApprove)}
                  disabled={savingWorkflow}
                  role="switch"
                  aria-checked={zeroGenAutoApprove}
                  className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    zeroGenAutoApprove ? 'bg-amber-600' : 'bg-gray-300'
                  } disabled:opacity-50`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      zeroGenAutoApprove ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-800 mb-1">
                FTP 接続情報
              </h3>
              <p className="text-xs text-gray-500 mb-4">
                FTP接続情報を入力して保存してください。デプロイ時にこの情報が使用されます。
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">ホスト</label>
                  <input
                    id="ftp-host" type="text" placeholder="例: harmony-mc.com"
                    defaultValue=""
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">ユーザー名</label>
                    <input
                      id="ftp-user" type="text" placeholder="FTPユーザー名"
                      defaultValue=""
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">パスワード</label>
                    <input
                      id="ftp-password" type="password" placeholder="FTPパスワード"
                      defaultValue=""
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">ポート</label>
                    <input
                      id="ftp-port" type="number" placeholder="21" defaultValue="21"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">リモートパス</label>
                    <input
                      id="ftp-remote-path" type="text" placeholder="/public_html/column/columns/"
                      defaultValue="/public_html/column/columns/"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <button
                    id="ftp-save-btn"
                    onClick={async () => {
                      const host = (document.getElementById('ftp-host') as HTMLInputElement)?.value;
                      const user = (document.getElementById('ftp-user') as HTMLInputElement)?.value;
                      const password = (document.getElementById('ftp-password') as HTMLInputElement)?.value;
                      const port = (document.getElementById('ftp-port') as HTMLInputElement)?.value || '21';
                      const remotePath = (document.getElementById('ftp-remote-path') as HTMLInputElement)?.value || '/public_html/column/columns/';
                      const msgEl = document.getElementById('ftp-save-msg');
                      if (!host || !user || !password) {
                        if (msgEl) { msgEl.textContent = 'ホスト、ユーザー名、パスワードは必須です'; msgEl.className = 'text-xs text-red-600'; }
                        return;
                      }
                      try {
                        const res = await fetch('/api/settings', {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ section: 'ftp', data: { host, user, password, port: Number(port), remotePath } }),
                        });
                        if (!res.ok) throw new Error('保存に失敗しました');
                        if (msgEl) { msgEl.textContent = '✅ FTP設定を保存しました'; msgEl.className = 'text-xs text-emerald-600'; }
                      } catch (err: unknown) {
                        if (msgEl) { msgEl.textContent = `❌ ${err instanceof Error ? err.message : String(err)}`; msgEl.className = 'text-xs text-red-600'; }
                      }
                    }}
                    className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600"
                  >
                    FTP設定を保存
                  </button>
                  <button
                    onClick={async () => {
                      const host = (document.getElementById('ftp-host') as HTMLInputElement)?.value;
                      const user = (document.getElementById('ftp-user') as HTMLInputElement)?.value;
                      const password = (document.getElementById('ftp-password') as HTMLInputElement)?.value;
                      const port = (document.getElementById('ftp-port') as HTMLInputElement)?.value || '21';
                      const msgEl = document.getElementById('ftp-save-msg');
                      if (!host || !user || !password) {
                        if (msgEl) { msgEl.textContent = '接続テストにはホスト、ユーザー名、パスワードが必要です'; msgEl.className = 'text-xs text-red-600'; }
                        return;
                      }
                      if (msgEl) { msgEl.textContent = '接続テスト中...'; msgEl.className = 'text-xs text-amber-600'; }
                      try {
                        const res = await fetch('/api/ftp/test', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ host, user, password, port: Number(port) }),
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data?.error ?? '接続テスト失敗');
                        if (msgEl) { msgEl.textContent = '✅ FTP接続成功！'; msgEl.className = 'text-xs text-emerald-600'; }
                      } catch (err: unknown) {
                        if (msgEl) { msgEl.textContent = `❌ 接続失敗: ${err instanceof Error ? err.message : String(err)}`; msgEl.className = 'text-xs text-red-600'; }
                      }
                    }}
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
                  >
                    接続テスト
                  </button>
                  <span id="ftp-save-msg" className="text-xs text-gray-400"></span>
                </div>
              </div>
            </div>

            <hr className="border-gray-100" />

            {/* 一括画像生成 */}
            <div>
              <h3 className="text-sm font-semibold text-gray-800 mb-1">
                一括画像生成（Banana Pro）
              </h3>
              <p className="text-xs text-gray-500 mb-3">
                画像プロンプトはあるが画像が未生成の全記事に対して、Banana Proで画像を一括生成します。
              </p>
              <button
                onClick={async () => {
                  const btn = document.getElementById('batch-img-btn') as HTMLButtonElement | null;
                  const msgEl = document.getElementById('batch-img-msg');
                  if (btn) { btn.disabled = true; }

                  console.log('[batch-images] Fetching articles that need images...');
                  if (msgEl) { msgEl.innerHTML = '⏳ 画像が必要な記事を確認中...'; msgEl.className = 'mt-3 text-sm text-amber-700 bg-amber-50 rounded-lg p-3'; }

                  try {
                    // Step 1: 画像が必要な記事のリストを取得
                    const listRes = await fetch('/api/articles?limit=100');
                    const listData = await listRes.json();
                    const allArticles = listData.data || [];
                    const needImages = allArticles.filter((a: Record<string, unknown>) => {
                      const prompts = a.image_prompts as unknown[] | null;
                      const files = a.image_files as unknown[] | null;
                      return prompts && Array.isArray(prompts) && prompts.length > 0 && (!files || !Array.isArray(files) || files.length === 0);
                    });

                    console.log('[batch-images]', needImages.length, 'articles need images');
                    if (needImages.length === 0) {
                      if (msgEl) { msgEl.innerHTML = '✅ 画像生成が必要な記事はありません'; msgEl.className = 'mt-3 text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3'; }
                      if (btn) btn.disabled = false;
                      return;
                    }

                    // Step 2: 1記事ずつ処理
                    let success = 0, failed = 0;
                    for (let i = 0; i < needImages.length; i++) {
                      const article = needImages[i] as Record<string, unknown>;
                      const title = (article.title as string || '(無題)').substring(0, 30);
                      if (msgEl) { msgEl.innerHTML = `⏳ 画像生成中... (${i + 1}/${needImages.length}) 「${title}」<br><small class="text-gray-500">1記事あたり約1-2分かかります。ページを離れても処理は続きます。</small>`; }
                      console.log('[batch-images]', i + 1, '/', needImages.length, ':', title);

                      try {
                        const res = await fetch('/api/articles/' + (article.id as string) + '/generate-images', { method: 'POST' });
                        const data = await res.json();
                        console.log('[batch-images] Result:', JSON.stringify(data));
                        if (data.success || (data.images && data.images.length > 0)) { success++; } else { failed++; console.error('[batch-images] Failed:', data.error, data.errors); }
                      } catch (err) {
                        failed++;
                        console.error('[batch-images] Error:', err);
                      }
                    }

                    if (msgEl) { msgEl.innerHTML = `✅ 完了: ${success}件成功${failed > 0 ? `、${failed}件失敗` : ''}`; msgEl.className = 'mt-3 text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3'; }
                  } catch (err: unknown) {
                    console.error('[batch-images] Error:', err);
                    if (msgEl) { msgEl.innerHTML = `❌ エラー: ${err instanceof Error ? err.message : String(err)}`; msgEl.className = 'mt-3 text-sm text-red-700 bg-red-50 rounded-lg p-3'; }
                  } finally {
                    if (btn) { btn.disabled = false; }
                  }
                }}
                id="batch-img-btn"
                className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-50 disabled:cursor-wait"
              >
                画像を一括生成
              </button>
              <div id="batch-img-msg" className="mt-3 text-sm"></div>
            </div>

            <hr className="border-gray-100" />

            {/* TOC一括挿入 */}
            <div>
              <h3 className="text-sm font-semibold text-gray-800 mb-1">
                TOC（目次）一括挿入
              </h3>
              <p className="text-xs text-gray-500 mb-3">
                目次がまだ挿入されていない全記事に対して、H2/H3見出しからTOCを自動生成・挿入します。
              </p>
              <button
                onClick={async () => {
                  const btn = document.getElementById('batch-toc-btn') as HTMLButtonElement | null;
                  const msgEl = document.getElementById('batch-toc-msg');
                  if (btn) btn.disabled = true;
                  if (msgEl) { msgEl.textContent = 'TOCを一括挿入中...'; msgEl.className = 'mt-3 text-sm text-amber-700 bg-amber-50 rounded-lg p-3'; }
                  try {
                    const res = await fetch('/api/articles/batch-add-toc', { method: 'POST' });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data?.error ?? 'TOC一括挿入に失敗しました');
                    const errorInfo = data.errors?.length ? ` (${data.errors.length}件エラー)` : '';
                    if (msgEl) { msgEl.textContent = `完了: ${data.updated ?? 0}件挿入、${data.skipped ?? 0}件スキップ${errorInfo}`; msgEl.className = 'mt-3 text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3'; }
                  } catch (err: unknown) {
                    if (msgEl) { msgEl.textContent = `エラー: ${err instanceof Error ? err.message : String(err)}`; msgEl.className = 'mt-3 text-sm text-red-700 bg-red-50 rounded-lg p-3'; }
                  } finally {
                    if (btn) btn.disabled = false;
                  }
                }}
                id="batch-toc-btn"
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-wait"
              >
                全記事にTOCを追加
              </button>
              <div id="batch-toc-msg" className="mt-3 text-sm"></div>
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

            <hr className="border-gray-100" />

            {/* ハイライト一括適用 */}
            <div>
              <h3 className="text-sm font-semibold text-gray-800 mb-1">
                ハイライトマーカー一括適用
              </h3>
              <p className="text-xs text-gray-500 mb-3">
                全記事の重要箇所にAIで蛍光ペン風ハイライトを追加します（Gemini APIを使用・コストが発生します）。
                既にハイライト済みの記事はスキップされます。
              </p>
              <button
                onClick={async () => {
                  if (!confirm('全記事にハイライトを一括適用します。Gemini APIのコストが発生しますがよろしいですか？')) return;
                  setHighlightRunning(true);
                  setHighlightMessage(null);
                  try {
                    let totalUpdated = 0;
                    let totalErrors = 0;
                    let totalArticles = 0;
                    let remaining = 1; // 初回ループ突入用
                    let batchNum = 0;

                    while (remaining > 0) {
                      batchNum++;
                      setHighlightMessage(`バッチ ${batchNum} 処理中... (${totalUpdated}件完了)`);
                      const res = await fetch('/api/articles/batch-add-highlights?limit=5', { method: 'POST' });
                      const data = await res.json().catch(() => null);
                      if (!res.ok) throw new Error(data?.error ?? 'ハイライト適用に失敗しました');

                      totalUpdated += data?.updated ?? 0;
                      totalErrors += data?.errors?.length ?? 0;
                      totalArticles = data?.total ?? totalArticles;
                      remaining = data?.remaining ?? 0;
                    }

                    setHighlightMessage(
                      `完了: ${totalUpdated}件更新 / 全${totalArticles}件${totalErrors > 0 ? ` (エラー: ${totalErrors}件)` : ''}`
                    );
                  } catch (err: unknown) {
                    setHighlightMessage(`エラー: ${err instanceof Error ? err.message : String(err)}`);
                  } finally {
                    setHighlightRunning(false);
                  }
                }}
                disabled={highlightRunning || deploying !== 'idle'}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
              >
                {highlightRunning && (
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                全記事にハイライトを追加
              </button>
              {highlightMessage && (
                <div className={`mt-2 rounded-lg p-3 text-sm ${highlightMessage.startsWith('エラー') ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                  {highlightMessage}
                </div>
              )}
            </div>

            {/* プログレスバー */}
            {deploying !== 'idle' && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>{deploying === 'rebuild' ? 'ハブページ再生成中...' : 'FTPアップロード中...'}</span>
                  <span>{deployProgress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${deploying === 'rebuild' ? 'bg-brand-500' : 'bg-emerald-500'}`}
                    style={{ width: `${deployProgress}%` }}
                  />
                </div>
              </div>
            )}

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
        {activeTab !== 'deploy' && <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            onClick={() => handleSave(activeTab)}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50 w-full sm:w-auto"
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

      {/* トースト通知 */}
      {toast && (
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:bottom-6 sm:right-6 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
          <div
            className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
              toast.type === 'success'
                ? 'bg-emerald-600 text-white'
                : 'bg-red-600 text-white'
            }`}
          >
            {toast.type === 'success' ? (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            )}
            {toast.message}
            <button onClick={() => setToast(null)} className="ml-2 opacity-70 hover:opacity-100">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
