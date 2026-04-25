# Optimized Spec — Publish Control V2 / P1: step7（全公開経路の新列書込統一）

**Author:** Planner（クローズドループ・パイプライン 第 2 サイクル）
**Date:** 2026-04-25
**Scope:** SPEC §4 step7 — すべての公開経路で `is_hub_visible=true` / `visibility_state='live'` を同期書込する
**前サイクル:** P0 出荷直後検証 → 完全 PASS（`docs/feedback/eval_report.md` 参照）
**次サイクル候補:** step8 RLS 切替（本サイクル完了後）

---

## 1. 背景

P0 で Publish Control V2 が本番ローンチされた。現在の状態：
- 新 API `/api/articles/[id]/visibility` は `is_hub_visible` / `visibility_state` / `publish_events` を完全に書く
- しかし**既存の legacy 公開経路**（キュー処理、transition API）は `status='published'` のみ書き、新列を書かない
- step8 で RLS を `is_hub_visible=true` 基準に切り替えると、legacy 経路で公開した記事は**サイレント非公開化**するリスク

step7 はこのギャップを埋める。すべての公開経路が新列を書くようになれば step8 を安全に実行可能。

---

## 2. 偵察結果（参考）

| 経路 | ファイル | 現状 | step7 改修 |
|---|---|---|---|
| Visibility API（新） | `src/app/api/articles/[id]/visibility/route.ts` | ✅ 新列 + publish_events 全書込 | 不要 |
| キュー処理 | `src/app/api/queue/process/route.ts:904-912` | ❌ `status='published'` のみ | **必須** |
| Transition API | `src/app/api/articles/[id]/transition/route.ts` | `transitionArticleStatus()` 経由 | DB 層対応で間接的に達成 |
| DB 層 | `src/lib/db/articles.ts::transitionArticleStatus()` L240-287 | ❌ `published_at` のみ自動設定 | **必須** |
| バッチスクリプト | `scripts/*` | DB 直接書込なし（FTP のみ） | 不要 |

改修箇所は **2 ファイル**：`articles.ts` と `queue/process/route.ts`。

---

## 3. 設計

### 3.1 `transitionArticleStatus()` の改修

`src/lib/db/articles.ts` の `transitionArticleStatus()` で、`newStatus='published'` への遷移時に：

- `is_hub_visible: true` を `extraFields` にマージ（呼び出し元の上書きを許容）
- `visibility_state: 'live'` を `extraFields` にマージ
- `visibility_updated_at: new Date().toISOString()` を設定

ただし、すでに `extraFields` に値が指定されている場合は呼び出し元の指定を優先（明示的な non-publish 状態の保持）。

### 3.2 キュー処理の改修

`src/app/api/queue/process/route.ts` の `articles.update({...})` 呼び出し（L906-911 付近）に以下フィールドを追加：

```typescript
is_hub_visible: true,
visibility_state: 'live',
visibility_updated_at: new Date().toISOString(),
```

`status='published'` への自動遷移時のみ書き込む（既存ロジックの分岐維持）。

### 3.3 publish_events の扱い（任意）

step7 のスコープは「articles テーブルの新列を書く」こと。`publish_events` への INSERT は本サイクルでは**含めない**（auto-publish の監査ログは将来サイクルで段階的に整備）。

理由：
- `publish_events` の RLS は authenticated user 必須。キュー processor が service role で動作するため、Policy 設計の見直しが必要となり影響範囲が広がる
- step7 の本質は「RLS 切替後にサイレント非公開化を防ぐ」こと。新列書込で十分

---

## 4. 受け入れ基準（Evaluator が検証）

### AC-P1-1: `transitionArticleStatus()` の新列書込
- **手順**: `getArticleById` で取得した draft 記事 → `transitionArticleStatus(id, 'published')` を呼ぶ
- **期待**:
  - 戻り値の `status='published'`
  - 戻り値の `is_hub_visible=true`
  - 戻り値の `visibility_state='live'`
  - 戻り値の `published_at` が ISO 文字列で設定されている
  - 戻り値の `visibility_updated_at` が設定されている

### AC-P1-2: `transitionArticleStatus()` で extraFields の上書きが効く
- **手順**: `transitionArticleStatus(id, 'published', { is_hub_visible: false })` を呼ぶ
- **期待**: `is_hub_visible=false`（呼び出し元優先）

