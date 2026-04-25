# Optimized Spec — Publish Control V2 / P2: step8（RLS 切替マイグレーション）

**Author:** Planner（クローズドループ・パイプライン 第 3 サイクル）
**Date:** 2026-04-25
**Scope:** SPEC §4 step8 — `articles` テーブルの RLS ポリシー `"Published articles are public"` の USING を `status='published'` から `is_hub_visible = true` に切り替える
**前サイクル:** P1 step7 完了（commit f633404）。全公開経路（Visibility API / `transitionArticleStatus()` / キュー処理）で `is_hub_visible=true` / `visibility_state='live'` を同期書込済み
**次サイクル候補:** 新 UI 切替 / 監査強化 / FTP non-delete confirm（step9 以降）

---

## 1. 背景

P0 で Publish Control V2 が本番ローンチされ、P1 step7 で全公開経路の新列同期書込が完了した。これにより step8 は安全に実施可能となった。

step8 では「ハブ可視性の真実の源（source of truth）」を **`articles.status`** から **`articles.is_hub_visible`** に切り替える。具体的には RLS ポリシー `"Published articles are public"` の USING 句を更新するだけだが、**step7 完了前に実施すると新規記事がサイレント非公開化する**ため順序が重要。step7 完了済（commit f633404）であることを前提に進める。

---

## 2. 偵察結果（参考）

| 観点 | 現状 | step8 影響 |
|---|---|---|
| 既存 policy 定義 | `supabase/schema.sql:195` および `supabase/migrations/20260404000000_initial_schema.sql:194` で `USING (status = 'published')` | DROP / CREATE で更新 |
| anon 経由 SELECT | 現在は `status='published'` の記事を見られる（idle 含む可能性あり） | `is_hub_visible=true` の記事のみに変わる |
| back-fill 状態 | `20260419000000_publish_control_v2.sql` で `status='published' AND reviewed_at IS NOT NULL` の 15 件を `is_hub_visible=true` に back-fill 済 | 母集団が変わらない（live=15） |
| `hub-generator.ts:430` | `status='published'` で SELECT（service role 経由） | service role は RLS bypass、影響なし |
| step7 整合性 | Visibility API / `transitionArticleStatus()` / キュー処理が `is_hub_visible=true` を同期書込 | 新規 published 記事も自動的にポリシー対象になる |

改修対象は **新規マイグレーション 1 ファイルのみ**。アプリケーションコードの変更は **不要**。

---

## 3. 設計

### 3.1 新マイグレーションファイル

**パス:** `supabase/migrations/20260425000000_publish_control_v2_rls_switch.sql`

**処理:**
1. 既存ポリシー `"Published articles are public"` を `DROP POLICY IF EXISTS` で削除
2. 同名ポリシーを `CREATE POLICY` で再作成し、`USING (is_hub_visible = true)` に変更
3. 適用検証用コメント（policy 名 / USING 内容）を SQL ファイル内に明記
4. ロールバック手順を SQL ファイル末尾にコメントで記載（`DROP POLICY` → 旧 `CREATE POLICY` の逆順 SQL）

**冪等性:** `DROP POLICY IF EXISTS` + `CREATE POLICY`（PostgreSQL は同名ポリシーの存在チェックがないため、必ず DROP を先行させる）。再実行時もエラーにならない。

### 3.2 アプリケーションコード変更

**なし。** step8 は DB スキーマ層の切替のみ。`hub-generator.ts:430` の `status='published'` 条件は service role 経由（RLS bypass）のため温存。

### 3.3 副作用解析

- **anon ロールから SELECT 可能な記事の母集団:**
  - 切替前: `status='published'`（live 15 件＋ idle に転落した published 記事があれば 0〜数件）
  - 切替後: `is_hub_visible=true`（15 件、back-fill 済）
- **想定差分:** 0 件（back-fill が現状を正確に反映済）
- **service role 経由のクエリ:** RLS bypass のため影響なし
- **authenticated ロール:** `"Authenticated users have full access"` policy が別途存在し、status / is_hub_visible に依存しないため影響なし

---

## 4. 受け入れ基準（Evaluator が検証）

### AC-P2-1: マイグレーション SQL の冪等性
- **手順:** 新マイグレ SQL を grep で確認
- **期待:** `DROP POLICY IF EXISTS "Published articles are public" ON articles;` および `CREATE POLICY "Published articles are public" ON articles FOR SELECT USING (is_hub_visible = true);` を含む

### AC-P2-2: shadow DB での適用→ロールバック→再適用が成功
- **手順:**
  1. `npx supabase db reset --local` で shadow DB に全マイグレ適用
  2. ロールバック SQL を psql で適用 → 旧ポリシーに戻ることを確認
  3. 新マイグレ SQL を再適用 → 新ポリシーに戻ることを確認
- **期待:** 各ステップでエラーなし

### AC-P2-3: shadow DB で anon ロールが is_hub_visible=true の記事のみ SELECT 可能
- **手順:** shadow DB に対し anon キーで `SELECT id, status, is_hub_visible FROM articles;` を実行
- **期待:**
  - 返却行はすべて `is_hub_visible=true`
  - `is_hub_visible=false` の行（idle / draft / unpublished 含む）は 1 件も返らない

### AC-P2-4: ポリシー定義の検証 SQL が期待通り
- **手順:** `SELECT policyname, qual FROM pg_policies WHERE tablename='articles' AND policyname='Published articles are public';`
- **期待:** `qual` カラムが `(is_hub_visible = true)` を含む

