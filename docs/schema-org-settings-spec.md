# Schema.org 構造化データ設定機能 仕様書（P5-18）

**Author:** Planner
**Date:** 2026-05-02
**Scope:** 既存ハードコード化されている schema.org/JSON-LD 値を `settings.seo` から
読み込めるようにし、ダッシュボードの設定 UI から編集可能にする。

---

## 1. 背景と目的

### 1.1 現状の問題
`src/lib/seo/structured-data.ts` は以下の値をすべて**ハードコード**で持っている:
- 著者名「小林由起子」、職業「スピリチュアルカウンセラー」
- 著者プロフィール URL `/profile`
- 著者の `knowsAbout` 5 項目
- サイト URL `https://harmony-mc.com`
- 発行元 `Harmony スピリチュアルコラム`、ロゴ `/logo.png`
- パンくず「ホーム」「コラム」ラベル
- 既定 OG 画像 `/og-default.jpg`

設定ページの SEO タブには「著者プロフィール JSON-LD」テキストエリアが存在するが、
**どこからも読み込まれていない**（書いても無視される）。

### 1.2 ゴール
1. 全サイト共通の schema.org 値を **`settings.seo`** に格納し、`structured-data.ts` から参照
2. ダッシュボード `/dashboard/settings` の SEO タブで構造化フォーム UI から編集可能に
3. 既存挙動を破壊しない（未設定時はハードコード値をデフォルトとしてそのまま使う）
4. JSON-LD 出力（記事個別 + ハブ）の Search Console / Schema.org Validator で **エラーゼロ** を維持

### 1.3 非ゴール
- 記事個別の schema 編集 UI（記事ごとの override は v2 以降）
- 新規 schema 追加（HowTo / Speakable / WebSite）— v2 候補
- 多言語対応（現状 `inLanguage: 'ja'` 固定のまま）

---

## 2. 設計

### 2.1 ストレージ（既存テーブル拡張）
`settings` テーブル `(key TEXT PK, value JSONB)` の `key='seo'` 行を拡張。
**マイグレーション不要**（JSONB に追加フィールドを書くだけ）。

```jsonc
// settings.seo (JSONB)
{
  // ─── サイト基本 ─────────────────────────────────
  "site_url":             "https://harmony-mc.com",
  "site_name":            "Harmony スピリチュアルコラム",
  "site_logo_url":        "https://harmony-mc.com/logo.png",
  "og_default_image_url": "https://harmony-mc.com/og-default.jpg",

  // ─── 著者 (Person) ─────────────────────────────
  "author_name":         "小林由起子",
  "author_job_title":    "スピリチュアルカウンセラー",
  "author_profile_url":  "https://harmony-mc.com/profile",
  "author_image_url":    "",
  "author_bio":          "",
  "author_same_as":      [],            // Twitter / Ameblo / Instagram URLs
  "author_knows_about":  ["霊視", "前世リーディング", "カルマ", "チャクラ", "エネルギーワーク"],

  // ─── 発行元 (Organization) ─────────────────────
  "publisher_name":      "Harmony スピリチュアルコラム",
  "publisher_url":       "https://harmony-mc.com",
  "publisher_logo_url":  "https://harmony-mc.com/logo.png",

  // ─── パンくず ────────────────────────────────
  "breadcrumb_home_label":    "ホーム",
  "breadcrumb_section_label": "コラム",
  "breadcrumb_section_url":   "/column",

  // ─── スキーマ ON/OFF ──────────────────────────
  "enable_article_schema":    true,
  "enable_faq_schema":        true,
  "enable_breadcrumb_schema": true,
  "enable_person_schema":     true,

  // ─── 既存（後方互換）─────────────────────────
  "author_jsonld": "",   // 自由記述 JSON-LD（指定があれば Person を override）
  "disclaimer":    ""    // 免責事項テキスト（既存機能、touch なし）
}
```

### 2.2 ローダ
新規 `src/lib/seo/seo-settings.ts`:
- `getSeoSettings(): Promise<SeoSettings>` — `settings.seo` から読込。未設定フィールドはデフォルト値（現行ハードコード値）でマージ
- `DEFAULT_SEO_SETTINGS: SeoSettings` — 公開定数（テスト・SSR fallback 用）
- `mergeSeoSettings(partial: Partial<SeoSettings>): SeoSettings` — 純粋関数

### 2.3 `structured-data.ts` リファクタ
全 generator 関数に `settings: SeoSettings` を受け取らせる:

```ts
generateArticleSchema(article, settings)
generatePersonSchema(settings)
generateFullSchema(article, settings)        // settings 任意、未指定時は DEFAULT_SEO_SETTINGS
generateFullSchema(article)                  // 既存呼出は引数 1 で動作（後方互換）
```

`SITE_URL` / `PERSON_INFO` 定数は `DEFAULT_SEO_SETTINGS` へ移動して廃止。