### AC-P1-3: published 以外への遷移では新列を変更しない
- **手順**: `transitionArticleStatus(id, 'draft')` を呼ぶ
- **期待**: `is_hub_visible` / `visibility_state` は元の値のまま（保持）

### AC-P1-4: キュー処理が新列を書く
- **手順**: `src/app/api/queue/process/route.ts` の対象箇所が新列書込を含むこと（コードレビュー）
- **期待**: 該当 `update()` オブジェクトに `is_hub_visible`, `visibility_state`, `visibility_updated_at` が含まれる

### AC-P1-5: 単体テスト全件 PASS
- **コマンド**: `npx vitest run`
- **期待**: 既存 72/72 + 新規 AC-P1-1〜AC-P1-3 用のテスト 3 件以上 ＝ 75+/75+ PASS

### AC-P1-6: 型チェック
- **コマンド**: `npx tsc --noEmit -p tsconfig.json`
- **期待**: exit 0

### AC-P1-7: プロダクションビルド
- **コマンド**: `npm run build`
- **期待**: PASS

### AC-P1-8: 既存 E2E（Publish Control V2）が依然 PASS
- **コマンド**: shadow Supabase + port 3100 dev server で `npx playwright test monkey-publish-control hub-rebuild`
- **期待**: 10/10 PASS（前サイクルから不変）

### AC-P1-9: デグレなし
- 既存機能（記事一覧、deploy API、hub deploy）に影響しない
- transitionArticleStatus を直接呼ぶ既存テスト群が PASS

---

## 5. 安全性ガード（必須遵守）

- **記事本文・タイトルへの write 禁止**（ユーザールール継続）
- 既存の 59 記事の `updated_at` を意図せず変更しない
- `transitionArticleStatus()` の呼び出し元（既存コード）の挙動を**破壊しない**（後方互換）
- DB 直接 SQL 実行なし（本サイクルでは migration 追加不要）

---

## 6. 実装手順（Fixer 向け）

1. `src/lib/db/articles.ts::transitionArticleStatus()` を改修：
   - `newStatus === 'published'` 分岐内で新列を `extraFields` にマージ（呼び出し元優先のため、`extraFields` を後勝ちでスプレッド）
2. `src/app/api/queue/process/route.ts` の `articles.update()` に新列追加（L906-911 付近）
3. `test/unit/articles.test.ts` （存在しない場合は新規作成）に AC-P1-1〜AC-P1-3 のテストを追加
4. `npx vitest run` 全件 PASS 確認
5. `npx tsc --noEmit` 確認
6. `npm run build` 確認
7. 既存 E2E は shadow 環境セットアップが必要なため Evaluator 2 で実施（Fixer は単体テストまで）

---

## 7. クローズドループ判定

| 条件 | アクション |
|---|---|
| AC-P1-1〜AC-P1-9 全件 PASS | 完了 → step7 達成、次サイクル（step8 RLS 切替 or 新 UI 切替）の Planner サイクルへ |
| AC のいずれか FAIL | Generator/Fixer に差し戻し |
| AC 自体が不整合 | Change Request で本仕様を更新 |

---

## 8. 完了定義

- すべての AC が PASS
- `/docs/feedback/eval_report.md` に第 2 サイクルの PASS 記録（追記）
- `/docs/progress.md` に step7 完了の記録（追記）
- ユーザに「P1 step7 完了 → 次サイクル候補（step8 RLS / 新 UI 切替）」を報告

---

## 9. リスク評価

| リスク | 緩和策 |
|---|---|
| `transitionArticleStatus()` の挙動変更で既存呼び出し元のテストが破綻 | 既存呼び出し元を grep で全列挙、影響を AC-P1-9 で確認 |
| キュー処理の `status='published'` 経路が他にもある | 偵察で `/api/queue/process/route.ts:904` のみ確認済。他の経路を grep で再確認（Fixer 責務） |
| 本番への直接影響 | 本サイクルは**コードのみ**。本番マイグレ・本番デプロイは別判断（次サイクル or 段階展開） |
| 新列を `false`/`'idle'` で書きたいケースの後方互換 | `extraFields` 後勝ちにより呼び出し元が明示的に override 可能 |
