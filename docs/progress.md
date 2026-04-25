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