### AC-P2-5: 既存単体テスト全件 PASS
- **コマンド:** `npx vitest run`
- **期待:** 既存 75/75（前サイクル基準）相当が PASS（step8 は SQL のみのため新規テスト追加不要）

### AC-P2-6: 既存 E2E（Publish Control V2）が依然 PASS
- **コマンド:** shadow Supabase + port 3100 dev server で `npx playwright test monkey-publish-control hub-rebuild`
- **期待:** 10/10 PASS（前サイクルから不変）

### AC-P2-7: live=15 / idle=44 構成が変わらない
- **手順:** shadow DB で `SELECT visibility_state, COUNT(*) FROM articles GROUP BY visibility_state;` を実行
- **期待:** `live=15`, `idle=44`（または前サイクルと完全一致の構成）

### AC-P2-8: ロールバック手順が SQL ファイル内に明記されている
- **手順:** マイグレ SQL の末尾コメントを確認
- **期待:** `-- ROLLBACK:` 見出し配下に旧ポリシーへ戻すための DROP/CREATE 文が完全な形で記載されている

### AC-P2-9: 型チェック / ビルドへのデグレなし
- **コマンド:** `npx tsc --noEmit -p tsconfig.json` および `npm run build`
- **期待:** 両者 exit 0（SQL 変更のみだが念のため確認）

---

## 5. 安全性ガード（必須遵守）

- **記事本文・タイトル・コンテキストへの write 禁止**（ユーザールール継続）
- 本番 DB への適用は **ユーザ承認後** に行う。Fixer は **shadow DB での検証まで**
- step7 完了済を Fixer に **再確認させる**。確認手段：以下 3 点を grep で検証
  1. `src/app/api/articles/[id]/visibility/route.ts` で `is_hub_visible` 書込
  2. `src/lib/db/articles.ts::transitionArticleStatus()` で `is_hub_visible: true` 書込
  3. `src/app/api/queue/process/route.ts` で `is_hub_visible: true` 書込
- 既存マイグレファイルの**書き換え禁止**。新規ファイルとして追加
- アプリケーションコード（TypeScript）への変更**禁止**

---

## 6. 実装手順（Fixer 向け）

1. **step7 完了確認**: 上記 3 ファイルで `is_hub_visible` 書込が存在することを grep で確認（PASS しなければ即座に中断・ユーザ報告）
2. **新マイグレ SQL 作成**: `supabase/migrations/20260425000000_publish_control_v2_rls_switch.sql`
   - DROP POLICY IF EXISTS
   - CREATE POLICY ... USING (is_hub_visible = true)
   - 末尾に `-- ROLLBACK:` コメントブロックで逆操作 SQL を記載
3. **shadow DB 適用**: `npx supabase db reset --local`
4. **policy 検証**: `SELECT policyname, qual FROM pg_policies WHERE tablename='articles';` で USING 句を確認
5. **anon SELECT 検証**: anon キーで `articles` を SELECT し、`is_hub_visible=true` の行のみ返ることを確認（AC-P2-3）
6. **構成検証**: `visibility_state` 集計で live=15 / idle=44 を確認（AC-P2-7）
7. **roll-back リハーサル**: ロールバック SQL を shadow に適用 → 旧ポリシーに戻ることを確認後、再度新マイグレを適用
8. **既存テスト実行**: `npx vitest run` および E2E（必要に応じて Evaluator 2 が実行）
9. **progress.md 追記**（Fixer 責務）

---

## 7. クローズドループ判定

| 条件 | アクション |
|---|---|
| AC-P2-1〜AC-P2-9 全件 PASS | 完了 → step8 達成、ユーザに「shadow PASS → 本番適用判断」を仰ぐ |
| AC のいずれか FAIL | Generator/Fixer に差し戻し |
| AC 自体が不整合 | Change Request で本仕様を更新 |

---

## 8. 完了定義

- 全 AC が shadow DB で PASS
- `/docs/feedback/eval_report.md` に第 3 サイクルの PASS 記録（追記）
- `/docs/progress.md` に step8 完了記録（追記）
- ユーザに「P2 step8 shadow 完了 → 本番マイグレ適用判断」を報告。**本番適用は別判断**

---

## 9. リスク評価

| リスク | 重大度 | 緩和策 |
|---|---|---|
| 適用順序ミスによる新規記事サイレント非公開化 | 高 | step7 完了済（commit f633404）。Fixer 実装手順 1 で再確認 |
| `hub-generator.ts:430` の `status='published'` SELECT がポリシー変更で破綻 | 中 | service role 経由で RLS bypass のため影響なし。AC-P2-3〜AC-P2-7 で確認 |
| ロールバック不可リスク | 中 | SQL ファイル末尾に完全な逆操作 SQL を記載（AC-P2-8）。shadow でリハーサル済（AC-P2-2） |
| 本番適用後にエッジケースで非公開化が発覚 | 低 | back-fill により live=15 件は不変（AC-P2-7）。本番適用はユーザ承認後 |
| 既存マイグレファイルとの整合性破綻 | 低 | 新規ファイル追加のみ。既存ファイルへの書き換えなし |

---

## 10. 出荷判断（参考、本サイクル外）

step8 のマイグレは shadow PASS 後、ユーザ承認のうえ以下の順で本番適用：
1. 本番 Supabase へのマイグレ適用（`npx supabase db push` または管理 UI）
2. 適用直後に live 件数 / hub 公開記事数の差分監視（48h）
3. 異常時のロールバック判断（SQL は新マイグレ末尾コメントを使用）

本判断は **本サイクルのスコープ外**。Planner / Evaluator / Fixer は shadow PASS で本サイクル完了とする。
