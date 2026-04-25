# scripts/ops/

運用スクリプト群。記事本文を変更しない、デプロイ・キュー処理系。

## ファイル一覧

| スクリプト | 用途 |
|---|---|
| `ftp-deploy-all.ts` | 全記事を FTP に一括アップロード（既存 HTML を再配信） |
| `ftp-deploy-with-css.ts` | CSS 含めて FTP デプロイ |
| `ftp-redeploy-affected.ts` | 影響を受けた記事のみ FTP 再デプロイ |
| `redeploy-affected.ts` | 影響を受けた記事の DB→FTP 再デプロイ |
| `process-queue-direct.ts` | キュー直接処理（ワーカー API のローカル代替） |

## 実行前確認
- 必ず `dry-run` モードがある場合は先に試す
- `FTP_DRY_RUN=true` で `tmp/ftp-dry-run/` に書き出して動作確認
- 本番実行は環境変数（`FTP_HOST` 等）が正しいことを確認

## 関連
- 記事本文を変える系統は `scripts/dangerous/` を参照
- 公開制御は `/dashboard/articles` の PublishButton から実施推奨（直接スクリプト実行は緊急時のみ）
