# scripts/dangerous/

⚠️ **このディレクトリのスクリプトは記事本文・タイトル・コンテンツを変更します。**
誤実行は出荷済み記事を壊す可能性があるため、以下のルールを厳守してください。

## 実行前必須チェック
1. ユーザ（オーナー）の**明示的な指示**があること
2. 対象記事を `scripts/dump-*.ts` 等で**事前バックアップ**しておくこと
3. **shadow / staging 環境で先行実行**して挙動確認
4. 本番実行時は実行ログを残し、`article_revisions` テーブルで履歴確認

## ファイル一覧

| スクリプト | 影響 | 想定用途 |
|---|---|---|
| `fix-all-articles.ts` | 全記事の HTML/本文に一括書換 | バルク修正（明示指示時のみ） |
| `fix-article-1-overwrite.ts` | 記事 #1 の overwrite | 個別修正 |
| `fix-broken-links.ts` | 記事内のリンク補正 | リンク切れ対応 |
| `fix-remaining-5.ts` | 残り 5 記事修正 | 部分修正 |
| `improve-c-articles.ts` | C 評価記事の改善 | 品質改善（再生成） |
| `reassign-sources.ts` | ソース記事の再マッピング | コーパス見直し |
| `recover-article-10.ts` | 記事 #10 復旧 | 個別復旧 |
| `regenerate-all-html.ts` | 全記事 HTML 再生成 | テンプレ変更時 |
| `regenerate-and-deploy-article-10.ts` | 記事 #10 再生成＋デプロイ | 個別再生成 |
| `regenerate-failed-articles.ts` | 失敗記事の再生成 | リトライ |

## 安全装置

`session-guard.json` の `blockArticleWrites: true` 設定中は、これらスクリプトを実行しても DB レイヤで write がブロックされます（`assertArticleWriteAllowed` 経由）。

## 廃止対象

以下のスクリプトは将来削除予定（本番運用で不要のはず）：
- `fix-article-1-overwrite.ts` / `recover-article-10.ts` / `regenerate-and-deploy-article-10.ts` — 個別記事用、過去対応の名残
- `fix-remaining-5.ts` — 過去のバルク修正の名残

統合的な `improve-c-articles.ts` 等で置換可能なら順次廃棄。
