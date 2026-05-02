# P5-43 Step 2 完了確認チェックリスト (readers migration)

> Step 1 完了 (2026-05-02 本番 migration 適用 + backfill 30 件 + smoke 10/10 PASS) を前提に、
> 公開可視性を判定する reader 8 箇所を `reviewed_at` 直接参照から
> `visibility_state` ベース (`isPubliclyVisible` / `whereVisible`) に移行する。

参照:
- 全体設計: `docs/refactor/publish-control-unification.md`
- Step 1 結果: `docs/refactor/step1-completion-checklist.md`
- HTML History Rule: `feedback_html_history.md`

---

## 1. readers 8 箇所の移行確認

各 reader が `reviewed_at` 直接参照ではなく `visibility-predicate` / `state-readers-sql` 経由で
公開可視性を判定していることを確認する。

### 1.1 公開フロント (Public Readers)
- [ ] **`src/lib/hub/hub-generator.ts:431`** — ハブページ生成時の公開記事抽出
  - 旧: `.eq('reviewed_at', ... )` 等の直接参照
  - 新: `whereVisible(query)` ファクトリ経由
  - 検証: 生成されたハブ HTML に未公開記事 (visibility_state != 'published') が混入しないこと

- [ ] **`src/app/sitemap.ts:37`** — sitemap.xml 生成時の公開記事抽出
  - 旧: `reviewed_at IS NOT NULL` フィルタ
  - 新: `whereVisible()` 経由
  - 検証: sitemap.xml に `pending_review` / `staged` / `archived` の URL が含まれないこと

- [ ] **`src/app/column/page.tsx:80`** — 公開コラム一覧ページ (`/column`)
  - 旧: 一覧クエリで `reviewed_at` 直接参照
  - 新: `whereVisible()` 経由 + ソートは `published_at` 優先
  - 検証: ログアウト状態で `/column` に未公開記事が出ないこと

- [ ] **`src/app/column/[slug]/page.tsx:32`** — 公開コラム詳細ページ (`/column/[slug]`)
  - 旧: 詳細取得で `reviewed_at IS NOT NULL` ガード
  - 新: `isPubliclyVisible(article)` で 404 判定
  - 検証: `pending_review` / `draft` slug にアクセスすると 404 返却

### 1.2 配信・運用系 Readers
- [ ] **`src/app/api/deploy/route.ts:42`** — FTP deploy 対象記事抽出
  - 旧: deploy 候補抽出で `reviewed_at` 直接参照
  - 新: `whereVisible()` 経由 + `visibility_state IN ('staged','published')` のみを対象
  - 検証: FTP deploy が既存挙動と一致 (既 reviewed_at 記事は引き続きデプロイ対象)

- [ ] **`scripts/embeddings/compute-centroid.ts:120`** — embedding centroid 計算対象
  - 旧: `reviewed_at IS NOT NULL` でフィルタ
  - 新: `whereVisible()` 経由
  - 検証: centroid 計算対象件数が Step 1 完了時点と一致

### 1.3 ダッシュボード Readers (管理画面)
> 管理画面は **未公開記事も表示する必要がある** ため、`whereVisible` ではなく
> `lifecycle-stage.ts` の `stageOf()` でバッジ表示・フィルタ判定を行う。

- [ ] **`src/app/dashboard/articles/page.tsx`** (8 references) — 管理画面 一覧
  - 8 箇所の `reviewed_at` 参照を順次 `stageOf()` / `isPubliclyVisible()` に置換
  - フィルタタブ (draft / pending_review / reviewed / staged / published / archived) が `visibility_state` 駆動で動作
  - 検証: 全タブで件数が parity スクリプト出力と一致

- [ ] **`src/app/dashboard/articles/[id]/page.tsx`** (3 references) — 管理画面 詳細
  - 3 箇所の `reviewed_at` 参照を `stageOf()` 経由に置換
  - 公開バッジ・差戻しボタンの表示判定が `visibility_state` 駆動
  - 検証: 各ステートの記事を開いて UI バッジが正しく表示

### 1.4 横断確認
- [ ] `grep -rn "reviewed_at" src/app src/lib scripts | grep -v "audit\|revisions\|test"` で
      公開可視性判定としての直接参照が **0 件** (監査・履歴・テスト用途は残置可)
- [ ] 残置した `reviewed_at` 参照は全てコメントで「監査用」と明記

---

## 2. Tests

### 2.1 既存テスト
- [ ] `npx vitest run` 全 PASS (Step 1 後の baseline と差異なし)
- [ ] `npx tsc --noEmit` エラーなし
- [ ] `npx playwright test test/e2e/publish-control-baseline.spec.ts --project=chromium` PASS

### 2.2 新規テスト
- [ ] `test/unit/readers-migration-step2.test.ts` 全 PASS
  - 8 reader それぞれについて、`visibility_state` 別に正しい結果セットを返すことを検証
  - `reviewed_at` だけ立っていて `visibility_state = 'pending_review'` のレコードが
    公開系 reader から **除外** されることを確認 (Step 1 backfill 後は発生しないが回帰防止)
- [ ] hub generator / sitemap の golden snapshot が更新済み (公開記事のみ含む)

---

## 3. 本番検証

### 3.1 parity / smoke
- [ ] `tsx scripts/verify-publish-state-parity.ts` で blockers=0 維持 (Step 1 完了時と同じ)
- [ ] production smoke 10/10 PASS (公開トグル / FTP deploy / 一覧 / 一括非表示 / 差戻し /
      ハブ生成 / sitemap / 詳細ページ / 管理画面一覧 / 管理画面詳細)

### 3.2 公開出力の整合性
- [ ] 公開ハブページ (`/column`) が `visibility_state IN ('staged','published')` の記事のみ列挙
- [ ] sitemap.xml が `visibility_state IN ('staged','published')` の URL のみ含む
- [ ] FTP deploy 後の本番サイトで未公開記事が混入していないこと
- [ ] Sentry に runtime-parity 警告 (Step 1 で仕込んだもの) が 24h で 0 件

### 3.3 ロールバック準備
- [ ] reader 1 箇所単位で revert 可能なよう PR を分割
- [ ] 万一の場合の rollback 手順を `docs/refactor/publish-control-unification.md` に追記

---

## 4. 次の Step 3 (writers migration) 着手判断

以下を全て満たした場合に Step 3 (writers migration) へ進む。

- [ ] 本チェックリスト §1〜§3 全項目 ✅
- [ ] reader 8 箇所の `reviewed_at` 直接参照が公開可視性判定として消滅
- [ ] production smoke 10/10 PASS が 48h 連続で維持
- [ ] parity スクリプトの blockers=0 が 48h 連続で維持
- [ ] Sentry に新規警告が出ていない

→ Step 3 (writers migration): 公開トグル / 差戻し / archive 等の writer 群を
   `state-machine.ts` の `assertTransition()` 経由に統一する。
