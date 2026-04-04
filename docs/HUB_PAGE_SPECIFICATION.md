# ハブページ設計仕様書 v1.0

**プロジェクト:** harmony-column-generator  
**作成日:** 2026-04-03  
**設計チーム:** 20名エキスパートチーム  
**対象URL:** https://harmony-mc.com/column/ 配下

---

## 目次

1. [設計方針と全体アーキテクチャ](#1-設計方針と全体アーキテクチャ)
2. [ヘッダー・フッター共有方式](#2-ヘッダーフッター共有方式)
3. [ファイル構成](#3-ファイル構成)
4. [ハブページHTML設計](#4-ハブページhtml設計)
5. [カテゴリフィルタ設計](#5-カテゴリフィルタ設計)
6. [CTA配置設計](#6-cta配置設計)
7. [記事自動追加・更新メカニズム](#7-記事自動追加更新メカニズム)
8. [サムネイル画像管理](#8-サムネイル画像管理)
9. [既存 /column/ との共存](#9-既存-column-との共存)
10. [SEO・構造化データ](#10-seo構造化データ)
11. [レスポンシブ・アクセシビリティ](#11-レスポンシブアクセシビリティ)
12. [パフォーマンス最適化](#12-パフォーマンス最適化)
13. [世界観の統一性](#13-世界観の統一性)
14. [テスト項目](#14-テスト項目)
15. [実装ファイルリスト](#15-実装ファイルリスト)

---

## 1. 設計方針と全体アーキテクチャ

### 1.1 コア方針

- **完全シームレス**: 訪問者がWordPressサイトからハブページに遷移しても違和感ゼロ
- **静的HTML運用**: CMSに依存せず、FTPで直接アップロード
- **自動化**: 記事の公開・修正をトリガーにハブページHTMLを再生成→FTP再アップロード
- **SEO最適化**: WordPress側 /column/ と競合しない設計

### 1.2 アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────┐
│  管理画面 (Next.js on Vercel)                            │
│  ┌──────────┐   ┌──────────────┐   ┌─────────────────┐ │
│  │ 記事編集  │──▶│ ステータス遷移 │──▶│ published 状態  │ │
│  └──────────┘   │  (API)       │   └────────┬────────┘ │
│                  └──────────────┘            │          │
│                                              ▼          │
│                              ┌──────────────────────┐   │
│                              │ ハブページ再生成API    │   │
│                              │ POST /api/hub/rebuild │   │
│                              └──────────┬───────────┘   │
│                                         │               │
│                                         ▼               │
│                              ┌──────────────────────┐   │
│                              │ 静的HTML生成          │   │
│                              │ - index.html          │   │
│                              │ - page/2/index.html   │   │
│                              │ - page/3/index.html   │   │
│                              └──────────┬───────────┘   │
│                                         │               │
│                                         ▼               │
│                              ┌──────────────────────┐   │
│                              │ FTPアップロード        │   │
│                              │ → harmony-mc.com      │   │
│                              │   /column/columns/    │   │
│                              └──────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 1.3 議論の結論

| 議題 | 結論 | 理由 |
|------|------|------|
| ヘッダー/フッター共有方式 | **静的HTMLコピー** | SSIはサーバ依存、iframeはSEO不利。WordPressのHTMLを模写した静的HTMLが最も安定 |
| URL構造 | `/column/columns/` 配下に配置 | 既存 `/column/` はWP管理のため競合回避。サブディレクトリで共存 |
| ハブページ再生成タイミング | 記事published遷移時 + 手動rebuild | 自動化と手動の両対応 |
| カテゴリフィルタ | JS切り替え（静的HTML内） | サーバサイド処理不要、FTP静的運用に適合 |
| ページネーション | 静的ファイル分割（10件/ページ） | WP側と同じ10件/ページで統一 |

---

## 2. ヘッダー・フッター共有方式

### 2.1 採用方式: 静的HTMLコピー

WordPress Lightning G2テーマのヘッダー・フッターHTMLを **そのままの構造・クラス名で再現** する。
CSSもWordPressテーマのスタイルシートを外部参照する。

### 2.2 ヘッダー構造

```html
<header class="siteHeader">
  <div class="siteHeader_inner">
    <div class="siteHeader_logo">
      <a href="https://harmony-mc.com/">
        <img src="https://harmony-mc.com/wp-content/themes/lightning/images/brand.png"
             alt="Harmony MC" class="siteHeader_logo_img">
      </a>
    </div>
    <nav class="gMenu">
      <ul class="gMenu_list">
        <li class="gMenu_item"><a href="https://harmony-mc.com/">トップ</a></li>
        <li class="gMenu_item"><a href="https://harmony-mc.com/counseling/">カウンセリング</a></li>
        <li class="gMenu_item"><a href="https://harmony-mc.com/course/">講座</a></li>
        <li class="gMenu_item"><a href="https://harmony-mc.com/book/">書籍</a></li>
        <li class="gMenu_item"><a href="https://harmony-mc.com/profile/">プロフィール</a></li>
        <li class="gMenu_item current"><a href="https://harmony-mc.com/column/">コラム</a></li>
      </ul>
    </nav>
    <button class="menuBtn" aria-label="メニュー" aria-expanded="false">
      <span class="menuBtn_line"></span>
      <span class="menuBtn_line"></span>
      <span class="menuBtn_line"></span>
    </button>
  </div>
</header>
```

### 2.3 フッター構造

```html
<footer class="siteFooter">
  <div class="siteFooter_inner">
    <nav class="siteFooter_nav">
      <ul>
        <li><a href="https://harmony-mc.com/">トップ</a></li>
        <li><a href="https://harmony-mc.com/counseling/">カウンセリング</a></li>
        <li><a href="https://harmony-mc.com/course/">講座</a></li>
        <li><a href="https://harmony-mc.com/book/">書籍</a></li>
        <li><a href="https://harmony-mc.com/profile/">プロフィール</a></li>
        <li><a href="https://harmony-mc.com/column/">コラム</a></li>
      </ul>
    </nav>
    <p class="siteFooter_copyright">&copy; Harmony MC. All rights reserved.</p>
  </div>
</footer>
```

### 2.4 CSS読み込み戦略

```html
<!-- WordPress側のテーマCSS（キャッシュ対策でバージョン付き） -->
<link rel="stylesheet" href="https://harmony-mc.com/wp-content/themes/lightning/style.css?v=20260403">
<!-- ハブページ固有のCSS -->
<link rel="stylesheet" href="./css/hub.css">
```

**重要**: WordPress側のCSS更新に追従するため、`hub.css` はテーマCSSを **上書きせず補完** する設計とする。
定期的にWPテーマCSSの変更を監視し、ヘッダー/フッターHTMLを更新する運用ルールを設ける。

### 2.5 モバイルナビゲーション

```javascript
// ハンバーガーメニュー（WP Lightning G2互換）
document.querySelector('.menuBtn').addEventListener('click', function() {
  this.classList.toggle('is-active');
  this.setAttribute('aria-expanded',
    this.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
  document.querySelector('.gMenu').classList.toggle('is-open');
});
```

---

## 3. ファイル構成

### 3.1 FTPアップロード先ディレクトリ

```
harmony-mc.com/
└── column/
    └── columns/                    ← ハブページ + 個別記事
        ├── index.html              ← ハブページ1ページ目
        ├── page/
        │   ├── 2/
        │   │   └── index.html      ← ハブページ2ページ目
        │   ├── 3/
        │   │   └── index.html
        │   └── .../
        ├── css/
        │   └── hub.css             ← ハブページ専用CSS
        ├── js/
        │   └── hub.js              ← フィルタ・ナビ用JS
        ├── images/
        │   ├── cta-banner.webp     ← CTA用バナー
        │   └── no-image.webp       ← サムネなし時のフォールバック
        ├── articles/               ← 個別記事HTML
        │   ├── {slug}.html
        │   ├── {slug}.html
        │   └── .../
        ├── placeholders/           ← 記事画像（既存の仕組みを継承）
        │   ├── {image}.webp
        │   └── .../
        ├── thumbnails/             ← ハブページ用サムネイル（150x150）
        │   ├── {slug}-thumb.webp
        │   └── .../
        └── sitemap-columns.xml     ← 記事群のサイトマップ
```

### 3.2 ローカル生成先（ビルド時）

```
blogauto/
└── dist/
    └── hub/                        ← 生成物の出力先
        ├── index.html
        ├── page/
        ├── css/
        ├── js/
        ├── images/
        ├── articles/
        ├── placeholders/
        ├── thumbnails/
        └── sitemap-columns.xml
```

---

## 4. ハブページHTML設計

### 4.1 レイアウト

WordPress Lightning G2と同じ **2カラムレイアウト（メイン左 + サイドバー右）** を採用。

```
┌──────────────────────────────────────────────────┐
│ [siteHeader]  ロゴ + gMenuナビ                     │
├──────────────────────────────────────────────────┤
│ [パンくず]  ホーム > コラム > スピリチュアルコラム      │
├──────────────────────┬───────────────────────────┤
│ [mainSection]        │ [subSection]              │
│                      │                           │
│ カテゴリフィルタタブ   │ CTA: 予約バナー            │
│                      │                           │
│ ┌──────────────────┐ │ カテゴリ一覧               │
│ │ [entry] 記事カード │ │                           │
│ │ 150x150 サムネ    │ │ 人気記事ランキング          │
│ │ 日付 / カテゴリ    │ │                           │
│ │ タイトル          │ │ プロフィール               │
│ │ 抜粋テキスト      │ │                           │
│ └──────────────────┘ │                           │
│ （×10件）            │                           │
│                      │                           │
│ [pager]              │                           │
│ ≪ 1 2 3 ... ≫       │                           │
├──────────────────────┴───────────────────────────┤
│ [siteFooter]                                     │
└──────────────────────────────────────────────────┘
```

### 4.2 記事カード仕様

WordPress側と完全に同じ構造:

```html
<article class="entry">
  <a href="./articles/{slug}.html" class="entry_link">
    <div class="entry_thumbnail">
      <img src="./thumbnails/{slug}-thumb.webp"
           alt="{title}" width="150" height="150"
           loading="lazy"
           onerror="this.src='./images/no-image.webp'">
    </div>
    <div class="entry_body">
      <div class="entry_meta">
        <time class="entry_date" datetime="{ISO日付}">{YYYY年MM月DD日}</time>
        <span class="entry_category">{カテゴリ名}</span>
      </div>
      <h2 class="entry_title">{タイトル}</h2>
      <p class="entry_excerpt">{meta_descriptionから80文字}</p>
    </div>
  </a>
</article>
```

### 4.3 ページネーション

```html
<nav class="pager" aria-label="ページナビゲーション">
  <ul class="pager_list">
    <li><a class="page-numbers prev" href="./page/{prev}/index.html" rel="prev">前へ</a></li>
    <li><a class="page-numbers" href="../index.html">1</a></li>
    <li><span class="page-numbers current" aria-current="page">2</span></li>
    <li><a class="page-numbers" href="./page/3/index.html">3</a></li>
    <li><a class="page-numbers next" href="./page/{next}/index.html" rel="next">次へ</a></li>
  </ul>
</nav>
```

---

## 5. カテゴリフィルタ設計

### 5.1 方式: JavaScript クライアントサイドフィルタ

全記事カードに `data-theme` 属性を付与し、JSでshow/hideを切り替える。
ページネーションのある場合は **1ページ目のフィルタはJS** 、 **ページ遷移後は全件表示** とする。

### 5.2 フィルタUI

```html
<div class="theme-filter" role="tablist" aria-label="テーマフィルタ">
  <button class="theme-filter_btn is-active" data-filter="all" role="tab" aria-selected="true">すべて</button>
  <button class="theme-filter_btn" data-filter="soul_mission" role="tab" aria-selected="false">魂と使命</button>
  <button class="theme-filter_btn" data-filter="relationships" role="tab" aria-selected="false">人間関係</button>
  <button class="theme-filter_btn" data-filter="grief_care" role="tab" aria-selected="false">グリーフケア</button>
  <button class="theme-filter_btn" data-filter="self_growth" role="tab" aria-selected="false">自己成長</button>
  <button class="theme-filter_btn" data-filter="healing" role="tab" aria-selected="false">癒しと浄化</button>
  <button class="theme-filter_btn" data-filter="daily_awareness" role="tab" aria-selected="false">日常の気づき</button>
  <button class="theme-filter_btn" data-filter="spiritual_intro" role="tab" aria-selected="false">スピリチュアル入門</button>
</div>
```

### 5.3 テーマ→日本語ラベルマッピング

| theme値 | 表示名 |
|---------|--------|
| soul_mission | 魂と使命 |
| relationships | 人間関係 |
| grief_care | グリーフケア |
| self_growth | 自己成長 |
| healing | 癒しと浄化 |
| daily_awareness | 日常の気づき |
| spiritual_intro | スピリチュアル入門 |

---

## 6. CTA配置設計

### 6.1 ハブページ内CTA（3箇所）

| 配置位置 | タイプ | 文言 |
|---------|--------|------|
| **サイドバー上部** | バナー（固定表示） | 「あなたの魂の声を聴いてみませんか？」→ 予約ボタン |
| **記事カード5件目の後** | インライン横長バナー | 「人生の転機に、スピリチュアルカウンセリング」→ 無料相談ボタン |
| **ページ下部（フッター前）** | フルワイドバナー | 「小林由起子のスピリチュアルセッション」→ 予約ボタン |

### 6.2 CTA HTML

```html
<!-- サイドバーCTA -->
<div class="sidebar-cta">
  <div class="sidebar-cta_inner">
    <p class="sidebar-cta_heading">あなたの魂の声を<br>聴いてみませんか？</p>
    <p class="sidebar-cta_text">スピリチュアルカウンセラー小林由起子が、あなたの魂の成長をサポートします。</p>
    <a href="https://harmony-booking.web.app/" class="sidebar-cta_btn" target="_blank" rel="noopener">
      セッションを予約する
    </a>
  </div>
</div>

<!-- インラインCTA（5件目の後に挿入） -->
<div class="inline-cta">
  <div class="inline-cta_inner">
    <p class="inline-cta_heading">人生の転機に、スピリチュアルカウンセリング</p>
    <a href="https://harmony-booking.web.app/" class="inline-cta_btn" target="_blank" rel="noopener">
      無料相談はこちら
    </a>
  </div>
</div>

<!-- フッターCTA -->
<div class="footer-cta">
  <div class="footer-cta_inner">
    <h3 class="footer-cta_heading">小林由起子のスピリチュアルセッション</h3>
    <p class="footer-cta_text">20年以上の経験を持つスピリチュアルカウンセラーが、<br>あなたの魂の旅をサポートします。</p>
    <div class="footer-cta_buttons">
      <a href="https://harmony-booking.web.app/" class="footer-cta_btn primary" target="_blank" rel="noopener">セッション予約</a>
      <a href="https://harmony-booking.web.app/" class="footer-cta_btn secondary" target="_blank" rel="noopener">無料相談</a>
    </div>
  </div>
</div>
```

---

## 7. 記事自動追加・更新メカニズム

### 7.1 トリガーフロー

```
記事ステータスが "published" に遷移
        │
        ▼
transitionArticleStatus() 内でフック実行
        │
        ▼
POST /api/hub/rebuild を内部コール
        │
        ▼
┌───────────────────────────┐
│ ハブページ再生成処理        │
│ 1. published記事を全取得    │
│ 2. ハブHTML生成（全ページ）   │
│ 3. サイトマップ生成          │
│ 4. FTPアップロード          │
└───────────────────────────┘
```

### 7.2 API設計

#### POST /api/hub/rebuild

```typescript
// リクエスト
POST /api/hub/rebuild
Authorization: Bearer {supabase_token}
Content-Type: application/json

// レスポンス
{
  "success": true,
  "pages_generated": 5,
  "articles_count": 48,
  "uploaded_files": ["index.html", "page/2/index.html", ...],
  "timestamp": "2026-04-03T10:30:00Z"
}
```

#### POST /api/hub/deploy

```typescript
// FTPアップロード専用エンドポイント（rebuild後に自動コール）
POST /api/hub/deploy
Authorization: Bearer {supabase_token}

// レスポンス
{
  "success": true,
  "files_uploaded": 12,
  "duration_ms": 3200
}
```

### 7.3 ハブページ生成ロジック（TypeScript）

```typescript
// src/lib/generators/hub-generator.ts

interface HubGeneratorInput {
  articles: PublishedArticleSummary[];
  perPage: number;        // デフォルト10
  baseUrl: string;        // https://harmony-mc.com/column/columns
  siteUrl: string;        // https://harmony-mc.com
}

interface PublishedArticleSummary {
  id: string;
  title: string;
  slug: string;
  theme: string;
  meta_description: string;
  published_at: string;
  thumbnail_url: string | null;
}

function generateHubPages(input: HubGeneratorInput): Map<string, string> {
  // Map<ファイルパス, HTML文字列>
  // "index.html" → 1ページ目HTML
  // "page/2/index.html" → 2ページ目HTML
  // ...
}
```

### 7.4 記事修正時の更新

記事を編集して再度 published にした場合:
1. `articles` テーブルの `updated_at` が更新される
2. 個別記事HTMLを再生成 → FTPアップロード
3. ハブページも再生成（タイトル・抜粋・サムネイルが変わっている可能性）

### 7.5 FTPアップロード

```typescript
// src/lib/deploy/ftp-uploader.ts

import * as ftp from 'basic-ftp';

interface FtpConfig {
  host: string;       // FTP_HOST 環境変数
  user: string;       // FTP_USER
  password: string;   // FTP_PASSWORD
  basePath: string;   // /public_html/column/columns/
  secure: boolean;    // FTPS使用
}

async function uploadToFtp(
  config: FtpConfig,
  files: Map<string, string | Buffer>,
): Promise<{ uploaded: string[]; failed: string[] }>;
```

環境変数:
```
FTP_HOST=harmony-mc.com
FTP_USER=xxxxx
FTP_PASSWORD=xxxxx
FTP_BASE_PATH=/public_html/column/columns/
FTP_SECURE=true
```

---

## 8. サムネイル画像管理

### 8.1 サムネイル生成

| 用途 | サイズ | フォーマット | 生成元 |
|------|--------|------------|--------|
| ハブページカード | 150x150 | WebP | hero画像からリサイズ・クロップ |
| OGP用 | 1200x630 | WebP | hero画像そのまま |

### 8.2 生成フロー

```
記事公開時
  │
  ├── hero画像（Banana Pro生成済み、Supabase Storage）
  │
  ├──▶ 150x150にリサイズ＋センタークロップ
  │    → thumbnails/{slug}-thumb.webp
  │
  └──▶ FTPアップロード
```

### 8.3 フォールバック

サムネイルが存在しない場合、グラデーション背景のプレースホルダー画像を表示:

```html
<img src="./thumbnails/{slug}-thumb.webp"
     alt="{title}"
     width="150" height="150"
     loading="lazy"
     onerror="this.src='./images/no-image.webp'">
```

---

## 9. 既存 /column/ との共存

### 9.1 URL設計

| コンテンツ | URL | 管理元 |
|-----------|-----|--------|
| WP既存コラム | `/column/` | WordPress |
| ハブページ | `/column/columns/` | 静的HTML (FTP) |
| 個別記事 | `/column/columns/articles/{slug}.html` | 静的HTML (FTP) |

### 9.2 WordPress側の設定

WP側に以下の対応が必要:
1. `/column/` ページ内にハブページへのリンクを追加
2. `.htaccess` で `/column/columns/` を静的ファイルとして配信（WordPressのルーティングをバイパス）

```apache
# .htaccess に追記
RewriteRule ^column/columns/ - [L]
```

### 9.3 内部リンク戦略

- WP側 `/column/` → ハブページ `/column/columns/` へのリンクバナーを設置
- ハブページ → WP側 `/column/` へのパンくずリンク
- 個別記事 → ハブページへの「コラム一覧に戻る」リンク

---

## 10. SEO・構造化データ

### 10.1 ハブページのメタ情報

```html
<title>スピリチュアルコラム一覧 | Harmony MC</title>
<meta name="description" content="スピリチュアルカウンセラー小林由起子が贈る、魂の成長と癒しのコラム集。霊視・前世リーディング・チャクラヒーリングなど幅広いテーマをお届けします。">
<link rel="canonical" href="https://harmony-mc.com/column/columns/">
```

### 10.2 構造化データ (JSON-LD)

```json
{
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  "name": "スピリチュアルコラム一覧",
  "description": "スピリチュアルカウンセラー小林由起子が贈る、魂の成長と癒しのコラム集。",
  "url": "https://harmony-mc.com/column/columns/",
  "isPartOf": {
    "@type": "WebSite",
    "name": "Harmony MC",
    "url": "https://harmony-mc.com/"
  },
  "mainEntity": {
    "@type": "ItemList",
    "numberOfItems": 48,
    "itemListElement": [
      {
        "@type": "ListItem",
        "position": 1,
        "url": "https://harmony-mc.com/column/columns/articles/{slug}.html",
        "name": "{記事タイトル}"
      }
    ]
  }
}
```

### 10.3 パンくずリスト

```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "ホーム", "item": "https://harmony-mc.com/" },
    { "@type": "ListItem", "position": 2, "name": "コラム", "item": "https://harmony-mc.com/column/" },
    { "@type": "ListItem", "position": 3, "name": "スピリチュアルコラム", "item": "https://harmony-mc.com/column/columns/" }
  ]
}
```

### 10.4 OGP

```html
<meta property="og:title" content="スピリチュアルコラム一覧 | Harmony MC">
<meta property="og:type" content="website">
<meta property="og:url" content="https://harmony-mc.com/column/columns/">
<meta property="og:image" content="https://harmony-mc.com/column/columns/images/ogp-hub.webp">
<meta property="og:description" content="スピリチュアルカウンセラー小林由起子が贈る、魂の成長と癒しのコラム集。">
<meta property="og:site_name" content="Harmony MC">
<meta property="og:locale" content="ja_JP">
```

### 10.5 サイトマップ

`sitemap-columns.xml` を生成し、WP側の `sitemap.xml` から参照する。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://harmony-mc.com/column/columns/</loc>
    <lastmod>2026-04-03</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://harmony-mc.com/column/columns/articles/{slug}.html</loc>
    <lastmod>2026-04-03</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
  <!-- ... -->
</urlset>
```

---

## 11. レスポンシブ・アクセシビリティ

### 11.1 ブレークポイント（WordPress Lightning G2準拠）

| 名称 | 幅 | レイアウト |
|------|-----|----------|
| デスクトップ | > 1020px | 2カラム（メイン + サイドバー） |
| タブレット | 768px - 1020px | 1カラム（サイドバーは下に移動） |
| モバイル | < 768px | 1カラム、ハンバーガーメニュー |

### 11.2 モバイル対応

- 記事カード: 横並び → 縦並び（1カラム）
- サムネイル: 150x150 → 記事左寄せ、テキスト右側
- カテゴリフィルタ: 横スクロール可能
- ページネーション: 省略形式（前/現在/次）

### 11.3 WCAG 2.1 AA 準拠

| 要件 | 実装 |
|------|------|
| コントラスト比 | #53352b on #fff = 10.5:1 (AAA), #b39578 on #fff = 3.2:1 (AA Large) |
| キーボード操作 | すべてのインタラクティブ要素にfocus可能 |
| スクリーンリーダー | aria-label, aria-current, role属性を適切に設定 |
| 画像代替テキスト | すべてのimg要素にalt属性 |
| ランドマーク | header, nav, main, footer, aside を使用 |
| フォーカス表示 | :focus-visible にアウトライン表示 |

---

## 12. パフォーマンス最適化

### 12.1 Core Web Vitals 目標

| 指標 | 目標値 |
|------|--------|
| LCP (Largest Contentful Paint) | < 2.5s |
| FID (First Input Delay) | < 100ms |
| CLS (Cumulative Layout Shift) | < 0.1 |
| INP (Interaction to Next Paint) | < 200ms |

### 12.2 最適化施策

| 施策 | 詳細 |
|------|------|
| 画像遅延読み込み | `loading="lazy"` + width/height指定でCLS防止 |
| WebPフォーマット | サムネイル・バナーすべてWebP |
| CSS最小化 | hub.css を minify して配信 |
| JS最小化 | hub.js を minify、defer属性で読み込み |
| プリコネクト | WordPressドメインへの `preconnect` |
| Critical CSS | ファーストビューに必要なCSSをインライン化 |
| フォント最適化 | システムフォント使用（WP側と同じsans-serif） |

### 12.3 画像最適化

```html
<!-- サムネイル: 150x150 WebP、平均5-10KB -->
<img src="./thumbnails/{slug}-thumb.webp"
     alt="{title}"
     width="150" height="150"
     loading="lazy"
     decoding="async">
```

---

## 13. 世界観の統一性

### 13.1 デザイン原則（スピリチュアルカウンセラー監修）

- **温かみ**: #b39578（ウォームブラウン）を基調とした安心感のある配色
- **落ち着き**: #53352b（ダークブラウン）でアクセントを加えつつ重厚感
- **清潔感**: #faf3ed（クリームベージュ）の背景で読みやすさを確保
- **スピリチュアル感**: 控えめで品のある装飾、過度なエフェクトは避ける
- **信頼感**: WordPressサイトと同じ雰囲気を維持し、「公式サイトの一部」として認識される

### 13.2 禁止事項

- 派手なアニメーション・エフェクト
- ネオンカラーや蛍光色
- 宗教的シンボルの多用
- 不安を煽るコピー

---

## 14. テスト項目

### 14.1 機能テスト

| # | テスト項目 | 期待結果 |
|---|-----------|---------|
| F01 | ハブページ表示 | 10件の記事カードが正しく表示される |
| F02 | ページネーション | 2ページ目以降に正しく遷移する |
| F03 | カテゴリフィルタ | 選択テーマの記事のみ表示される |
| F04 | 記事リンク | 個別記事ページに正しく遷移する |
| F05 | CTA | 3箇所のCTAが表示され、リンク先が正しい |
| F06 | ヘッダーナビ | 全リンクがWP本体の正しいURLに遷移する |
| F07 | モバイルメニュー | ハンバーガーメニューが開閉する |
| F08 | サムネイル表示 | 150x150で表示、画像なし時はフォールバック |
| F09 | 記事自動追加 | published遷移後、ハブに記事が追加される |
| F10 | 記事修正反映 | 記事を編集後、ハブの情報が更新される |

### 14.2 SEOテスト

| # | テスト項目 | 期待結果 |
|---|-----------|---------|
| S01 | canonical | 各ページに正しいcanonical URLが設定 |
| S02 | 構造化データ | Google Rich Results Testで警告なし |
| S03 | パンくず | 正しい階層構造で表示 |
| S04 | OGP | Facebook/Twitter共有時に正しく表示 |
| S05 | サイトマップ | 全記事URLが含まれ、XMLが有効 |
| S06 | robots | クロール可能な状態 |

### 14.3 レスポンシブテスト

| # | テスト項目 | デバイス | 期待結果 |
|---|-----------|---------|---------|
| R01 | 2カラム表示 | デスクトップ(1280px) | メイン+サイドバー |
| R02 | 1カラム表示 | タブレット(768px) | サイドバーが下に移動 |
| R03 | モバイル表示 | スマホ(375px) | 1カラム、ハンバーガー |
| R04 | カードレイアウト | 全サイズ | 崩れなし |

### 14.4 パフォーマンステスト

| # | テスト項目 | 基準 |
|---|-----------|------|
| P01 | Lighthouse スコア | Performance > 90 |
| P02 | LCP | < 2.5s |
| P03 | CLS | < 0.1 |
| P04 | 総ページサイズ | < 500KB |

### 14.5 クロスブラウザテスト

| ブラウザ | バージョン |
|---------|-----------|
| Chrome | 最新2バージョン |
| Safari | 最新2バージョン |
| Firefox | 最新2バージョン |
| Edge | 最新2バージョン |
| iOS Safari | iOS 16+ |
| Android Chrome | 最新 |

---

## 15. 実装ファイルリスト

### 15.1 新規作成ファイル

| ファイル | 説明 |
|---------|------|
| `src/lib/generators/hub-generator.ts` | ハブページHTML生成ロジック |
| `src/lib/deploy/ftp-uploader.ts` | FTPアップロードモジュール |
| `src/app/api/hub/rebuild/route.ts` | ハブページ再生成APIエンドポイント |
| `src/app/api/hub/deploy/route.ts` | FTPデプロイAPIエンドポイント |
| `src/lib/generators/hub-sitemap.ts` | サイトマップ生成 |
| `src/lib/generators/hub-thumbnail.ts` | サムネイルリサイズ処理 |
| `templates/hub/index.html` | ハブページHTMLテンプレート（参照用） |
| `templates/hub/css/hub.css` | ハブページ専用CSS |
| `templates/hub/js/hub.js` | カテゴリフィルタ・モバイルナビJS |
| `templates/hub/images/no-image.webp` | フォールバック画像 |
| `templates/hub/images/cta-banner.webp` | CTA用バナー画像 |

### 15.2 変更が必要な既存ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/lib/db/articles.ts` | `transitionArticleStatus()` にハブページ再生成フックを追加 |
| `src/app/api/articles/[id]/transition/route.ts` | published遷移時にrebuild APIをコール |
| `src/app/(dashboard)/dashboard/articles/page.tsx` | 「ハブページ再生成」ボタンを追加 |
| `package.json` | `basic-ftp` / `sharp` 依存関係を追加 |
| `.env.local` | FTP接続情報の環境変数を追加 |

### 15.3 依存パッケージ追加

```json
{
  "dependencies": {
    "basic-ftp": "^5.0.0",
    "sharp": "^0.33.0"
  }
}
```

---

## 付録A: ハブページ完全HTMLテンプレート

以下のテンプレートは `templates/hub/index.html` として保存する。
`{{variable}}` はビルド時にhub-generator.tsで置換される。

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>スピリチュアルコラム一覧{{page_title_suffix}} | Harmony MC</title>
  <meta name="description" content="スピリチュアルカウンセラー小林由起子が贈る、魂の成長と癒しのコラム集。霊視・前世リーディング・チャクラヒーリングなど幅広いテーマをお届けします。">
  <link rel="canonical" href="{{canonical_url}}">

  <!-- OGP -->
  <meta property="og:title" content="スピリチュアルコラム一覧 | Harmony MC">
  <meta property="og:type" content="website">
  <meta property="og:url" content="{{canonical_url}}">
  <meta property="og:image" content="https://harmony-mc.com/column/columns/images/ogp-hub.webp">
  <meta property="og:description" content="スピリチュアルカウンセラー小林由起子が贈る、魂の成長と癒しのコラム集。">
  <meta property="og:site_name" content="Harmony MC">
  <meta property="og:locale" content="ja_JP">
  <meta name="twitter:card" content="summary_large_image">

  <!-- 構造化データ -->
  <script type="application/ld+json">
  {{structured_data_collection}}
  </script>
  <script type="application/ld+json">
  {{structured_data_breadcrumb}}
  </script>

  <!-- CSS -->
  <link rel="preconnect" href="https://harmony-mc.com">
  <link rel="stylesheet" href="https://harmony-mc.com/wp-content/themes/lightning/style.css">
  <link rel="stylesheet" href="{{css_path}}css/hub.css">
</head>
<body>

  <!-- ===== Header (WordPress Lightning G2 互換) ===== -->
  <header class="siteHeader">
    <div class="siteHeader_inner">
      <div class="siteHeader_logo">
        <a href="https://harmony-mc.com/">
          <img src="https://harmony-mc.com/wp-content/themes/lightning/images/brand.png"
               alt="Harmony MC" class="siteHeader_logo_img">
        </a>
      </div>
      <nav class="gMenu">
        <ul class="gMenu_list">
          <li class="gMenu_item"><a href="https://harmony-mc.com/">トップ</a></li>
          <li class="gMenu_item"><a href="https://harmony-mc.com/counseling/">カウンセリング</a></li>
          <li class="gMenu_item"><a href="https://harmony-mc.com/course/">講座</a></li>
          <li class="gMenu_item"><a href="https://harmony-mc.com/book/">書籍</a></li>
          <li class="gMenu_item"><a href="https://harmony-mc.com/profile/">プロフィール</a></li>
          <li class="gMenu_item current"><a href="https://harmony-mc.com/column/">コラム</a></li>
        </ul>
      </nav>
      <button class="menuBtn" aria-label="メニューを開く" aria-expanded="false">
        <span class="menuBtn_line"></span>
        <span class="menuBtn_line"></span>
        <span class="menuBtn_line"></span>
      </button>
    </div>
  </header>

  <!-- ===== パンくずリスト ===== -->
  <nav class="breadcrumb" aria-label="パンくずリスト">
    <div class="breadcrumb_inner">
      <ol class="breadcrumb_list" itemscope itemtype="https://schema.org/BreadcrumbList">
        <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
          <a itemprop="item" href="https://harmony-mc.com/">
            <span itemprop="name">ホーム</span>
          </a>
          <meta itemprop="position" content="1">
        </li>
        <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
          <a itemprop="item" href="https://harmony-mc.com/column/">
            <span itemprop="name">コラム</span>
          </a>
          <meta itemprop="position" content="2">
        </li>
        <li itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
          <span itemprop="name">スピリチュアルコラム</span>
          <meta itemprop="position" content="3">
        </li>
      </ol>
    </div>
  </nav>

  <!-- ===== メインコンテンツ ===== -->
  <div class="siteContent">
    <div class="siteContent_inner">

      <!-- メインセクション -->
      <main class="mainSection" id="main-content">
        <h1 class="mainSection_title">スピリチュアルコラム</h1>
        <p class="mainSection_description">魂の成長と癒しのための、スピリチュアルな視点からのコラム集</p>

        <!-- カテゴリフィルタ -->
        <div class="theme-filter" role="tablist" aria-label="テーマフィルタ">
          <button class="theme-filter_btn is-active" data-filter="all" role="tab" aria-selected="true">すべて</button>
          <button class="theme-filter_btn" data-filter="soul_mission" role="tab" aria-selected="false">魂と使命</button>
          <button class="theme-filter_btn" data-filter="relationships" role="tab" aria-selected="false">人間関係</button>
          <button class="theme-filter_btn" data-filter="grief_care" role="tab" aria-selected="false">グリーフケア</button>
          <button class="theme-filter_btn" data-filter="self_growth" role="tab" aria-selected="false">自己成長</button>
          <button class="theme-filter_btn" data-filter="healing" role="tab" aria-selected="false">癒しと浄化</button>
          <button class="theme-filter_btn" data-filter="daily_awareness" role="tab" aria-selected="false">日常の気づき</button>
          <button class="theme-filter_btn" data-filter="spiritual_intro" role="tab" aria-selected="false">スピリチュアル入門</button>
        </div>

        <!-- 記事一覧 -->
        <div class="entry-list" id="entry-list">
          {{#each articles}}
          {{#if @shouldInsertCta}}
          <!-- インラインCTA（5件目の後） -->
          <div class="inline-cta">
            <div class="inline-cta_inner">
              <p class="inline-cta_heading">人生の転機に、スピリチュアルカウンセリング</p>
              <a href="https://harmony-booking.web.app/" class="inline-cta_btn" target="_blank" rel="noopener">
                無料相談はこちら
              </a>
            </div>
          </div>
          {{/if}}

          <article class="entry" data-theme="{{this.theme}}">
            <a href="./articles/{{this.slug}}.html" class="entry_link">
              <div class="entry_thumbnail">
                <img src="./thumbnails/{{this.slug}}-thumb.webp"
                     alt="{{this.title}}"
                     width="150" height="150"
                     loading="lazy"
                     decoding="async"
                     onerror="this.src='./images/no-image.webp'">
              </div>
              <div class="entry_body">
                <div class="entry_meta">
                  <time class="entry_date" datetime="{{this.date_iso}}">{{this.date_display}}</time>
                  <span class="entry_category">{{this.theme_label}}</span>
                </div>
                <h2 class="entry_title">{{this.title}}</h2>
                <p class="entry_excerpt">{{this.excerpt}}</p>
              </div>
            </a>
          </article>
          {{/each}}
        </div>

        <!-- ページネーション -->
        <nav class="pager" aria-label="ページナビゲーション">
          <ul class="pager_list">
            {{pagination}}
          </ul>
        </nav>

      </main>

      <!-- サイドバー -->
      <aside class="subSection">

        <!-- CTA: 予約バナー -->
        <div class="sidebar-cta">
          <div class="sidebar-cta_inner">
            <p class="sidebar-cta_heading">あなたの魂の声を<br>聴いてみませんか？</p>
            <p class="sidebar-cta_text">スピリチュアルカウンセラー小林由起子が、あなたの魂の成長をサポートします。</p>
            <a href="https://harmony-booking.web.app/" class="sidebar-cta_btn" target="_blank" rel="noopener">
              セッションを予約する
            </a>
          </div>
        </div>

        <!-- カテゴリ一覧 -->
        <div class="sidebar-widget">
          <h3 class="sidebar-widget_title">カテゴリ</h3>
          <ul class="sidebar-category-list">
            <li><a href="javascript:void(0)" onclick="filterByTheme('soul_mission')">魂と使命 <span class="count">({{count_soul_mission}})</span></a></li>
            <li><a href="javascript:void(0)" onclick="filterByTheme('relationships')">人間関係 <span class="count">({{count_relationships}})</span></a></li>
            <li><a href="javascript:void(0)" onclick="filterByTheme('grief_care')">グリーフケア <span class="count">({{count_grief_care}})</span></a></li>
            <li><a href="javascript:void(0)" onclick="filterByTheme('self_growth')">自己成長 <span class="count">({{count_self_growth}})</span></a></li>
            <li><a href="javascript:void(0)" onclick="filterByTheme('healing')">癒しと浄化 <span class="count">({{count_healing}})</span></a></li>
            <li><a href="javascript:void(0)" onclick="filterByTheme('daily_awareness')">日常の気づき <span class="count">({{count_daily_awareness}})</span></a></li>
            <li><a href="javascript:void(0)" onclick="filterByTheme('spiritual_intro')">スピリチュアル入門 <span class="count">({{count_spiritual_intro}})</span></a></li>
          </ul>
        </div>

        <!-- プロフィール -->
        <div class="sidebar-widget">
          <h3 class="sidebar-widget_title">プロフィール</h3>
          <div class="sidebar-profile">
            <p class="sidebar-profile_name">小林由起子</p>
            <p class="sidebar-profile_title">スピリチュアルカウンセラー</p>
            <p class="sidebar-profile_text">20年以上のカウンセリング経験を持ち、多くの方の魂の成長をサポート。</p>
            <a href="https://harmony-mc.com/profile/" class="sidebar-profile_link">詳しいプロフィール</a>
          </div>
        </div>

      </aside>

    </div>
  </div>

  <!-- フッターCTA -->
  <div class="footer-cta">
    <div class="footer-cta_inner">
      <h3 class="footer-cta_heading">小林由起子のスピリチュアルセッション</h3>
      <p class="footer-cta_text">20年以上の経験を持つスピリチュアルカウンセラーが、<br>あなたの魂の旅をサポートします。</p>
      <div class="footer-cta_buttons">
        <a href="https://harmony-booking.web.app/" class="footer-cta_btn primary" target="_blank" rel="noopener">セッション予約</a>
        <a href="https://harmony-booking.web.app/" class="footer-cta_btn secondary" target="_blank" rel="noopener">無料相談</a>
      </div>
    </div>
  </div>

  <!-- ===== Footer (WordPress Lightning G2 互換) ===== -->
  <footer class="siteFooter">
    <div class="siteFooter_inner">
      <nav class="siteFooter_nav">
        <ul>
          <li><a href="https://harmony-mc.com/">トップ</a></li>
          <li><a href="https://harmony-mc.com/counseling/">カウンセリング</a></li>
          <li><a href="https://harmony-mc.com/course/">講座</a></li>
          <li><a href="https://harmony-mc.com/book/">書籍</a></li>
          <li><a href="https://harmony-mc.com/profile/">プロフィール</a></li>
          <li><a href="https://harmony-mc.com/column/">コラム</a></li>
        </ul>
      </nav>
      <p class="siteFooter_copyright">&copy; Harmony MC. All rights reserved.</p>
    </div>
  </footer>

  <!-- JS -->
  <script src="{{js_path}}js/hub.js" defer></script>

</body>
</html>
```

---

## 付録B: hub.css

```css
/* ================================================================
   Harmony MC - Hub Page Styles
   WordPress Lightning G2テーマとの完全互換レイヤー
   Primary: #b39578  Dark: #53352b  BG: #faf3ed
   ================================================================ */

/* ---------- Base Override (WP CSSを補完) ---------- */

.siteContent {
  max-width: 1100px;
  margin: 0 auto;
  padding: 20px 15px;
}

.siteContent_inner {
  display: flex;
  gap: 30px;
}

.mainSection {
  flex: 1;
  min-width: 0;
}

.subSection {
  width: 300px;
  flex-shrink: 0;
}

/* ---------- Page Title ---------- */

.mainSection_title {
  font-size: 24px;
  font-weight: bold;
  color: #53352b;
  border-bottom: 2px solid #b39578;
  padding-bottom: 10px;
  margin-bottom: 8px;
}

.mainSection_description {
  font-size: 14px;
  color: #b39578;
  margin-bottom: 20px;
}

/* ---------- Theme Filter ---------- */

.theme-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 25px;
  padding: 10px 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.theme-filter_btn {
  display: inline-block;
  padding: 6px 14px;
  border: 1px solid #b39578;
  border-radius: 20px;
  background: #fff;
  color: #53352b;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  font-family: inherit;
}

.theme-filter_btn:hover {
  background: #faf3ed;
}

.theme-filter_btn.is-active {
  background: #53352b;
  color: #fff;
  border-color: #53352b;
}

.theme-filter_btn:focus-visible {
  outline: 2px solid #b39578;
  outline-offset: 2px;
}

/* ---------- Entry Card (WordPress互換) ---------- */

.entry-list {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.entry {
  border-bottom: 1px solid #e5ded5;
  padding: 15px 0;
}

.entry:last-child {
  border-bottom: none;
}

.entry_link {
  display: flex;
  gap: 15px;
  text-decoration: none;
  color: inherit;
  transition: opacity 0.2s;
}

.entry_link:hover {
  opacity: 0.8;
}

.entry_thumbnail {
  flex-shrink: 0;
  width: 150px;
  height: 150px;
  overflow: hidden;
  border-radius: 4px;
}

.entry_thumbnail img {
  width: 150px;
  height: 150px;
  object-fit: cover;
  border-radius: 4px;
}

.entry_body {
  flex: 1;
  min-width: 0;
}

.entry_meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
}

.entry_date {
  color: #999;
}

.entry_category {
  display: inline-block;
  padding: 1px 8px;
  background: #faf3ed;
  border: 1px solid #e5ded5;
  border-radius: 3px;
  color: #b39578;
  font-size: 11px;
  font-weight: 500;
}

.entry_title {
  font-size: 16px;
  font-weight: bold;
  color: #53352b;
  line-height: 1.5;
  margin-bottom: 6px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.entry_excerpt {
  font-size: 13px;
  color: #666;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* フィルタ時の非表示 */
.entry.is-hidden {
  display: none;
}

/* ---------- Pagination (WordPress互換) ---------- */

.pager {
  margin-top: 30px;
  text-align: center;
}

.pager_list {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 4px;
  list-style: none;
  padding: 0;
  margin: 0;
}

.page-numbers {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 36px;
  padding: 0 10px;
  border: 1px solid #b39578;
  border-radius: 4px;
  background: #fff;
  color: #53352b;
  font-size: 14px;
  text-decoration: none;
  transition: all 0.2s;
}

.page-numbers:hover {
  background: #faf3ed;
}

.page-numbers.current {
  background: #53352b;
  color: #fff;
  border-color: #53352b;
}

.page-numbers.prev,
.page-numbers.next {
  font-size: 13px;
}

/* ---------- Sidebar ---------- */

.sidebar-widget {
  margin-bottom: 25px;
  background: #fff;
  border: 1px solid #e5ded5;
  border-radius: 4px;
  overflow: hidden;
}

.sidebar-widget_title {
  font-size: 14px;
  font-weight: bold;
  color: #fff;
  background: #53352b;
  padding: 10px 15px;
  margin: 0;
}

.sidebar-category-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.sidebar-category-list li {
  border-bottom: 1px solid #f0ebe5;
}

.sidebar-category-list li:last-child {
  border-bottom: none;
}

.sidebar-category-list a {
  display: flex;
  justify-content: space-between;
  padding: 10px 15px;
  color: #53352b;
  text-decoration: none;
  font-size: 14px;
  transition: background 0.2s;
}

.sidebar-category-list a:hover {
  background: #faf3ed;
}

.sidebar-category-list .count {
  color: #b39578;
  font-size: 12px;
}

/* ---------- Sidebar CTA ---------- */

.sidebar-cta {
  margin-bottom: 25px;
  border-radius: 8px;
  overflow: hidden;
  background: linear-gradient(135deg, #f5ebe0, #faf3ed);
  border: 2px solid #b39578;
}

.sidebar-cta_inner {
  padding: 20px 15px;
  text-align: center;
}

.sidebar-cta_heading {
  font-size: 16px;
  font-weight: bold;
  color: #53352b;
  margin-bottom: 10px;
  line-height: 1.5;
}

.sidebar-cta_text {
  font-size: 13px;
  color: #666;
  margin-bottom: 15px;
  line-height: 1.6;
}

.sidebar-cta_btn {
  display: inline-block;
  padding: 12px 24px;
  background: #b39578;
  color: #fff;
  font-weight: bold;
  font-size: 14px;
  text-decoration: none;
  border-radius: 25px;
  transition: all 0.3s;
  box-shadow: 0 2px 6px rgba(179,149,120,0.3);
}

.sidebar-cta_btn:hover {
  opacity: 0.85;
  transform: translateY(-1px);
  color: #fff;
}

/* ---------- Sidebar Profile ---------- */

.sidebar-profile {
  padding: 15px;
}

.sidebar-profile_name {
  font-size: 16px;
  font-weight: bold;
  color: #53352b;
  margin-bottom: 2px;
}

.sidebar-profile_title {
  font-size: 12px;
  color: #b39578;
  margin-bottom: 10px;
}

.sidebar-profile_text {
  font-size: 13px;
  color: #666;
  line-height: 1.6;
  margin-bottom: 10px;
}

.sidebar-profile_link {
  display: inline-block;
  font-size: 13px;
  color: #b39578;
  text-decoration: none;
  border-bottom: 1px dashed #b39578;
}

.sidebar-profile_link:hover {
  color: #53352b;
}

/* ---------- Inline CTA ---------- */

.inline-cta {
  padding: 20px 0;
}

.inline-cta_inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  padding: 20px;
  background: linear-gradient(135deg, #f5ebe0, #faf3ed);
  border: 1px solid #e8d5c4;
  border-radius: 8px;
}

.inline-cta_heading {
  font-size: 15px;
  font-weight: bold;
  color: #53352b;
  margin: 0;
}

.inline-cta_btn {
  display: inline-block;
  padding: 10px 24px;
  background: #53352b;
  color: #fff;
  font-weight: bold;
  font-size: 13px;
  text-decoration: none;
  border-radius: 25px;
  white-space: nowrap;
  transition: all 0.3s;
}

.inline-cta_btn:hover {
  opacity: 0.85;
  color: #fff;
}

/* ---------- Footer CTA ---------- */

.footer-cta {
  margin-top: 30px;
  background: linear-gradient(135deg, #53352b, #7a5240);
  padding: 40px 15px;
  text-align: center;
}

.footer-cta_inner {
  max-width: 700px;
  margin: 0 auto;
}

.footer-cta_heading {
  font-size: 22px;
  font-weight: bold;
  color: #fff;
  margin-bottom: 12px;
}

.footer-cta_text {
  font-size: 14px;
  color: rgba(255,255,255,0.85);
  margin-bottom: 20px;
  line-height: 1.7;
}

.footer-cta_buttons {
  display: flex;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
}

.footer-cta_btn {
  display: inline-block;
  padding: 14px 30px;
  border-radius: 25px;
  font-weight: bold;
  font-size: 14px;
  text-decoration: none;
  transition: all 0.3s;
}

.footer-cta_btn.primary {
  background: #b39578;
  color: #fff;
}

.footer-cta_btn.secondary {
  background: transparent;
  color: #fff;
  border: 2px solid #fff;
}

.footer-cta_btn:hover {
  opacity: 0.85;
  transform: translateY(-1px);
  color: #fff;
}

/* ---------- Breadcrumb ---------- */

.breadcrumb {
  background: #faf3ed;
  padding: 10px 0;
  font-size: 12px;
}

.breadcrumb_inner {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 15px;
}

.breadcrumb_list {
  display: flex;
  align-items: center;
  gap: 4px;
  list-style: none;
  padding: 0;
  margin: 0;
}

.breadcrumb_list li + li::before {
  content: ">";
  margin-right: 4px;
  color: #b39578;
}

.breadcrumb_list a {
  color: #b39578;
  text-decoration: none;
}

.breadcrumb_list a:hover {
  text-decoration: underline;
}

.breadcrumb_list li:last-child {
  color: #53352b;
}

/* ---------- Mobile Navigation ---------- */

.menuBtn {
  display: none;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  width: 40px;
  height: 40px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px;
}

.menuBtn_line {
  display: block;
  width: 24px;
  height: 2px;
  background: #53352b;
  transition: all 0.3s;
}

.menuBtn.is-active .menuBtn_line:nth-child(1) {
  transform: rotate(45deg) translate(5px, 5px);
}

.menuBtn.is-active .menuBtn_line:nth-child(2) {
  opacity: 0;
}

.menuBtn.is-active .menuBtn_line:nth-child(3) {
  transform: rotate(-45deg) translate(5px, -5px);
}

/* ---------- Responsive: Tablet (< 1020px) ---------- */

@media (max-width: 1020px) {
  .siteContent_inner {
    flex-direction: column;
  }

  .subSection {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 15px;
  }

  .sidebar-cta {
    grid-column: 1 / -1;
  }
}

/* ---------- Responsive: Mobile (< 768px) ---------- */

@media (max-width: 767px) {
  .menuBtn {
    display: flex;
  }

  .gMenu {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    width: 100%;
    background: #fff;
    border-bottom: 1px solid #e5ded5;
    box-shadow: 0 4px 10px rgba(0,0,0,0.1);
    z-index: 1000;
  }

  .gMenu.is-open {
    display: block;
  }

  .gMenu_list {
    flex-direction: column;
    padding: 0;
  }

  .gMenu_item a {
    display: block;
    padding: 12px 20px;
    border-bottom: 1px solid #f0ebe5;
  }

  .siteHeader_inner {
    position: relative;
  }

  .entry_link {
    flex-direction: row;
  }

  .entry_thumbnail {
    width: 100px;
    height: 100px;
  }

  .entry_thumbnail img {
    width: 100px;
    height: 100px;
  }

  .entry_title {
    font-size: 14px;
  }

  .entry_excerpt {
    display: none;
  }

  .theme-filter {
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 8px;
    gap: 4px;
  }

  .theme-filter_btn {
    font-size: 12px;
    padding: 5px 10px;
  }

  .subSection {
    grid-template-columns: 1fr;
  }

  .inline-cta_inner {
    flex-direction: column;
    text-align: center;
  }

  .footer-cta_heading {
    font-size: 18px;
  }

  .footer-cta_buttons {
    flex-direction: column;
    align-items: center;
  }

  .page-numbers {
    min-width: 32px;
    height: 32px;
    font-size: 13px;
  }
}
```

---

## 付録C: hub.js

```javascript
/* ================================================================
   Harmony MC - Hub Page JavaScript
   カテゴリフィルタ + モバイルナビ
   ================================================================ */

(function () {
  'use strict';

  // ---------- カテゴリフィルタ ----------

  var filterBtns = document.querySelectorAll('.theme-filter_btn');
  var entries = document.querySelectorAll('.entry[data-theme]');

  filterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var filter = this.getAttribute('data-filter');

      // ボタンのアクティブ状態を切り替え
      filterBtns.forEach(function (b) {
        b.classList.remove('is-active');
        b.setAttribute('aria-selected', 'false');
      });
      this.classList.add('is-active');
      this.setAttribute('aria-selected', 'true');

      // 記事の表示/非表示を切り替え
      entries.forEach(function (entry) {
        if (filter === 'all' || entry.getAttribute('data-theme') === filter) {
          entry.classList.remove('is-hidden');
        } else {
          entry.classList.add('is-hidden');
        }
      });

      // インラインCTAの表示調整
      var inlineCta = document.querySelector('.inline-cta');
      if (inlineCta) {
        inlineCta.style.display = filter === 'all' ? '' : 'none';
      }
    });
  });

  // サイドバーからのフィルタ呼び出し
  window.filterByTheme = function (theme) {
    var btn = document.querySelector('.theme-filter_btn[data-filter="' + theme + '"]');
    if (btn) btn.click();
    // スクロールして記事一覧へ
    var list = document.getElementById('entry-list');
    if (list) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ---------- モバイルナビゲーション ----------

  var menuBtn = document.querySelector('.menuBtn');
  var gMenu = document.querySelector('.gMenu');

  if (menuBtn && gMenu) {
    menuBtn.addEventListener('click', function () {
      var isOpen = this.classList.toggle('is-active');
      this.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      this.setAttribute('aria-label', isOpen ? 'メニューを閉じる' : 'メニューを開く');
      gMenu.classList.toggle('is-open');
    });

    // メニュー外クリックで閉じる
    document.addEventListener('click', function (e) {
      if (!menuBtn.contains(e.target) && !gMenu.contains(e.target)) {
        menuBtn.classList.remove('is-active');
        menuBtn.setAttribute('aria-expanded', 'false');
        menuBtn.setAttribute('aria-label', 'メニューを開く');
        gMenu.classList.remove('is-open');
      }
    });
  }

})();
```

---

## 付録D: 実装優先順位

| フェーズ | タスク | 見積もり |
|---------|--------|---------|
| **Phase 1** | hub-generator.ts 実装 | 2日 |
| **Phase 1** | hub.css / hub.js 作成 | 1日 |
| **Phase 1** | テンプレートHTML完成 | 0.5日 |
| **Phase 2** | ftp-uploader.ts 実装 | 1日 |
| **Phase 2** | rebuild API実装 | 1日 |
| **Phase 2** | サムネイル生成 (sharp) | 0.5日 |
| **Phase 3** | 記事公開時の自動rebuild連携 | 0.5日 |
| **Phase 3** | ダッシュボードにrebuildボタン追加 | 0.5日 |
| **Phase 4** | サイトマップ生成 | 0.5日 |
| **Phase 4** | WP側 .htaccess 設定 | 0.5日 |
| **Phase 4** | テスト・QA | 1日 |
| **合計** | | **約9日** |
