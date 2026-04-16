# 記事バージョン履歴仕様書

## 概要
記事の本文(stage2_body_html/stage3_final_html)とタイトルの直近3バージョンをDBに保持し、
ダッシュボードからワンクリックで任意のバージョンに復元可能にする。

## DB設計
既存の `article_revisions` テーブルを活用。直近3件を保持し、古いものは自動削除。

```sql
article_revisions:
  id UUID PK
  article_id UUID FK → articles(id) ON DELETE CASCADE
  revision_number INTEGER
  title TEXT
  body_html TEXT (stage3_final_html or stage2_body_html)
  meta_description TEXT
  change_type TEXT ('auto_save' | 'manual_save' | 'publish' | 'batch' | 'ai_generation')
  changed_by TEXT
  created_at TIMESTAMPTZ
```

## バージョン保存タイミング
- 記事がPUT /api/articles/[id] で更新される直前に現在のバージョンをスナップショット
- バッチ操作(CTA, TOC, ハイライト)の前にもスナップショット
- AI生成(generate-body, queue/process)の前にもスナップショット
- 自動保存(3秒ごと)では保存しない（ノイズが多すぎるため）

## 直近3件制限
- 新しいリビジョン保存時に、同一article_idのリビジョンが3件を超えたら最古を削除

## 復元API
- GET /api/articles/[id]/revisions → リビジョン一覧
- POST /api/articles/[id]/revisions/[revisionId]/restore → 復元

## ダッシュボードUI
- 記事詳細ページに「バージョン履歴」セクション追加
- 各バージョンに日時・変更タイプ・復元ボタンを表示

## 実装ファイル
- supabase/migrations/20260417000000_article_revisions.sql
- src/lib/db/article-revisions.ts (CRUD)
- src/app/api/articles/[id]/revisions/route.ts (GET)
- src/app/api/articles/[id]/revisions/[revisionId]/restore/route.ts (POST)
- src/lib/db/articles.ts updateArticle() にスナップショット追加
- src/app/(dashboard)/dashboard/articles/[id]/page.tsx にUI追加
