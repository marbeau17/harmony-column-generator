// ============================================================================
// src/lib/seo/seo-settings.ts
// schema.org 構造化データの設定を `settings` テーブル (key='seo') から読み込む。
//
// 設計:
// - DEFAULT_SEO_SETTINGS: 全フィールドの fallback。旧 structured-data.ts の
//   ハードコード値をそのまま移植 (regression 0)。
// - mergeSeoSettings: settings.seo の partial JSON を default にマージ。
//   空文字 / null / undefined は default を使う (UI 空欄時の救済)。
// - getSeoSettings: Supabase service role で 1 行取得。read-only。
//
// 仕様書: docs/schema-org-settings-spec.md
// ============================================================================

import { createServiceRoleClient } from '@/lib/supabase/server';
import { getHubPath } from '@/lib/config/public-urls';

// ─── 型定義 ─────────────────────────────────────────────────────────────────

export interface SeoSettings {
  // サイト基本
  site_url: string;
  site_name: string;
  site_logo_url: string;
  og_default_image_url: string;

  // 著者 (Person)
  author_name: string;
  author_job_title: string;
  author_profile_url: string;
  author_image_url: string;
  author_bio: string;
  author_same_as: string[];
  author_knows_about: string[];

  // 発行元 (Organization)
  publisher_name: string;
  publisher_url: string;
  publisher_logo_url: string;

  // パンくず
  breadcrumb_home_label: string;
  breadcrumb_section_label: string;
  breadcrumb_section_url: string;

  // スキーマ ON/OFF
  enable_article_schema: boolean;
  enable_faq_schema: boolean;
  enable_breadcrumb_schema: boolean;
  enable_person_schema: boolean;

  // 後方互換 (既存)
  author_jsonld: string;
  disclaimer: string;
}

// ─── デフォルト ─────────────────────────────────────────────────────────────

export const DEFAULT_SEO_SETTINGS: SeoSettings = {
  // サイト基本
  site_url: 'https://harmony-mc.com',
  site_name: 'Harmony スピリチュアルコラム',
  site_logo_url: 'https://harmony-mc.com/logo.png',
  og_default_image_url: 'https://harmony-mc.com/og-default.jpg',

  // 著者
  author_name: '小林由起子',
  author_job_title: 'スピリチュアルカウンセラー',
  author_profile_url: 'https://harmony-mc.com/profile',
  author_image_url: '',
  author_bio: '',
  author_same_as: [],
  author_knows_about: [
    '霊視',
    '前世リーディング',
    'カルマ',
    'チャクラ',
    'エネルギーワーク',
  ],

  // 発行元
  publisher_name: 'Harmony スピリチュアルコラム',
  publisher_url: 'https://harmony-mc.com',
  publisher_logo_url: 'https://harmony-mc.com/logo.png',

  // パンくず
  breadcrumb_home_label: 'ホーム',
  breadcrumb_section_label: 'コラム',
  // P5-44: 実 FTP 配置 (NEXT_PUBLIC_HUB_PATH, default '/spiritual/column') と整合させる。
  // DB settings.seo.breadcrumb_section_url が存在すれば mergeSeoSettings で上書きされる。
  breadcrumb_section_url: getHubPath(),

  // スキーマ ON/OFF
  enable_article_schema: true,
  enable_faq_schema: true,
  enable_breadcrumb_schema: true,
  enable_person_schema: true,

  // 後方互換
  author_jsonld: '',
  disclaimer: '',
};

// ─── マージ ─────────────────────────────────────────────────────────────────

/**
 * 部分的な seo settings を DEFAULT_SEO_SETTINGS に重ね合わせる。
 *
 * - undefined / null は default を採用
 * - 空文字 (string) は default を採用 (UI で消した場合の救済)
 * - 空配列 (array) はそのまま（明示的に「無し」を選択した可能性があるため）
 * - boolean false は尊重 (toggle OFF を上書きしないため)
 */
export function mergeSeoSettings(partial: Partial<SeoSettings> | null | undefined): SeoSettings {
  if (!partial || typeof partial !== 'object') return { ...DEFAULT_SEO_SETTINGS };
  const out = { ...DEFAULT_SEO_SETTINGS };
  for (const k of Object.keys(DEFAULT_SEO_SETTINGS) as Array<keyof SeoSettings>) {
    const v = (partial as Record<string, unknown>)[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v === '' && typeof DEFAULT_SEO_SETTINGS[k] === 'string') continue;
    // 型整合: 配列フィールドは Array でなければ skip
    if (Array.isArray(DEFAULT_SEO_SETTINGS[k])) {
      if (!Array.isArray(v)) continue;
    }
    // boolean は尊重 (false も許容)
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

// ─── ローダ ─────────────────────────────────────────────────────────────────

/**
 * `settings` テーブル (key='seo') から SEO 設定を読み込む。
 * 行が無い・取得失敗時は DEFAULT_SEO_SETTINGS を返す (sentry alert なし、ログ警告のみ)。
 */
export async function getSeoSettings(): Promise<SeoSettings> {
  try {
    const supabase = await createServiceRoleClient();
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'seo')
      .maybeSingle();
    if (error) {
      console.warn('[seo-settings.load.failed]', { error_message: error.message });
      return { ...DEFAULT_SEO_SETTINGS };
    }
    const partial = (data?.value as Partial<SeoSettings> | null) ?? null;
    return mergeSeoSettings(partial);
  } catch (e) {
    console.warn('[seo-settings.load.failed]', {
      error_message: (e as Error).message,
    });
    return { ...DEFAULT_SEO_SETTINGS };
  }
}
