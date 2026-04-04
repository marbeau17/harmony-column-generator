// ============================================================================
// src/app/(dashboard)/dashboard/settings/page.tsx
// システム設定ページ — タブ構成（基本/AI/CTA/SEO）
// ============================================================================
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

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
  bannerUrl: string;
  bannerAlt: string;
}

interface CTASettings {
  cta1: CtaItemSettings;
  cta2: CtaItemSettings;
  cta3: CtaItemSettings;
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
  bannerUrl: '',
  bannerAlt: '',
};

const DEFAULT_CTA: CTASettings = {
  cta1: {
    ...DEFAULT_CTA_ITEM,
    url: 'https://harmony-mc.com/counseling/',
    buttonText: 'カウンセリングについて詳しく見る',
    bannerAlt: 'スピリチュアルカウンセリングのご案内',
  },
  cta2: {
    ...DEFAULT_CTA_ITEM,
    url: 'https://harmony-mc.com/system/',
    buttonText: 'ご予約の流れを確認する',
    bannerAlt: 'カウンセリングご予約の流れ',
  },
  cta3: {
    ...DEFAULT_CTA_ITEM,
    url: 'https://harmony-booking.web.app/',
    buttonText: 'カウンセリングを予約する',
    bannerAlt: 'カウンセリングのご予約',
  },
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
          cta1: { ...DEFAULT_CTA.cta1, ...(data.cta.cta1 || {}) },
          cta2: { ...DEFAULT_CTA.cta2, ...(data.cta.cta2 || {}) },
          cta3: { ...DEFAULT_CTA.cta3, ...(data.cta.cta3 || {}) },
        });
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
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
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
      <div className="rounded-xl bg-white p-6 shadow-sm">
        {/* ─── 基本設定 ─── */}
        {activeTab === 'basic' && (
          <div className="space-y-5 max-w-xl">
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
          <div className="space-y-5 max-w-xl">
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
          <div className="space-y-8 max-w-2xl">
            {/* CTA1: カウンセリング説明ページ */}
            <div className="rounded-lg border-2 border-blue-200 bg-blue-50/30 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-500 text-xs font-bold text-white">1</span>
                  <h3 className="text-sm font-semibold text-gray-800">
                    導入部（カウンセリング説明ページ）
                  </h3>
                </div>
                <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-medium">情報提供</span>
              </div>
              <div>
                <label className={labelClass}>リンク先 URL</label>
                <input
                  type="url"
                  value={cta.cta1.url}
                  onChange={(e) =>
                    updateCTA({ ...cta, cta1: { ...cta.cta1, url: e.target.value } })
                  }
                  placeholder="https://harmony-mc.com/counseling/"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>ボタンテキスト</label>
                <input
                  type="text"
                  value={cta.cta1.buttonText}
                  onChange={(e) =>
                    updateCTA({ ...cta, cta1: { ...cta.cta1, buttonText: e.target.value } })
                  }
                  placeholder="カウンセリングについて詳しく見る"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>キャッチコピー（上書き用・空欄でテーマ別自動選択）</label>
                <textarea
                  rows={2}
                  value={cta.cta1.catchText}
                  onChange={(e) =>
                    updateCTA({ ...cta, cta1: { ...cta.cta1, catchText: e.target.value } })
                  }
                  placeholder="テーマ別テンプレートから自動選択されます"
                  className={textareaClass}
                />
              </div>
              <div>
                <label className={labelClass}>サブテキスト（上書き用・空欄でテーマ別自動選択）</label>
                <textarea
                  rows={2}
                  value={cta.cta1.subText}
                  onChange={(e) =>
                    updateCTA({ ...cta, cta1: { ...cta.cta1, subText: e.target.value } })
                  }
                  placeholder="テーマ別テンプレートから自動選択されます"
                  className={textareaClass}
                />
              </div>
              {cta.cta1.bannerUrl && (
                <div>
                  <label className={labelClass}>バナー画像プレビュー</label>
                  <img
                    src={cta.cta1.bannerUrl}
                    alt={cta.cta1.bannerAlt || 'CTA1バナー'}
                    className="w-full rounded-lg border border-gray-200"
                  />
                </div>
              )}
            </div>

            {/* CTA2: 予約の流れページ */}
            <div className="rounded-lg border-2 border-amber-200 bg-amber-50/30 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">2</span>
                  <h3 className="text-sm font-semibold text-gray-800">
                    中盤（予約の流れページ）
                  </h3>
                </div>
                <span className="text-xs bg-amber-50 text-amber-600 px-2 py-0.5 rounded font-medium">検討促進</span>
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
              {cta.cta2.bannerUrl && (
                <div>
                  <label className={labelClass}>バナー画像プレビュー</label>
                  <img
                    src={cta.cta2.bannerUrl}
                    alt={cta.cta2.bannerAlt || 'CTA2バナー'}
                    className="w-full rounded-lg border border-gray-200"
                  />
                </div>
              )}
            </div>

            {/* CTA3: 予約ページ */}
            <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50/30 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white">3</span>
                  <h3 className="text-sm font-semibold text-gray-800">
                    末尾（予約ページ）
                  </h3>
                </div>
                <span className="text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded font-medium">コンバージョン</span>
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
              {cta.cta3.bannerUrl && (
                <div>
                  <label className={labelClass}>バナー画像プレビュー</label>
                  <img
                    src={cta.cta3.bannerUrl}
                    alt={cta.cta3.bannerAlt || 'CTA3バナー'}
                    className="w-full rounded-lg border border-gray-200"
                  />
                </div>
              )}
            </div>

            {/* アクションボタン */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setCTA(DEFAULT_CTA)}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                デフォルトに戻す
              </button>
              <button
                onClick={async () => {
                  try {
                    setSaving(true);
                    setSaveMessage('バナー画像を生成中...（数分かかる場合があります）');
                    const res = await fetch('/api/cta/generate-banners', { method: 'POST' });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data?.error ?? 'バナー生成に失敗しました');
                    // 生成結果をCTA設定に反映
                    let updatedCta = { ...cta };
                    if (data.banners) {
                      for (const banner of data.banners) {
                        const key = banner.position as 'cta1' | 'cta2' | 'cta3';
                        if (updatedCta[key]) {
                          updatedCta[key] = {
                            ...updatedCta[key],
                            bannerUrl: banner.url,
                            bannerAlt: banner.alt || updatedCta[key].bannerAlt,
                          };
                        }
                      }
                      setCTA(updatedCta);
                    }

                    // バナーURL を含むCTA設定を自動保存
                    setSaveMessage('バナー画像を保存中...');
                    const saveRes = await fetch('/api/settings', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ section: 'cta', data: updatedCta }),
                    });
                    if (!saveRes.ok) {
                      console.warn('[settings] CTA auto-save after banner generation failed');
                    }

                    const errorInfo = data.errors?.length
                      ? ` (${data.errors.length}件失敗)`
                      : '';
                    setSaveMessage(`バナー画像を${data.banners?.length ?? 0}枚生成・保存しました${errorInfo}`);
                    setTimeout(() => setSaveMessage(null), 8000);
                  } catch (err: any) {
                    setSaveMessage(`エラー: ${err.message}`);
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
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
                バナー画像を再生成
              </button>
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
                  updateSEO({ ...seo, author_jsonld: e.target.value })
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
                  updateSEO({ ...seo, disclaimer: e.target.value })
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
              {/* FTP未設定警告 */}
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <p className="text-xs text-amber-700">
                  FTP接続情報が .env.local に設定されていない場合、デプロイは失敗します。サーバー管理者に確認してください。
                </p>
              </div>
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

      {/* トースト通知 */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
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
