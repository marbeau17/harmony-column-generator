# Quality Check Specification v2
# 全指摘事項の品質ゲート化仕様書

## 本セッションで発見された問題と再発防止策

### Category A: HTML品質（デプロイ前チェック）

| # | 問題 | 発見経緯 | チェック方法 | 実装先 |
|---|------|---------|------------|-------|
| A1 | 画像alt=""空 | 15エージェント初期チェック | `alt=""` パターン検出 | quality-checklist |
| A2 | 壊れCTA（AI直接生成） | 全記事スキャン | `<div class="harmony-cta">` 直後に `harmony-cta-inner` がない | quality-checklist |
| A3 | エスケープ `\"` `\&quot;` | 記事コンテンツ調査 | バックスラッシュエスケープ検出 | article-html-generator (既存) |
| A4 | TOC内 `<br>` 混入 | 記事コンテンツ調査 | 構造タグ周辺の `<br>` 検出 | article-html-generator (既存) |
| A5 | CSSファイル参照ミス | 画像巨大表示バグ | `style.css` 参照がないか | deploy前チェック |
| A6 | `#b39578` 旧カラー残存 | カラー修正時 | 旧カラーコード検出 | deploy前チェック |
| A7 | `harmony-spiritual.com` 旧ドメイン | SEO監査 | 旧ドメイン検出 | deploy前チェック |
| A8 | canonical リンク欠落 | SEO監査 | `rel="canonical"` 存在確認 | deploy前チェック |
| A9 | JSON-LD欠落 | SEO監査 | `application/ld+json` 存在確認 | deploy前チェック |
| A10 | リンク切れ（存在しない記事） | リンク整合性検証 | 相対リンク先の存在確認 | deploy前チェック |
| A11 | コンテンツ切断（トークン上限） | 全記事スキャン | 本文500文字未満検出 | quality-checklist |
| A12 | siteHeader/layout CSS欠落 | ヘッダー巨大表示 | インラインCSS必須ルール存在確認 | deploy前チェック |

### Category B: コンテンツ品質（由起子FB対応）

| # | 問題 | チェック方法 | 実装先 |
|---|------|------------|-------|
| B1 | ""ダブルクォーテーション使用 | Unicode + ASCII検出 | quality-checklist (実装済み) |
| B2 | 抽象的スピリチュアル表現 | 15表現リスト検出 | quality-checklist (実装済み) |
| B3 | 語りかけ語尾不足 | ですよね/ですね/なんです 15%以上 | quality-checklist (実装済み) |
| B4 | 比喩・メタファー不足 | シグナル語2個以上 | quality-checklist (実装済み) |
| B5 | 禁止書籍表現 | 15表現検出 | quality-checklist (実装済み) |
| B6 | AI臭い定型表現 | 4パターン検出 | quality-checklist (実装済み) |
| B7 | 小説的・文学的表現 | 6パターン検出 | quality-checklist (実装済み) |
| B8 | 「魂」多用（5回超） | 出現回数カウント | quality-checklist (実装済み) |
| B9 | 「愛」多用（5回超） | 出現回数カウント | quality-checklist (実装済み) |

### Category C: デプロイ整合性

| # | 問題 | チェック方法 | 実装先 |
|---|------|------------|-------|
| C1 | hub.css未配置 | FTPパスの存在確認 | deploy前チェック |
| C2 | GA4タグ欠落 | googletagmanager検出 | deploy前チェック |
| C3 | OGPメタタグ欠落 | og:title, og:description | deploy前チェック |
| C4 | CTA数不一致（2箇所） | harmony-cta-btn カウント | quality-checklist (実装済み) |
