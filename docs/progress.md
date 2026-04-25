# Progress — Publish Control V2 P0 完了

**Date:** 2026-04-25
**Author:** Generator/Fixer (orchestrator-assisted)

## 実施内容

### 1. `.claude/session-guard.json` 更新
- `blockArticleWrites`: `true` → `false`
- `setAt`: `2026-04-19` → `2026-04-25`
- `reason`: 出荷完了に伴う通常運用復帰
- これにより `updateArticle` / `createArticle` / `transitionArticleStatus` / `deleteArticle` の通常書込みが再開可能

### 2. 単体テスト再実行
`npx vitest run test/unit/publish-control.test.ts --reporter=verbose` で session-guard 関連テスト 10 件を含む全件 PASS を確認。
- `is a no-op when blockArticleWrites=false`: PASS
- `delete is a no-op when blockArticleWrites=false`: PASS

## 起動手順（記事編集再開時）
1. `npm run dev` で dev server 起動（ポート 3000）
2. ダッシュボード（http://localhost:3000/dashboard/articles）から通常通り記事を編集
3. session-guard はバイパス済（blockArticleWrites=false）

## 確認事項
- 本番 production には影響なし（`.claude/` は `.gitignore` 対象外だが Vercel が `.claude/session-guard.json` を読みに行く経路は無い）
- 必要に応じて再度 `blockArticleWrites=true` に戻すことで dev guard を再有効化可能
- session-guard.ts のロジックは変更なし（テスト通過の挙動を維持）

## 関連ファイル
- `/Users/yasudaosamu/Desktop/codes/blogauto/.claude/session-guard.json` (修正)
- `/Users/yasudaosamu/Desktop/codes/blogauto/src/lib/publish-control/session-guard.ts` (ロジック、変更なし)
- `/Users/yasudaosamu/Desktop/codes/blogauto/test/unit/publish-control.test.ts` (テスト、変更なし)
- `/Users/yasudaosamu/Desktop/codes/blogauto/docs/optimized_spec.md` §5（実装根拠）

## クローズドループ判定
- Planner spec §5 の要件をすべて満たした
- 単体テストで session-guard が no-op になることを確認
- 次は Evaluator 2 が回帰チェック（spec §6 完了定義）

---

# Progress — P1 step7（全公開経路の新列書込統一）

**Date:** 2026-04-25
**Author:** Generator/Fixer

## 実施内容
- `src/lib/db/articles.ts::transitionArticleStatus()` を改修（`newStatus==='published'` 分岐で `is_hub_visible:true` / `visibility_state:'live'` / `visibility_updated_at` を自動設定。`extraFields` 後勝ちで呼び出し元 override を許容）。
- `src/lib/db/articles.ts::ArticleRow` インターフェイスに新公開列（`is_hub_visible` / `visibility_state` / `visibility_updated_at` / `deployed_hash`）を追加（型整合）。
- `src/app/api/queue/process/route.ts` の品質チェック合格時 `articles.update()` に新列 3 種を追加（既存フィールド保持）。
- `test/unit/articles.test.ts` を新規作成し AC-P1-1〜AC-P1-3 のテスト 3 件を追加（Supabase クライアントを `vi.mock` した payload 捕捉戦略）。

## 検証
- 単体テスト: 75/75 PASS（既存 72 + 新規 3）
- 型チェック: `npx tsc --noEmit -p tsconfig.json` exit 0
- ビルド: `npm run build` PASS（全ルートのバンドル生成完了）
- 既存呼び出し元 grep: `transitionArticleStatus` の呼び出しは `src/app/api/articles/[id]/transition/route.ts:104` のみ。`extraFields` 未指定のため新列は無条件 `true` / `'live'` で書かれる挙動を許容している（後方互換 OK）。

## 関連ファイル
- (modified) `/Users/yasudaosamu/Desktop/codes/blogauto/src/lib/db/articles.ts`
- (modified) `/Users/yasudaosamu/Desktop/codes/blogauto/src/app/api/queue/process/route.ts`
- (added)    `/Users/yasudaosamu/Desktop/codes/blogauto/test/unit/articles.test.ts`

## クローズドループ判定
- AC-P1-1〜AC-P1-7 の Fixer 責務分は完了。
- AC-P1-8（E2E shadow）と AC-P1-9（既存機能デグレ確認）は Evaluator 2 が回帰チェックで実施。
- 次サイクル候補: step8 RLS 切替 or 新 UI 切替。

---

# Progress — P2 step8（RLS 切替マイグレーション）

**Date:** 2026-04-25
**Author:** Generator/Fixer

