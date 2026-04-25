# Optimized Spec — P3: P1+P2 バックログ集中処理（新UI切替 + 運用基盤強化）

**Author:** Planner（クローズドループ・パイプライン 第 4 サイクル）
**Date:** 2026-04-25
**Scope:** P1 #5（新 UI 切替）+ P2 #7（dangling 自動回復）+ P2 #8（publish_events ダッシュボード）+ P2 #9（live_hub_stale 通知）+ P2 #10（batch E2E 失敗修正）
**前サイクル:** P2 step8 完了（commit d923d98、本番 RLS 切替適用済）

---

## 1. 背景

Publish Control V2 は step1〜step8 すべて本番稼働。残るバックログは「新 UI 段階展開」と「運用基盤の整備（観測・通知・自動回復）」。各項目は独立して並列実装可能で、互いにファイル衝突しない設計。

---

## 2. スコープ別 概要

### 2.1 #5 新 UI 切替（低リスク・即時実施可）
- Vercel に `NEXT_PUBLIC_PUBLISH_CONTROL_V2=on` を追加 → 再デプロイ
- これにより `/dashboard/articles` で PublishButton UI が有効化（legacy checkbox は非表示に）
- ロールバック: env 削除のみ
- コード変更: なし（user 操作のみ + smoke test ドキュメント）

### 2.2 #7 dangling-deploying 自動回復
- 新 API: `POST /api/dangling-recovery`（service role 経由、auth なし、トークンガード）
  - `WHERE visibility_state='deploying' AND visibility_updated_at < now() - 60s` を `visibility_state='failed'` に遷移
  - 同時に publish_events に `action='dangling-recovery'` で監査ログ INSERT
- GitHub Actions: `.github/workflows/dangling-recovery.yml` — 5 分間隔で上記 API を curl
- 認証: `DANGLING_RECOVERY_TOKEN` 環境変数（Vercel + GitHub Secrets 両方に設定）

### 2.3 #8 publish_events 観察ダッシュボード
- 新ページ: `/dashboard/publish-events`
- 新 API: `GET /api/publish-events?range={24h|7d|30d}` で集計データ返却
- 表示要素:
  - 直近 24h / 7d / 30d のイベント数（action 別）
  - hub_deploy_status 失敗率
  - 失敗イベント直近 10 件
- Sidebar.tsx に navigation 項目追加

### 2.4 #9 live_hub_stale 検知通知
- 新ライブラリ: `src/lib/notify/slack.ts`
  - `sendSlackNotification(text: string)` シンプル webhook ラッパ
  - `process.env.SLACK_WEBHOOK_URL` 未設定時は no-op（CI / dev で安全）
- 既存 `src/app/api/articles/[id]/visibility/route.ts` で `live_hub_stale` 遷移時に通知
- 既存 `/api/dangling-recovery`（#7）でも通知

### 2.5 #10 batch-generation E2E 失敗修正
- `test/e2e/batch-api.spec.ts` のハードコード SERVICE_KEY を env 参照に変更
- E2E 環境変数バリデーション関数を `test/e2e/helpers/` に追加
- GEMINI_API_KEY 未設定時はテストを skip（fail でなく）

---

## 3. 受け入れ基準（Evaluator が検証）

### #5 新 UI 切替
- **AC-P3-1**: Vercel に `NEXT_PUBLIC_PUBLISH_CONTROL_V2=on` 追加手順が `docs/progress.md` に明記
- **AC-P3-2**: 切替後の本番 smoke test SQL（`is_hub_visible` 整合性）が `docs/progress.md` に記載
- **AC-P3-3**: 切替後の API smoke test（`POST /api/articles/{test}/visibility`）手順記載

### #7 dangling-recovery
- **AC-P3-4**: `src/app/api/dangling-recovery/route.ts` 新規作成、service role 経由、`DANGLING_RECOVERY_TOKEN` でガード
- **AC-P3-5**: `.github/workflows/dangling-recovery.yml` 新規作成、`*/5 * * * *` で API 呼び出し
- **AC-P3-6**: 単体テストで dangling 検出ロジックを検証（mock supabase）
- **AC-P3-7**: `publish_events` への `action='dangling-recovery'` INSERT を確認

