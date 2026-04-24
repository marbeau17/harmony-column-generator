# 08. FTP ファイル構造と DB→ファイル マッピング

_Status: Draft — 2026-04-19_
_Scope: harmony-mc.com 配下の FTP 静的ファイルレイアウトと、`articles` テーブルから生成されるファイルの対応関係。orphan ファイルの扱いと「非公開化」の物理ポリシーを整理する。_

ソースは読むだけ（Read-only）。FTP への接続は行わない。根拠となるコードは以下:

- `scripts/ftp-deploy-all.ts` (全記事 + ハブを一括上書き)
- `scripts/ftp-deploy-with-css.ts` (hub.css + 記事 + ハブ)
- `scripts/ftp-redeploy-affected.ts` (スラッグ列挙で部分再配布)
- `src/lib/deploy/ftp-uploader.ts` (FTP クライアントラッパー)
- `src/app/api/hub/deploy/route.ts` (ハブページデプロイ API)
- `src/app/api/articles/[id]/deploy/route.ts` (単記事デプロイ API)
- `src/lib/generators/hub-generator.ts` (ハブ HTML 生成 + `buildArticleCards`)
- `src/lib/export/static-exporter.ts` (`out/` への静的エクスポート)

---

## 1. FTP リモート root と基準パス

環境変数 `FTP_REMOTE_PATH`（または DB `settings.ftp.remotePath`）が全アップロードの基準パス。

```
FTP_REMOTE_PATH = /public_html/column/columns/   # default
```

実際にブラウザから到達する URL 空間はサーバ設定次第だが、コード内では以下の 2 系統の URL が混在している（要整理ポイント）:

| 生成場所 | 生成される URL/パス | 想定公開パス |
|---|---|---|
| `article-html-generator` の og:image | `https://harmony-mc.com/column/{slug}/images/hero.jpg` | `/column/{slug}/…` |
| `hub-generator.buildArticleCards` の `articleUrl` / `thumbnailUrl` | `/spiritual/column/{slug}/…` | `/spiritual/column/…` |
| ハブ canonical (`COLUMNS_BASE`) | `https://harmony-mc.com/columns/` | `/columns/` |
| FTP 実アップロード先 | `/public_html/column/columns/{slug}/index.html` | `/column/columns/{slug}/…` |

実機配信は `/public_html/column/columns/` 配下なので、実 URL は **`https://harmony-mc.com/column/columns/{slug}/index.html`** になる。ハブ内リンクが `/spiritual/column/…` を指しているのは不整合の疑いあり（別 spec で検証）。

## 2. リモートディレクトリツリー（コードから推定）

`out/column/` のローカルツリーがそのまま FTP にミラーされる構造。`scripts/ftp-deploy-all.ts` / `ftp-deploy-with-css.ts` は `out/column` を走査し、`images` / `css` / `js` を除いたサブディレクトリを各記事スラッグとして扱う。

```
/public_html/column/columns/                    ← FTP_REMOTE_PATH (root)
├── index.html                                  ← ハブ 1 ページ目 (page=1)
├── page/
│   ├── 2/index.html                            ← ハブ 2 ページ目 (10 件/ページ)
│   ├── 3/index.html
│   └── …
├── css/
│   └── hub.css                                 ← ハブ & 記事共用 CSS (ftp-deploy-with-css.ts でのみ配布)
├── js/
│   └── hub.js                                  ← 記事 HTML が参照 (上記 css と同層想定だが配布コードは未確認)
├── images/
│   └── author-sketch.jpg                       ← ハブ共通画像 (author ロゴ等)
├── {slug-1}/                                   ← 例: spiritual-beginner-books-recommend
│   ├── index.html
│   └── images/
│       ├── hero.jpg
│       ├── body.jpg
│       └── summary.jpg
├── {slug-2}/…
└── …
```

備考:

- 記事 HTML 内の相対参照は `../../css/hub.css`、`../../js/hub.js`。つまり記事は `/column/columns/{slug}/index.html` の深さを前提とする（`article-html-generator` のデフォルト `./css/hub.css` を `static-exporter` / `articles/[id]/deploy` が post-process で書き換えている）。
- ページネーションは `page/{n}/index.html` のネスト構造で、`generateAllHubPages` が page=1 を `index.html`、page≥2 を `page/{n}/index.html` に出力する。
- **関連記事は別ファイルではない**。`articles.related_articles` JSONB を元に `buildRelatedArticlesHtml` が記事 HTML の中にインライン展開する。partial や JSON フラグメントはサーバーへアップロードされない。
- **JSON データフィード（RSS / feed.json 等）は現状なし**。sitemap.xml 生成は `src/app/sitemap.ts`（Next.js の動的ルート）で行うだけで、FTP には置かれない。

## 3. スラッグ → ファイルパス変換規則

`articles` テーブルの行から FTP 上のパスを決める規則:

```
slug = article.slug ?? article.seo_filename ?? article.id
```

出力先:

| 生成物 | ローカル (`out/`) | FTP リモート |
|---|---|---|
| 記事 HTML | `out/column/{slug}/index.html` | `{FTP_REMOTE_PATH}{slug}/index.html` |
| 記事画像 (hero/body/summary) | `out/column/{slug}/images/{position}.jpg` | `{FTP_REMOTE_PATH}{slug}/images/{position}.jpg` |
| ハブ 1 ページ目 | `out/column/index.html` | `{FTP_REMOTE_PATH}index.html` |
| ハブ n ページ目 (n≥2) | `out/column/page/{n}/index.html` | `{FTP_REMOTE_PATH}page/{n}/index.html` |
| 共用 CSS | `out/column/css/hub.css` | `{FTP_REMOTE_PATH}css/hub.css` |
| 共用 JS | （配布スクリプト未整備） | `{FTP_REMOTE_PATH}js/hub.js`（参照のみ） |

