# URL 生成 env 駆動化 (P5-44)

## 背景

Harmony Column Generator では、これまで公開 URL の組み立てロジックが 3 つのパス体系に分裂しており、デグレ温床になっていた。

1. **生成 HTML 内のリンク** (`src/lib/generators/html-generator.ts`) — `https://harmony-mc.com/column/` 直書き
2. **FTP 配置先** (`FTP_REMOTE_PATH`) — `.env` で `/public_html/column/columns/` 等
3. **OGP / structured-data / sitemap** — `NEXT_PUBLIC_APP_URL` を基にした独自組み立て

これら 3 系統が `harmony-mc.com/column/` → `harmony-mc.com/spiritual/column/` 等のパス変更時にバラバラに追従してしまい、404 を生む遠因となっていた。

P5-44 で **案 A (env 駆動・単一ヘルパー集約)** を採用し、公開 URL を構成する全ロジックを `src/lib/config/public-urls.ts` に集約する。

## 環境変数仕様

| 変数名 | 必須 | 例 | 説明 |
|:---|:---:|:---|:---|
| `NEXT_PUBLIC_SITE_URL` | ○ | `https://harmony-mc.com` | 公開サイトのオリジン (末尾スラッシュ無し) |
| `NEXT_PUBLIC_HUB_PATH` | ○ | `/spiritual/column` | コラム HUB のベースパス (先頭スラッシュ有り・末尾無し) |
| `FTP_REMOTE_PATH` | ○ | `/spiritual/column/` | FTP 側の物理配置パス。`HUB_PATH` と整合必須 |

### 整合性ルール
- `NEXT_PUBLIC_HUB_PATH` の末尾スラッシュ無し版 + `/` は `FTP_REMOTE_PATH` の `/public_html` 部を除いた値と一致しなければならない。
- 例: `HUB_PATH=/spiritual/column` ↔ `FTP_REMOTE_PATH=/spiritual/column/` (lolipop は public_html 自動)
- 不整合時は `src/lib/config/public-urls.ts` の `assertConsistency()` が起動時に throw する。

## `src/lib/config/public-urls.ts` API 一覧

| 関数 | 戻り値例 | 用途 |
|:---|:---|:---|
| `siteUrl()` | `https://harmony-mc.com` | OGP / canonical / RSS ルート |
| `hubUrl()` | `https://harmony-mc.com/spiritual/column` | HUB ページの絶対 URL |
| `articleUrl(slug)` | `https://harmony-mc.com/spiritual/column/{slug}/` | 記事ページの絶対 URL (sitemap / OGP / 内部リンク) |
| `articlePath(slug)` | `/spiritual/column/{slug}/` | HTML 内相対リンク用 |
| `assertConsistency()` | `void` (throw on mismatch) | 起動時整合性チェック |

すべて純粋関数で、`process.env` 参照は module top-level で 1 度だけ行いキャッシュする (Edge Runtime 互換)。

## 切替手順 (Vercel env 設定)

1. **Vercel ダッシュボード** → プロジェクト → Settings → Environment Variables
2. 以下 2 件を Production / Preview / Development の 3 環境すべてに追加
   - `NEXT_PUBLIC_SITE_URL` = `https://harmony-mc.com`
   - `NEXT_PUBLIC_HUB_PATH` = `/spiritual/column`
3. `FTP_REMOTE_PATH` が `/spiritual/column/` になっていることを確認 (既存値の流用可)
4. **再デプロイ** (env 変更だけでは反映されないため Redeploy 必須)
5. デプロイ後、`/api/health/url-config` エンドポイント (※P5-44 で追加予定) で実効値を確認

## 検証方法

### ローカル
```bash
npm run dev
# 別ターミナルで
curl -I http://localhost:3000/api/health/url-config
# → 200 + JSON で SITE_URL / HUB_PATH / ARTICLE_URL_SAMPLE が返る
```

