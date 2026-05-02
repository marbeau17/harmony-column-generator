# P5-43 Step 3 完了確認チェックリスト (writers migration + review API)

> Step 1 (スキーマ + 並走ヘルパー基盤) / Step 2 (readers migration + parity 検証) 完了を前提に、
> writer 群を `visibility_state` ベースに統一し、`reviewed_at` / `reviewed_by` を audit-only に
> 限定するための新 API `POST /api/articles/[id]/review` を導入する。
>
> 本 Step が完了することで「書き込みは新 API or `state-machine.assertTransition()` 経由のみ」
> という単一系統が確立し、Step 4 (`reviewed_at` の状態判断からの完全切り離し) に着手できる。

参照:
- 全体設計: `docs/refactor/publish-control-unification.md` §4.1 / §5 Step 3
- Step 1 結果: `docs/refactor/step1-completion-checklist.md`
- Step 2 結果: `docs/refactor/step2-completion-checklist.md`
- HTML History Rule: `feedback_html_history.md`
- 仕様書: `docs/specs/publish-control/SPEC.md` §3.x「review action API」(本 Step で additive 追加)

---

## 1. マイグレーション (publish_events.action 拡張)

### 1.1 スキーマ変更
- [ ] **M1**: `supabase/migrations/20260502_publish_control_step3.sql` 作成
  - `publish_events.action` の CHECK 制約に新 action 値を追加:
    - `'review_submit'` — 由起子さん人間レビュー依頼 (`draft → pending_review`)
    - `'review_approve'` — 承認 (`pending_review → idle`)
    - `'review_reject'` — 差戻し (`pending_review → draft`)
  - 既存 4 値 (`publish` / `unpublish` / `hub_rebuild` / `ripple_regen`) は破壊しない
  - PostgreSQL の `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT` 方式で再作成
- [ ] **M2**: 適用前後の `publish_events` 件数バイト同一を `verify-publish-state-parity.ts` で確認
- [ ] **M3**: ロールバック SQL を migration ファイルにコメントで併記
  (旧 4 値のみの CHECK 制約に戻す)

### 1.2 検証
- [ ] 本番 DB で `INSERT INTO publish_events (action) VALUES ('review_approve')` が通る
- [ ] 旧 4 値の INSERT も引き続き通る
- [ ] 不正値 (例: `'foo'`) は CHECK 違反で reject される

---

## 2. 新規 review API

### 2.1 エンドポイント設計
- [ ] **A1**: `src/app/api/articles/[id]/review/route.ts` 新規作成
  - `POST /api/articles/[id]/review`
  - Body: `{ action: 'submit' | 'approve' | 'reject', requestId: ULID, reason?: string }`
  - 認証: dashboard セッション必須 (Supabase Auth)
- [ ] **A2**: アクション別の状態遷移
  | action | from (期待 state) | to | reviewed_at 書込 | reviewed_by 書込 |
  |:---|:---|:---|:---:|:---:|
  | `submit` | `draft` | `pending_review` | × | × |
  | `approve` | `pending_review` | `idle` | ◯ (now()) | ◯ (actor) |
  | `reject` | `pending_review` | `draft` | × | × |
- [ ] **A3**: `state-machine.ts` の `assertTransition()` を経由して遷移
  - 期待 state と異なる場合は 422 + `{ code: 'INVALID_TRANSITION' }`
- [ ] **A4**: `publish_events` に新 action (`review_submit` / `review_approve` / `review_reject`)
  を必ず INSERT
- [ ] **A5**: 冪等性 — `requestId` (ULID) で同一リクエスト重複を短絡 (既存 visibility API と同方式)

### 2.2 reviewed_at / reviewed_by の唯一の書込元
- [ ] **A6**: `approve` パスでのみ `reviewed_at = now()`, `reviewed_by = actor_id` を書く
  - 他の API (visibility / publish 系) では `reviewed_at` を一切触らない (副作用削除は §3 参照)
- [ ] **A7**: `reject` / `submit` では `reviewed_at` を変更しない (audit 履歴を保持)
- [ ] **A8**: HTML History Rule 準拠 — 本 API は HTML を書き換えないため `article_revisions`
  への INSERT は不要 (publish_events のみ)