画像は `article.image_files[]` に格納された Supabase Storage URL を deploy API が fetch → バッファ化 → FTP upload する（`src/app/api/articles/[id]/deploy/route.ts` L90-170）。ファイル名は `image.position` が `hero`/`body`/`summary` いずれか、なければ `image.jpg`。

## 4. ハブの「公開記事」条件

`buildArticleCards` (hub-generator.ts L424-475) の SQL 条件:

```sql
SELECT … FROM articles
WHERE status = 'published'
  AND reviewed_at IS NOT NULL
ORDER BY published_at DESC
```

つまりハブに載るには `status='published'` **かつ** `reviewed_at` が埋まっている必要がある。status を `published` 以外に戻す、または `reviewed_at` を NULL に戻すだけで **ハブ側からは即座に消える**（`/api/hub/deploy` を再実行した瞬間に）。

## 5. 非公開化とファイル削除ポリシー（現状）

**コードを grep した結果、FTP 上のファイルを削除する処理は存在しない。**

- `client.remove` / `removeDir` / `rmdir` 等、basic-ftp の削除 API を呼ぶ箇所はゼロ。
- 削除用スクリプト（例: `ftp-delete-*.ts`）もリポジトリに存在しない。
- `/api/articles/[id]/transition` で status を draft/archived に戻しても、FTP 側の `{slug}/index.html` と `{slug}/images/*` は残置されたままになる。
- 唯一の「消え方」は `/api/hub/deploy` によるハブ再生成で、非公開記事がハブカード一覧とサイドバー「最新記事」から除外されるだけ。

### 結果: 現状の「非公開」の意味

| 動線 | 見えなくなる? |
|---|---|
| ハブ `/column/columns/` のカード一覧 | YES（再デプロイ後） |
| ハブ ページ 2+ (`/page/2/`) | YES（再デプロイ後） |
| サイドバー「最新記事」 | YES（再デプロイ後） |
| カテゴリ件数表示 | YES（再集計される） |
| **直リンク `/column/columns/{slug}/index.html`** | **NO — 残ったままアクセス可能** |
| 外部サイトや検索エンジンのキャッシュ | **NO — 生き続ける** |
| sitemap.xml (`src/app/sitemap.ts`) | YES（`status='published'` 絞り） |

つまり現状は「ハブ非表示 = 事実上の orphan ファイル化」で、URL を知っている人・外部リンク・検索エンジンからはアクセス可能な状態。

## 6. 「非公開化」は何を意味すべきか（論点整理）

以下は推奨だが最終判断は別 spec で決定。

### 選択肢 A: ハブ非表示のみ（現状維持）

- 実装: status を下げて `/api/hub/deploy` を叩く。
- 長所: 復活が簡単（status を published に戻すだけ）。画像再アップロード不要。
- 短所: **直リンクは生き続ける**。`noindex` も出ない。検索流入ユーザーは「消したはずの記事」を読む。SEO 上も中身が薄い記事をインデックスに残すリスク。

### 選択肢 B: 物理削除（FTP からファイルごと消す）

- 実装: status 遷移時に `client.remove('{slug}/index.html')` と `{slug}/images/*.jpg` を消し、`{slug}/` ディレクトリを `removeDir`。
- 長所: 直リンクも 404 になる。SEO・プライバシー的に安全。
- 短所: 復活コストが高い（HTML 再生成 + 画像再アップロード）。削除失敗時のハンドリングが必要。履歴追跡がしにくい。

### 選択肢 C: ソフト撤収（HTML を noindex + リダイレクトに置換）

- 実装: status 遷移時に `{slug}/index.html` を「このコラムは非公開になりました」HTML + `<meta name="robots" content="noindex,noarchive">` で上書き。画像は残しても消してもよい。
- 長所: 直リンクは見えるが中身は非公開メッセージ。検索エンジンから段階的に落ちる。復活は再デプロイ 1 発。
- 短所: ファイルは残るのでストレージ的にはゼロリセットにならない。

### 推奨

**選択肢 C（ソフト撤収）をデフォルトにし、オプションで B（物理削除）を選べる UI にする。**

理由:
- Yukiko さん本人が何度か「推敲後に非公開に戻したい」ケースがあり得る。復活が 1 クリックであるべき。
- 一方、現状（A）のように直 URL がずっと生きているのは事故の温床。最低でも `noindex` を出す形にする必要がある。
- 物理削除（B）はユーザーが明示的に「完全削除」を選んだときだけに留める（削除予約 → 7 日後確定、のような確認ステップを挟むと安全）。

いずれを採るにせよ、`article_revisions` への履歴 INSERT は必須（MEMORY.md の HTML History Rule）。「非公開化もファイル書き換えの一種」として revisions に残し、復活時はその revision を復元できるようにする。

## 7. 未整備の点（別 spec で詰める）

- `out/column/js/hub.js` の FTP 配布フロー（`ftp-deploy-with-css.ts` は CSS のみ扱っている）。記事 HTML は `../../js/hub.js` を参照するので、どこかで一度はアップロードしないと 404 になる。
- 関連記事の更新タイミング: 記事を非公開にしても、他記事の `related_articles` に残ったままになり、クリックすると「非公開記事」のページに飛ぶ。`auto-related` の再計算を deploy 時にトリガするかどうか。
- `/spiritual/column/…` と `/column/columns/…` の URL 不整合 (hub-generator L471-472 vs. 実 FTP パス)。
- sitemap.xml は Next.js 側で動的配信だが、静的コラムサイトの sitemap を FTP に置くかどうか。
