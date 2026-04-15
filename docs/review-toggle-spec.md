# 由起子さん確認チェックボックス ON/OFF 仕様書

## 概要
記事一覧のチェックボックスをON/OFFすると、公開サイトのハブページ・個別記事ページに即座に反映される。

## チェックON時の動作
1. DB: `reviewed_at` = 現在時刻, `reviewed_by` = 小林由起子
2. UI: チェックマーク表示、記事タイトル横に✅
3. FTPハブページ: `/api/hub/deploy` 呼び出し → 記事がハブ一覧に追加
4. FTPデプロイ: `/api/articles/[id]/deploy` が許可される
5. Next.js /column/ 一覧: 記事が表示される
6. Next.js /column/[slug] 個別: 記事が表示される

## チェックOFF時の動作
1. 確認ダイアログ: 「ハブページから非表示になります」
2. DB: `reviewed_at` = null, `reviewed_by` = null
3. UI: チェック解除、✅消去
4. FTPハブページ: `/api/hub/deploy` 呼び出し → 記事がハブ一覧から除外
5. FTPデプロイ: `/api/articles/[id]/deploy` が422エラーでブロック
6. Next.js /column/ 一覧: 記事が非表示
7. Next.js /column/[slug] 個別: 404表示（記事ページにアクセスできない）

## 全レイヤーの reviewed_at フィルタ

| レイヤー | ファイル | フィルタ |
|---------|---------|---------|
| FTPハブページ生成 | hub-generator.ts buildArticleCards() | `.not('reviewed_at', 'is', null)` |
| FTPハブページ（deploy route） | deploy/route.ts L98 | `.not('reviewed_at', 'is', null)` |
| FTPデプロイゲート | deploy/route.ts L40-45 | `if (!article.reviewed_at)` → 422 |
| Next.js 一覧ページ | column/page.tsx getPublishedArticles() | `.not('reviewed_at', 'is', null)` |
| Next.js 個別ページ | column/[slug]/page.tsx getArticleBySlug() | `.not('reviewed_at', 'is', null)` |
| チェックボックスハンドラ | articles/page.tsx | DB更新 + `/api/hub/deploy` 呼び出し |