### 2.4 呼出側
1. `src/app/column/[slug]/page.tsx` — Next.js public page。Server Component で `getSeoSettings()` を await して generator に渡す
2. `src/lib/generators/article-html-generator.ts` — FTP エクスポート用。caller (e.g. `zero-gen-publish.ts`, deploy route) で settings を取得して渡す。
3. 後方互換: 引数なしで呼ぶと `DEFAULT_SEO_SETTINGS` で動く（既存挙動温存）

### 2.5 UI（`/dashboard/settings` SEO タブ）
構造化フォームに置換:

```
┌── サイト基本 ──┐
| サイト URL ___|
| サイト名 ___|
| サイトロゴ URL ___|
| OG 既定画像 URL ___|
└────────────┘

┌── 著者 (Person) ──┐
| 著者名 ___        |
| 職業 ___          |
| プロフィール URL ___|
| 著者画像 URL ___   |
| 自己紹介 [textarea]|
| sameAs (1 行 1 URL)|
| 専門分野 (1 行 1 タグ)|
└──────────────────┘

┌── 発行元 (Organization) ──┐
| 発行元名 ___              |
| 発行元 URL ___            |
| ロゴ URL ___              |
└──────────────────────────┘

┌── パンくず ──┐
| ホームラベル ___       |
| セクションラベル ___    |
| セクション URL ___     |
└──────────────────────┘

┌── スキーマ ON/OFF ──┐
| ☑ Article (記事)        |
| ☑ FAQPage (FAQ)         |
| ☑ BreadcrumbList (パンくず)|
| ☑ Person (著者)          |
└──────────────────────┘

[詳細: カスタム JSON-LD] (折りたたみ)
| author_jsonld textarea (override 用、互換維持)
| disclaimer textarea (既存)

[💾 保存]
[📋 プレビュー: 生成される @graph を表示]
```

### 2.6 検証

| 項目 | 期待値 |
|---|---|
| 既存の自動デプロイ記事 (cc1d079a / #71) | DEFAULT_SEO_SETTINGS で従来通り JSON-LD が出力される |
| settings.seo を未保存の状態 | フィールド全部空 / null でも fallback でデフォルト値を使用 |
| 任意のフィールドだけ保存 | 保存したフィールドだけ反映、残りはデフォルト |
| Schema.org Validator | エラー 0、警告 0 |
| Google Rich Results Test | Article / FAQPage が green |

---

## 3. 実装順 (10 並列を意識した分解)

| # | ファイル | 変更内容 | 並列可? |
|---|---|---|---|
| F1 | `src/lib/validators/settings.ts` | `seoSettingsSchema` を構造化フィールドへ拡張（既存 author_jsonld / disclaimer は optional 維持） | ✅ |
| F2 | `src/lib/seo/seo-settings.ts` | NEW: 型定義 + DEFAULT + loader + merge | ✅ |
| F3 | `src/lib/seo/structured-data.ts` | settings 引数化、定数廃止 | F2 後 |
| F4 | `src/lib/generators/article-html-generator.ts` | options に settings、generator へ pass-through | F3 後 |
| F5 | `src/app/column/[slug]/page.tsx` | getSeoSettings() 呼出 + pass | F2 後 |
| F6 | `src/app/(dashboard)/dashboard/settings/page.tsx` | SEO タブ構造化フォーム UI | F1 後 |
| F7 | `test/unit/seo-settings.test.ts` | NEW: defaults / merge / loader | F2 後 |
| F8 | `test/unit/structured-data.test.ts` (existing or new) | settings 適用ケース | F3 後 |
| F9 | `docs/schema-org-settings-spec.md` | このファイル | ✅ (済) |
| F10 | `docs/progress.md` | P5-18 章追記 | F1〜F8 後 |

依存: F1 → F6, F2 → F3 → F4, F5, F8

---

## 4. 受入基準

- AC-1: settings.seo 未設定でも記事生成 / public page が現状通り動く（regression なし）
- AC-2: 設定 UI から site_name / author_name / publisher_logo_url を変更すると JSON-LD に反映
- AC-3: `npx vitest run` 全 PASS（既存 + 新規 ≥10 ケース）
- AC-4: `npx tsc --noEmit` 0 errors
- AC-5: 設定 UI のフィールドが空欄 → デフォルト値が JSON-LD に反映される（空文字でなく）
- AC-6: 著者 sameAs[] / knows_about[] の追加・削除が UI からできる
- AC-7: schema トグル OFF にすると当該 schema が `@graph` から除外される

---

## 5. v2 候補（次サイクル）

- **HowTo schema**: intent='solve' の記事で h3 を steps 化して自動生成
- **WebSite schema**: サイト全体に 1 つ（sitelinks search box 対応）
- **Speakable schema**: 音声検索対応セクション指定
- **Article ごとの override**: articles テーブルに `seo_override` JSONB 列追加
- **Schema.org Validator 自動検証**: 公開前に validator API を叩いてエラーゲート