### 本番
```bash
# HUB ページ
curl -I https://harmony-mc.com/spiritual/column/
# → HTTP/2 200

# 記事ページ (適当な slug)
curl -I https://harmony-mc.com/spiritual/column/sample-slug/
# → HTTP/2 200

# sitemap.xml に新パスが含まれていること
curl -s https://harmony-mc.com/sitemap.xml | grep "spiritual/column" | head -3
```

## SEO 上の注意

### 旧 URL → 新 URL の 301 redirect

旧 `/column/` 配下に既存記事が公開されていた場合、Apache (lolipop) 側の `.htaccess` で 301 redirect を設定する必要がある。

```apache
# /public_html/column/.htaccess
RewriteEngine On
RewriteRule ^(.*)$ /spiritual/column/$1 [R=301,L]
```

- Google Search Console で「アドレス変更ツール」を用いる場合は同一プロパティ内のため不要 (パス変更のみ)
- canonical タグは新 URL を指すよう自動更新される (本ヘルパー経由)
- sitemap.xml は新 URL のみを含む形で再生成される

### 切替タイミング
1. Vercel env 設定 + Redeploy (新 URL で生成 HTML が出力される状態)
2. FTP 一括再アップ (新パスへ全記事配置)
3. `.htaccess` 旧パス redirect 設定
4. Search Console で sitemap 再送信
5. 1〜2 週間経過後、旧パス HTML を削除 (redirect は残す)

## P5-44 cleanup 完了ファイル一覧 (2026-05-02)

`public-urls.ts` ヘルパーへ移行済み。ハードコード `https://harmony-mc.com` / `/column/` を排除した対象は以下。

| カテゴリ | ファイル | 置換内容 |
|:---|:---|:---|
| 自動関連記事 | `src/lib/content/auto-related.ts` | 関連記事リンクを `articleUrl(slug)` 経由に変更 |
| OGP / meta | `src/lib/seo/meta-generator.ts` | canonical / og:url を `articleUrl()` ベースに |
| structured-data | `src/lib/seo/structured-data.ts` | `Article.url` / `BreadcrumbList` を `articleUrl()` / `hubUrl()` 経由に |
| HTML 生成 | `src/lib/generators/html-generator.ts` | 内部リンクを `articlePath(slug)` (相対) に変更、HUB リンクを `hubUrl()` に |
| エクスポート | `src/app/api/export/article/route.ts` | sitemap / RSS 出力を `articleUrl()` 経由に |
| 設定 UI | `src/app/api/seo-settings/route.ts` | `siteUrl()` から実効値返却 |
| ダッシュボード | `src/app/dashboard/settings/page.tsx` | URL プレビュー表示を `articleUrl(sample)` に |
| テンプレート | `templates/*.html` の URL 埋め込み箇所 | ビルド時に `articleUrl()` で動的差し替え |

### 検証
- sitemap.xml は新形式 (`https://harmony-mc.com/spiritual/column/{slug}/`) で出力されることを確認済
- `assertConsistency()` による起動時整合チェックが本番デプロイ前 fail-fast を担保

## 保持対象 (env 駆動化しない / ハードコード継続)

以下は仕様上ドメイン固定または別ドメインのため、env 駆動化対象外。

| 種別 | 値 | 理由 |
|:---|:---|:---|
| CTA 予約リンク | `https://harmony-booking.web.app/` | 予約専用の別ドメイン (Firebase Hosting)。コラム公開先と独立 |
| 公式サイト nav | `https://harmony-mc.com/` (root) | コラム HUB ではなく公式トップへの導線。`siteUrl()` と意味的に別 |
| 既存コラム参照 | `https://harmony-mc.com/column/` (旧パス) | 過去記事の本文中引用。301 redirect 対象のため書換不可 |
| 外部 SNS | Instagram / YouTube 等 | 外部固定 URL |

これらは grep 検出対象だが、コメントで「P5-44 保持対象」とマークし将来の自動置換から除外する。