### #8 publish_events ダッシュボード
- **AC-P3-8**: `src/app/(dashboard)/dashboard/publish-events/page.tsx` 新規作成
- **AC-P3-9**: `src/app/api/publish-events/route.ts` 新規作成（GET）、auth ガード付き
- **AC-P3-10**: `src/components/layout/Sidebar.tsx` の NAV に「イベント監視」追加
- **AC-P3-11**: ページが 24h / 7d / 30d のレンジで集計を表示する

### #9 live_hub_stale 通知
- **AC-P3-12**: `src/lib/notify/slack.ts` 新規作成、`SLACK_WEBHOOK_URL` 未設定時 no-op
- **AC-P3-13**: `src/app/api/articles/[id]/visibility/route.ts` の `live_hub_stale` 遷移箇所で通知呼び出し
- **AC-P3-14**: 単体テストで notify が条件付きで呼ばれることを検証

### #10 batch E2E
- **AC-P3-15**: `test/e2e/batch-api.spec.ts` のハードコード SERVICE_KEY を env 参照化
- **AC-P3-16**: GEMINI_API_KEY 不在時はテストを skip（test.skip）

### 共通
- **AC-P3-17**: 単体テスト全件 PASS（既存 75 + 新規追加分）
- **AC-P3-18**: 型チェック exit 0 / ビルド PASS
- **AC-P3-19**: 既存 E2E（monkey + hub-rebuild）10/10 PASS

---

## 4. 安全性ガード

- 記事本文への write 禁止
- 既存 publish-control コア（visibility/route.ts, articles.ts, hub-deploy/route.ts, publish-control/*）の**ロジック変更禁止**。新規追加のみ
- step8 の RLS ポリシーに影響する変更禁止
- 本番 DB への直接書込禁止（migration 追加なし）
- `DANGLING_RECOVERY_TOKEN` `SLACK_WEBHOOK_URL` の値はコードに含めない（env のみ）

---

## 5. 実装手順（並列 Fixer 用）

5 つの Fixer を並列起動可能。ファイル衝突なし。

| Fixer | 担当 | 作成 / 修正ファイル |
|---|---|---|
| F1 | #5 docs | `docs/progress.md` 追記 |
| F2 | #7 dangling | 新規: `src/app/api/dangling-recovery/route.ts`, `.github/workflows/dangling-recovery.yml`, `test/unit/dangling-recovery.test.ts` |
| F3 | #8 dashboard | 新規: `src/app/(dashboard)/dashboard/publish-events/page.tsx`, `src/app/api/publish-events/route.ts`. 修正: `src/components/layout/Sidebar.tsx` |
| F4 | #9 notify | 新規: `src/lib/notify/slack.ts`, `test/unit/notify-slack.test.ts`. 修正: `src/app/api/articles/[id]/visibility/route.ts` (1 行追加) |
| F5 | #10 batch test | 修正: `test/e2e/batch-api.spec.ts`, `test/e2e/batch-generation.spec.ts`（必要なら）, 新規: `test/e2e/helpers/env-check.ts` |

各 Fixer は単体テスト・型チェック・ビルドまで実施。E2E は Evaluator 2 が一括実行。

---

## 6. クローズドループ判定

| 条件 | アクション |
|---|---|
| AC-P3-1〜AC-P3-19 全件 PASS | 完了 → 次サイクル候補（観察強化、step9 待機） |
| 一部 FAIL | 該当 Fixer のみ差し戻し（他は確定） |
| 仕様不備 | Change Request |

---

## 7. リスク評価

| リスク | 緩和策 |
|---|---|
| #5 切替で UI が崩れる | env 削除で即時ロールバック可能 |
| #7 cron が誤って大量データ更新 | `LIMIT 100` を SQL に追加、token 認証必須 |
| #8 ダッシュボードに service role の機密情報露出 | API は authenticated user のみ、actor_email のみ表示（token 表示なし） |
| #9 SLACK_WEBHOOK_URL 漏洩 | env のみ、コードに含めない |
| #10 修正で他テストデグレ | 修正は test ファイルのみ、production code は触らない |

---

## 8. 完了定義

- 全 AC PASS
- `/docs/feedback/eval_report.md` に第 4 サイクルの PASS 記録（追記）
- `/docs/progress.md` に各 Fixer の完了記録（追記）
- ユーザに「P3 完了。残り step9 自動 PR 待ちのみ」を報告
