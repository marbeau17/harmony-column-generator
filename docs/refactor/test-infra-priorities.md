# テスト基盤強化 優先タスク

> Harmony Column Generator のテスト基盤を段階的に強化するためのロードマップ。
> 優先度は「過去のバグで何回防げたか」を基準に決定。

## P1（即時着手）— Live Article Smoke

**内容**: 本番公開済み記事の URL を毎日 cron で `curl -fsS` し、HTTP 200 + 必須要素（`<main>` 1個 / CTA 3個 / 免責事項）が揃うか検証。Slack 通知連携。

**過去の防止実績（推定）**: 4 回以上
- バグ E（CTA 0 件で本番出荷）
- バグ F（`<!--<img` HTML コメント混入）
- 公開後 dangling 状態の検知漏れ
- noindex ソフト撤回後の二重公開疑惑

## P2（1 週間以内）— HTML 構造 Unit Test

**内容**: `article-html-generator` の出力 HTML を cheerio でパースし「`<main>` 1個・`<article>` 1個・`<h1>` 1個・CTA 3個・免責事項末尾」を構造アサート。

**過去の防止実績（推定）**: 3 回
- バグ G（`<main>` が 2 個生成される事象）
- CTA 配置位置ズレ（hero / mid / footer の順序崩壊）
- 由起子 FB 反映時の `""` 混入

## P3（1 週間以内）— Generator Output Grep 排除テスト

**内容**: 全 generator (article / image / SEO / OG) の output に対し、禁止パターンを正規表現で grep し検出されたら fail。
- `<!--<img` （HTML コメント化された画像タグ）
- `<main[^>]*>.*<main` （main 二重）
- `""` （由起子 NG パターン）
- `undefined` / `null` の文字列リテラル混入

**過去の防止実績（推定）**: 5 回以上
- バグ F の HTML コメント画像
- バグ G の main 二重
- 抽象表現 / `""` の混入（由起子 FB 2 回分）
- Stage2 投入時の `undefined` 文字列出力

## P4（2 週間以内）— API ルート エラーパス テスト

**内容**: 全 API route（`/api/articles/*`, `/api/generate/*`, `/api/publish/*` 等）の 401 / 404 / 422 / 500 パスを Playwright + supertest で網羅。

**過去の防止実績（推定）**: 2 回
- 未認証アクセス時の 500（本来 401）
- バリデーション失敗時のスタックトレース露出

## P5（1 ヶ月以内）— State Machine 全遷移 + Parity テスト

**内容**: 記事の状態遷移（`draft → reviewed → scheduled → published → unpublished`）を全パターン table-driven で検証。さらに DB 状態と FTP 状態の parity（不整合検知）テストを追加。

**過去の防止実績（推定）**: 3 回
- dangling 記事（DB published / FTP 未配置）
- ソフト撤回後の reviewed_at 残留
- バージョン履歴 4 件保持ルール違反