## 実施内容
- `supabase/migrations/20260425000000_publish_control_v2_rls_switch.sql` を新規作成
  - `DROP POLICY IF EXISTS "Published articles are public" ON articles;`
  - `CREATE POLICY "Published articles are public" ON articles FOR SELECT USING (is_hub_visible = true);`
  - 末尾に ROLLBACK 手順をコメントで明記（旧 `status='published'` ポリシーへの逆操作 SQL 完全形）
- shadow DB (`npx supabase db reset --local`) で全マイグレ適用成功（新マイグレ含む）
- step7 完了 grep 確認: 3 ファイルすべてで `is_hub_visible` 書込確認済
  - `src/app/api/articles/[id]/visibility/route.ts:139`（`is_hub_visible: body.visible`）
  - `src/lib/db/articles.ts:277`（`publishedAutoFields.is_hub_visible = true`）
  - `src/app/api/queue/process/route.ts:913`（`is_hub_visible: true`）
- アプリケーションコード（.ts/.tsx）への変更は **なし**（仕様 §3.2 通り）

## 検証
- AC-P2-1 冪等性: `DROP POLICY IF EXISTS` + `CREATE POLICY` 構成（PASS）
- AC-P2-2 ロールバックリハーサル: shadow で旧ポリシー（`status='published'`）へ戻し成功 → 新マイグレ再適用で `(is_hub_visible = true)` に復帰確認（PASS）
- AC-P2-3 anon SELECT: REST 経由で `apikey=anon` を投げ、返却 15 件すべて `is_hub_visible=true`、`is_hub_visible=false` の行は 0 件（PASS）
- AC-P2-4 pg_policies.qual: `(is_hub_visible = true)` 確認済（PASS）
- AC-P2-5 単体テスト: 75/75 PASS（前サイクルから不変）
- AC-P2-7 構成: live=15 / idle=44（shadow に合成データ投入後の集計、PASS）
- AC-P2-8 ROLLBACK: SQL 末尾コメントに完全形で明記（PASS）
- AC-P2-9 型/ビルド: `npx tsc --noEmit` exit=0、`npm run build` PASS

## 注意事項
- shadow DB は `db reset` でデータが消えるため、AC-P2-3 / AC-P2-7 検証用に `live=15 / idle=44` を満たす合成データを `/tmp/seed_shadow.sql` で投入して検証した。本番 DB の既存 59 記事は触っていない。
- back-fill 自体は `20260419000000_publish_control_v2.sql` の DO ブロックが本番適用時に実行する設計（実データ存在下で動作）。

## 関連ファイル
- (added) `/Users/yasudaosamu/Desktop/codes/blogauto/supabase/migrations/20260425000000_publish_control_v2_rls_switch.sql`

## 次のアクション
- AC-P2-6 E2E（Publish Control V2 / Hub rebuild）は Evaluator 2 が実行
- 本番適用は ユーザ承認後（spec §10 参照）。`npx supabase db push` または管理 UI で適用 → 48h 監視 → 異常時は新マイグレ末尾の ROLLBACK SQL を実行

---

# Progress — P3 #5 新 UI 切替（NEXT_PUBLIC_PUBLISH_CONTROL_V2=on）

**Date:** 2026-04-25
**Author:** Generator/Fixer F1
**Loop Count: 0**

## ユーザ実施手順

### 1. Vercel 環境変数追加
1. https://vercel.com → プロジェクト「blogauto」→ Settings → Environment Variables
2. 以下を追加（Production チェック必須、Preview/Development は任意）:
   - Key: `NEXT_PUBLIC_PUBLISH_CONTROL_V2`
   - Value: `on`
3. 保存

### 2. 再デプロイ
- Deployments → 最新のデプロイを選択 → Redeploy
- または `git commit --allow-empty -m "chore: pickup NEXT_PUBLIC_PUBLISH_CONTROL_V2"` を push

### 3. 切替前 smoke test SQL（Supabase ダッシュボード）

```sql
-- back-fill 整合性確認
SELECT COUNT(*) AS reviewed_count FROM articles WHERE is_hub_visible = true;
-- 期待: 15

-- 状態整合性
SELECT id, status, reviewed_at, is_hub_visible, visibility_state
FROM articles
WHERE status='published' AND reviewed_at IS NOT NULL AND is_hub_visible != true
LIMIT 5;
-- 期待: 0 行
```

### 4. 切替後 smoke test
- ブラウザで /dashboard/articles を開く
- 記事行に PublishButton が表示されることを確認
- legacy checkbox UI が非表示であることを確認

### 5. 確認項目
- [ ] /dashboard/articles で PublishButton が記事行に表示される
- [ ] legacy checkbox UI が非表示
- [ ] PublishButton クリックで visibility 状態が変わる（テスト記事 1 件で）

### 6. ロールバック手段
- Vercel 環境変数から `NEXT_PUBLIC_PUBLISH_CONTROL_V2` を削除 → 再デプロイ
- DB / API への影響なし
