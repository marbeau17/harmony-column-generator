# P5-43 Step 1 完了確認チェックリスト

## 1. スキーマ
- [ ] マイグレーション `20260503000000_publish_control_unification_step1.sql` が `supabase/migrations/` に存在
- [ ] マイグレーションを開発環境に適用 (`supabase db reset` or `supabase migration up`)
- [ ] CHECK 制約に `'draft'`, `'pending_review'` が含まれていることを SQL で確認:
      `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'articles'::regclass AND contype = 'c';`

## 2. State machine
- [ ] `src/lib/publish-control/state-machine.ts` の TRANSITIONS に `draft` と `pending_review` ノードあり
- [ ] `assertTransition(draft, pending_review)` が成功
- [ ] `assertTransition(pending_review, idle)` が成功
- [ ] `assertTransition(pending_review, draft)` が成功 (差戻し)
- [ ] `assertTransition(live, draft)` が失敗 (illegal)

## 3. ヘルパー新設
- [ ] `src/lib/publish-control/visibility-predicate.ts` 存在
- [ ] `src/lib/publish-control/state-readers-sql.ts` 存在
- [ ] `src/lib/publish-control/lifecycle-stage.ts` 存在
- [ ] `src/lib/publish-control/runtime-parity.ts` 存在
- [ ] `src/lib/publish-control/type-guards.ts` 存在

## 4. 検証スクリプト
- [ ] `scripts/verify-publish-state-parity.ts` 存在 + dry-run 実行
- [ ] parity スクリプトの出力で「不整合 A: 0 件、B: 0 件」(差異あれば backfill 実行)
- [ ] `scripts/backfill-visibility-from-reviewed.ts` 存在 (apply は parity 不整合時のみ)

## 5. テスト
- [ ] `npx vitest run` 全 PASS (新テスト合計 50+ ケース増)
- [ ] `npx tsc --noEmit` エラーなし
- [ ] `npx playwright test test/e2e/publish-control-baseline.spec.ts --project=chromium` PASS (任意)

## 6. ドキュメント
- [ ] `docs/specs/publish-control/SPEC.md` に Step 1 反映
- [ ] `docs/progress.md` に進捗記録
- [ ] auto-memory に project_publish_control_v3.md 追加

## 7. デプロイ前
- [ ] git push origin main 完了
- [ ] Vercel deploy 完了 / smoke ✅
- [ ] production DB に migration 適用済み (Supabase CLI / dashboard)

## 8. 既存挙動の維持確認 (デグレ ✗)
- [ ] 既存記事の公開トグル (PublishButton) が正常動作
- [ ] FTP deploy が成功する (既 reviewed_at 記事)
- [ ] 一覧 UI のチェックボックス OK
- [ ] 一括非表示が動作

## 全完了後の次
→ Step 2 (readers migration) 着手判断 (parity 0 件確認後)