### 2.3 エラーハンドリング
- [ ] **A9**: 422 — `INVALID_TRANSITION` / `MISSING_REQUEST_ID`
- [ ] **A10**: 423 — 他リクエストが同記事を処理中 (PG advisory lock 競合)
- [ ] **A11**: 401 — 未認証
- [ ] **A12**: 403 — 該当記事に対する書込権限なし (RLS)

---

## 3. writers 移行

### 3.1 visibility 副作用削除
- [ ] **W1**: `src/app/api/articles/[id]/visibility/route.ts:161-166` の
  `reviewed_at` 書込を **削除**
  - 旧: visibility=true 時に `reviewed_at = now()` を併せて書いていた
  - 新: `visibility_state` のみを更新。`reviewed_at` は新 review API でのみ書く
- [ ] **W2**: 同 `reviewed_by` 書込も削除
- [ ] **W3**: visibility API のレスポンスから `reviewed_at` フィールドを除去
  (UI が必要なら別 GET で取得)
- [ ] **W4**: visibility API の単体テストを更新 — `reviewed_at` が変化しないことをアサート

### 3.2 dashboard UI の差替え
- [ ] **W5**: `src/app/dashboard/articles/[id]/page.tsx` の確認ボタン
  - 旧: `PUT /api/articles/[id]` で `reviewed_at = now()` を直接書く
  - 新: `POST /api/articles/[id]/review` (action: `approve`) を呼ぶ
- [ ] **W6**: 差戻しボタン (新規 UI) を追加
  - `POST /api/articles/[id]/review` (action: `reject`) を呼ぶ
  - 確認モーダル付き (warning トーン)
- [ ] **W7**: 一覧画面 (`src/app/dashboard/articles/page.tsx`) の各行アクションも同様に新 API 経由
- [ ] **W8**: UI バッジ表示判定は §Step 2 で導入済の `stageOf()` を継続利用

### 3.3 zero-gen run-completion 移行
- [ ] **W9**: `src/lib/zero-generation/run-completion.ts` の `autoApprove` 分岐
  | autoApprove | 旧挙動 | 新挙動 |
  |:---:|:---|:---|
  | `true` | `reviewed_at = now()` 直書き | `visibility_state='idle'` を直接セット (review API 経由ではなく内部で `assertTransition('draft','idle')` 同等の特権遷移) |
  | `false` | (何もしない / draft のまま) | `visibility_state='pending_review'` をセット (内部で `submit` 相当) |
- [ ] **W10**: 両分岐とも `publish_events` に対応する action を INSERT
  - autoApprove=true: `'review_approve'` (actor は system)
  - autoApprove=false: `'review_submit'` (actor は system)
- [ ] **W11**: zero-gen 単体テスト (`test/unit/zero-gen-run-completion.test.ts`) を更新

### 3.4 batch-hide 移行
- [ ] **W12**: `scripts/batch-hide.ts` (および類似 ad-hoc スクリプト) の
  `reviewed_at` 直書きを `visibility_state='unpublished'` 直接セットに置換
  - publish_events に `action='unpublish'` を INSERT (既存 action なので CHECK 制約変更不要)
  - `reviewed_at` は変更しない (audit 保持)
- [ ] **W13**: スクリプト先頭コメントに「reviewed_at は触らない」旨を明記

### 3.5 ad-hoc 修復スクリプト点検
- [ ] **W14**: `scripts/*.ts` を `grep -n "reviewed_at" scripts/` で洗い出し
- [ ] **W15**: 状態判断目的の `reviewed_at` 直書きが残っているスクリプトを列挙
  - 移行対象 → 新 review API or `visibility_state` 直接更新に置換
  - 監査用途のみ (例: `verify-*` / `dump-*`) → コメントで「audit-only」と明記して残置可

---

## 4. テスト

### 4.1 新規テスト
- [ ] **T1**: `test/unit/review-api.test.ts` 全 PASS
  - `submit` / `approve` / `reject` 各アクションの正常系
  - 期待 state と異なる場合の 422 (`INVALID_TRANSITION`)
  - `requestId` 重複時の冪等動作
  - `approve` 時のみ `reviewed_at` / `reviewed_by` が更新されることをアサート
  - `reject` / `submit` で `reviewed_at` が変化しないことをアサート
  - `publish_events` への INSERT 内容 (action / actor_id / request_id) を検証

