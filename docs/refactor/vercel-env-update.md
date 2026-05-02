# P5-44 Vercel 環境変数追加手順

## 追加必要な環境変数 (Production / Preview 両方)

| 変数名 | 値 | 説明 |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://harmony-mc.com` | サイトホスト |
| `NEXT_PUBLIC_HUB_PATH` | `/spiritual/column` | ハブベースパス (FTP_REMOTE_PATH と同期) |

## 設定手順

1. Vercel Dashboard → blogauto-pi → Settings → Environment Variables
2. 「Add New」で上記 2 つを追加
3. Environment は `Production`, `Preview`, `Development` 全てチェック
4. 保存後、最新の deployment を Redeploy (or 次の git push で自動反映)

## 検証

デプロイ完了後、以下のコマンドで生成 URL を確認:
```bash
curl -s https://blogauto-pi.vercel.app/sitemap.xml | grep -o "https://[^<]*" | head -5
# 期待: https://harmony-mc.com/spiritual/column/{slug} 形式
```

## ロールバック

env 変数を削除すると default 値 `https://harmony-mc.com` + `/spiritual/column` が使われる
(コード内 default と同じなので実質無影響)。
