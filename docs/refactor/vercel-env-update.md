# P5-44 / P5-45 Vercel 環境変数 + .env.local 設定手順

## 1. ローカル `.env.local` の更新 (重要)

`.env.local` の以下 2 行を更新してください (P5-45 で `/spiritual/column` → `/column` に変更):

```bash
NEXT_PUBLIC_HUB_PATH=/column
FTP_REMOTE_PATH=/column/
```

## 2. Vercel 環境変数

P5-45 後はコード default が `/column` なので、Vercel に env を **設定しなくても動作** します。
明示的に設定したい場合のみ:

| 変数名 | 値 | 説明 |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://harmony-mc.com` | サイトホスト (default 同じ) |
| `NEXT_PUBLIC_HUB_PATH` | `/column` | ハブベースパス (default 同じ) |

### 設定手順 (省略可能)

1. Vercel Dashboard → blogauto-pi → Settings → Environment Variables
2. 「Add New」で上記 2 つを追加
3. Environment は `Production`, `Preview`, `Development` 全てチェック
4. 保存後、最新の deployment を Redeploy (or 次の git push で自動反映)

## 3. 検証

デプロイ完了後、以下のコマンドで生成 URL を確認:

```bash
# sitemap.xml に /column/{slug}/ 形式の URL が含まれることを確認
curl -s https://blogauto-pi.vercel.app/sitemap.xml | grep -oE "<loc>[^<]+</loc>" | head -5
# 期待: <loc>https://harmony-mc.com/column/{slug}/</loc>

# 公開サイトで記事が見えるか (FTP デプロイ実行後)
curl -sI https://harmony-mc.com/column/healing/ | head -3
# 期待: HTTP/2 200 (記事 HTML が直接配信される)
```

## 4. WordPress (root) との共存について

`harmony-mc.com` は lolipop で WordPress (root install) として運用されており、
`.htaccess` の rewrite catch-all は **実ファイル/ディレクトリが存在する場合バイパス** されます:

```apache
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /index.php [L]
```

つまり `/column/{slug}/index.html` を物理配置すれば WordPress を通らず Apache が直接配信します。
旧 `/spiritual/column/` 配下の 58 記事ディレクトリは `column_backup2/` 等にバックアップ済みで残存。

## 5. ロールバック

env 変数を削除/未設定にすると default 値が使われます:
- `NEXT_PUBLIC_SITE_URL=https://harmony-mc.com`
- `NEXT_PUBLIC_HUB_PATH=/column`

旧 `/spiritual/column` に戻すには、env を `/spiritual/column` に明示設定するか、
`src/lib/config/public-urls.ts` の default を変更します。