### 4.2 既存テスト
- [ ] **T2**: `npx vitest run` 全 PASS (Step 2 完了時の baseline と差異なし)
- [ ] **T3**: `npx tsc --noEmit` エラーなし
- [ ] **T4**: `npx playwright test test/e2e/publish-control-baseline.spec.ts --project=chromium` PASS
- [ ] **T5**: visibility API テストの更新版が PASS (`reviewed_at` 副作用削除の検証)
- [ ] **T6**: zero-gen run-completion テストの更新版が PASS

### 4.3 E2E (Playwright)
> `docs/refactor/publish-control-unification.md` §6.2 の 7 シナリオに準拠。
- [ ] **T7**: 承認→公開→撤回→再公開 (`pending_review → idle → live → unpublished → live`)
- [ ] **T8**: 承認なしで FTP deploy → 422 + `code: 'PENDING_REVIEW'`
- [ ] **T9**: zero-gen 完走 (autoApprove=false) → `visibility_state='pending_review'`
- [ ] **T10**: zero-gen 完走 (autoApprove=true) → `visibility_state='idle'`
- [ ] **T11**: batch-hide で 5 件一括非公開 → 全件 `unpublished`、`reviewed_at` 不変
- [ ] **T12**: 由起子さん「確認を取消」(reject) → `pending_review` 経由で `draft` 戻り

---

## 5. 本番検証

### 5.1 parity / smoke
- [ ] **V1**: `tsx scripts/verify-publish-state-parity.ts` で blockers=0 維持
  (Step 2 完了時と同じ)
- [ ] **V2**: production smoke 10/10 PASS
  (公開トグル / FTP deploy / 一覧 / 一括非表示 / 差戻し / ハブ生成 / sitemap /
   詳細ページ / 管理画面一覧 / 管理画面詳細)
- [ ] **V3**: 新 review API smoke 3/3 PASS (submit / approve / reject 各 1 回)

### 5.2 公開サイト整合性
- [ ] **V4**: 公開ハブ (`/column`) が `visibility_state IN ('staged','published','live')`
  の記事のみ列挙
- [ ] **V5**: sitemap.xml が同条件のみ含む
- [ ] **V6**: FTP 本番サイトで `pending_review` 記事が露出していない
- [ ] **V7**: Sentry に runtime-parity 警告 (Step 1 で仕込んだもの) が 24h で 0 件

### 5.3 audit 保全確認
- [ ] **V8**: 既存 45 件の `reviewed_at` 値が Step 3 適用前後でバイト同一
  (新 API を呼ばない限り変化しないことを確認)
- [ ] **V9**: `publish_events` テーブルに新 action (`review_*`) が記録され始めている
- [ ] **V10**: visibility API 経由のトグル後に `reviewed_at` が変化していないこと
  (副作用削除の確認)

### 5.4 ロールバック準備
- [ ] **V11**: writer 1 箇所単位で revert 可能なよう PR を分割
  (visibility 副作用削除 / dashboard UI / zero-gen / batch-hide を別 PR)
- [ ] **V12**: rollback 手順を `docs/refactor/publish-control-unification.md` §6.3 に追記済み
  (Step 3 ロールバック高リスク版)
- [ ] **V13**: savepoint タグ `chore: savepoint before unification step3` を Step 3 着手前に作成

---

## 6. 次の Step 4 (reviewed_at audit-only 降格) 着手判断

以下を全て満たした場合に Step 4 (`reviewed_at` を audit-only に降格) へ進む。

- [ ] 本チェックリスト §1〜§5 全項目 ✅
- [ ] `reviewed_at` 書込元が **新 review API の approve パス 1 箇所のみ** に集約済み
  (grep `reviewed_at\s*[:=]` で確認、audit/test 用途を除く)
- [ ] visibility API の `reviewed_at` 副作用が完全削除済み
- [ ] zero-gen autoApprove 両分岐が `visibility_state` ベースで動作
- [ ] production smoke 10/10 PASS が 48h 連続で維持
- [ ] parity スクリプトの blockers=0 が 48h 連続で維持
- [ ] Sentry に新規警告が出ていない
- [ ] `publish_events` の新 action 3 種が想定通り記録されている (1 週間分のサンプルで確認)

→ Step 4 (`reviewed_at` audit-only 降格):
   - 状態判断としての `reviewed_at` 読み取りを CI lint (custom ESLint rule) で機械的に禁止
   - `session-guard.ts` の guard 対象から `reviewed_at` を外す
   - migration コメントで「監査用列」と明記
   - `compute-centroid.ts` 等は Step 2 で `visibility_state` ベースに移行済みのため変更不要
