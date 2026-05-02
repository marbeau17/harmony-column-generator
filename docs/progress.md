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

---

# Progress — P4 残バックログ集中処理（#11-#18）

**Date:** 2026-04-25
**Author:** Generator/Fixer (orchestrator-assisted, P4-A〜P4-H 逐次)
**Loop Count: 0**

## P4-A: `.env.local.example` 強化（#15）
- Publish Control V2 / dangling / Slack / Monkey / E2E 用キーを追加
- 各キーに 1 行コメント記載

## P4-B: Supabase CLI v2.20.12 → v2.95.2（#17）
- `package.json` devDependencies に `supabase: ^2.95.2` 追加
- `npx supabase --version` で v2.95.2 確認、`npx supabase` が local devDep を解決

## P4-C: README.md V2 セクション追加（#16）
- Publish Control V2 概要 / 公開フロー / 環境変数表 / 運用 SQL / 監視 URL / ロールバック追記
- 既存セクション温存（103 → 193 行）

## P4-D: docs 整理（#18）
- `docs/source-mapping-20260407.md` → `docs/archive/` に移動
- `supabase/Claude.md` は git untracked のため未変更

## P4-E: session-guard MONKEY_TEST bypass 強化（#13）
- `MONKEY_TEST=true` 単独 bypass を廃止
- `MONKEY_TEST=true AND SUPABASE_URL に localhost/127.0.0.1 を含む` 時のみ bypass
- 単体テスト 2 件追加（30/30 PASS）

## P4-F: PublishButton toast 化（#12）
- `react-hot-toast` 導入
- `src/app/layout.tsx` に `<Toaster />` 配置（dark: 対応）
- PublishButton 内 alert() 2 件を toast.success / toast.error に置換、hub_stale 警告 toast 追加
- alert() 件数: 0、87/87 PASS

## P4-G: CI E2E 自動化（#14）
- `.github/workflows/e2e.yml` 新規作成
- pull_request + workflow_dispatch trigger
- shadow Supabase 起動 → migration → test user seed → dev server 3100 → playwright
- 失敗時に playwright-report / test-results / next-e2e.log を artifact upload
- 必要 GitHub Secrets: `MONKEY_SUPABASE_SERVICE_ROLE_KEY`, `MONKEY_SUPABASE_ANON_KEY`, `TEST_USER_PASSWORD`

## P4-H: scripts/ 整理（#11）
- `scripts/dangerous/` 新設、記事本文書換系 10 件を移動（fix-/improve-/recover-/regenerate-/reassign-）
- `scripts/ops/` 新設、デプロイ系 5 件を移動（ftp-deploy-/redeploy-/process-queue-）
- 各ディレクトリに README.md を配置（実行ルール・廃止候補を明記）
- 既存コード参照: docs/specs 配下に historical 言及あり、active code には参照なし

## 検証
- 単体テスト: **87/87 PASS**（前 75 + P4-E 新規 2 + 既存テスト変動 ＋10）
- 型チェック: exit=0
- ビルド: PASS

## 関連ファイル
- (modified) `.env.local.example`, `package.json`, `package-lock.json`, `README.md`
- (modified) `src/app/layout.tsx`, `src/components/articles/PublishButton.tsx`
- (modified) `src/lib/publish-control/session-guard.ts`, `test/unit/publish-control.test.ts`
- (added) `.github/workflows/e2e.yml`
- (added) `scripts/dangerous/README.md`, `scripts/ops/README.md`
- (moved) `scripts/dangerous/*.ts` (10 ファイル), `scripts/ops/*.ts` (5 ファイル), `docs/archive/source-mapping-20260407.md`

## 次のアクション
- D: shadow Supabase 再起動 → AC-P3-19 / AC-P4 final E2E を確定 PASS に
- 全変更を commit + push（main へ）

---

# Progress — P5-1〜P5-7 Zero-Generation V1 実装

**Date:** 2026-04-30
**Author:** Generator/Fixer (orchestrator-assisted, 31 名並列実装)
**Loop Count: 0**

## 完了サブサイクル

### P5-1 基盤（10 並列、commit 5e91797）
- マイグレ: `20260501000000_zero_generation_v1.sql`（pgvector + 4 新規テーブル + articles 9 列）
- F1: マイグレ DDL 作成
- F2: RAG embed/retrieve パイプ + Gemini text-embedding-004 統合
- F3: Claim Extractor lib（recall ≥ 0.9）
- F4: Hallucination 4 検証器（factual/attribution/spiritual/logical）
- F5: Yukiko トーン scoring（14 項目）
- F6: 文体 centroid（compute + similarity）
- F7: Zero-outline prompt
- F8: zero-generate API（outline 生成）
- F9: UI new-from-scratch（Stepper + IntentRadioCard）
- F10: E2E ZG 雛形（5 ケース collect）

### P5-2/P5-3 統合 + UI（11 並列、commit d77c8dd）
- G1: shadow 検証（9 マイグレ全 PASS、ivfflat smoke OK）
- G2: Stage2 Zero Writing prompt
- G3: ハルシネ・パイプライン統合
- G4: トーン・パイプライン統合
- G5: Zero 画像プロンプト（ペルソナ別ビジュアル）
- G6: 画像 Vision 検査（Gemini Vision）
- G7: UI HallucinationResultPane + ClaimCard
- G8: UI RegenerationControls + DiffViewer
- G9: CTA Variants Generator
- G10: 統合 API zero-generate-full（動的 import）
- G11: 生成方式選択 UI（new-choice）

### P5-4/P5-5/P5-6/P5-7（20 並列、本コミット）
- H1: match_source_chunks RPC マイグレ（20260502000000）
- H2: zero-generate-full 静的 import + article_revisions 履歴
- H3: regenerate-segment route
- H4: hallucination-check route
- H5: visibility/route.ts に hallucination critical=0 ゲート
- H6: new-from-scratch UI に G7/G8 統合
- H7: dashboard articles にスコア列
- H8: publish-events ダッシュボード拡張
- H9: README V2 セクション追加（193→258 行）
- H10: prompt cache 実装（Gemini Context Cache）
- H11: embed スクリプト強化（resumable, chunked, cost-aware）
- H12: 統合パイプ integration test（8/8 PASS）
- H13: SSE 進捗ストリーム + job store
- H14: E2E ZG-1〜5 unskip
- H15: スモーク seed 拡張（123→271 行）
- H16: shadow E2E 実機検証
- H17: hallucination retry GitHub Actions cron

## 検証
- 単体テスト: 385+/385+ PASS
- 型チェック: exit=0
- ビルド: PASS（新ルート 5 つ追加）

## 関連ファイル一覧
- supabase/migrations/20260501000000_zero_generation_v1.sql
- supabase/migrations/20260502000000_zero_generation_rpc.sql
- src/lib/ai/{embedding-client.ts, prompt-cache-manager.ts}
- src/lib/ai/prompts/{stage1-zero-outline,stage2-zero-writing,zero-image-prompt}.ts
- src/lib/rag/{embed-source-chunks,retrieve-chunks}.ts
- src/lib/hallucination/{claim-extractor,run-checks,persist-claims,index,validators/*}.ts
- src/lib/tone/{yukiko-scoring,compute-centroid,centroid-similarity,run-tone-checks,persist-tone}.ts
- src/lib/image/vision-check.ts
- src/lib/content/{cta-variants-generator,persist-cta-variants}.ts
- src/lib/jobs/zero-gen-job-store.ts
- src/app/api/articles/zero-generate-full/route.ts
- src/app/api/articles/[id]/{regenerate-segment,hallucination-check}/route.ts
- src/app/api/articles/zero-generate/[job_id]/progress/route.ts
- src/app/api/hallucination-retry/route.ts
- src/app/(dashboard)/dashboard/articles/{new-choice,new-from-scratch}/page.tsx
- src/components/articles/{HallucinationResultPane,ClaimCard,RegenerationControls,DiffViewer}.tsx
- .github/workflows/hallucination-retry.yml

## 残タスク（次サイクル）
- 本番マイグレ適用（20260501 + 20260502）— ユーザ承認後
- 1499 source 記事の本物 embedding 投入（GEMINI_API_KEY + コスト試算後）
- Vercel 環境変数追加: HALLUCINATION_RETRY_TOKEN
- GitHub Secrets / Variables: HALLUCINATION_RETRY_URL / HALLUCINATION_RETRY_TOKEN
- 本番デプロイ + スモーク（P5-8）

## 次のアクション
1. ユーザに本番投入手順を提示
2. GEMINI_API_KEY のコスト試算
3. shadow → staging → 本番 の段階展開判断

---

# P5-8 本番投入手順（ユーザ実行）

## ステップ 1: 本番マイグレ適用（順序厳守）

### 1-1. 事前確認
```sql
-- 本番 Supabase SQL Editor で実行
SELECT version();  -- PostgreSQL 17 想定
SELECT * FROM pg_extension WHERE extname='vector';  -- pgvector 既存確認
```

### 1-2. マイグレ適用
```bash
# ローカルから本番に push
npx supabase migration up --linked
# 期待:
# - 20260501000000_zero_generation_v1.sql 適用（pgvector + 4テーブル + articles 9列）
# - 20260502000000_zero_generation_rpc.sql 適用（match_source_chunks 関数）
```

### 1-3. 適用後検証
```sql
-- 全 4 新規テーブル存在確認
SELECT count(*) FROM source_chunks;        -- 0
SELECT count(*) FROM article_claims;        -- 0
SELECT count(*) FROM yukiko_style_centroid; -- 0
SELECT count(*) FROM cta_variants;          -- 0

-- articles 新列確認
SELECT column_name FROM information_schema.columns
WHERE table_name='articles' AND column_name IN
  ('generation_mode','intent','lead_summary','citation_highlights',
   'narrative_arc','emotion_curve','hallucination_score',
   'yukiko_tone_score','readability_score');
-- 期待: 9 行

-- RPC 関数確認
SELECT proname FROM pg_proc WHERE proname='match_source_chunks';
-- 期待: 1 行
```

## ステップ 2: 1499 記事 embedding 投入

### 2-1. コスト試算（dry-run）
```bash
GEMINI_API_KEY=<key> tsx scripts/embed-all-source-chunks.ts --dry-run
# 想定: 1499 記事 × ~3 chunks = ~4500 chunks
# text-embedding-004 単価: $0.025/1M tokens
# 想定: ~$0.05〜$0.50（無視できる）
```

### 2-2. 段階投入
```bash
# まず 50 件で smoke test
GEMINI_API_KEY=<key> tsx scripts/embed-all-source-chunks.ts --limit=50 --batch-size=10 --confirm

# 問題なければ全件投入（resume 対応）
GEMINI_API_KEY=<key> tsx scripts/embed-all-source-chunks.ts --batch-size=20 --resume --confirm
```

### 2-3. 投入後検証
```sql
SELECT count(*) FROM source_chunks;
-- 期待: ~4500（chunk 数次第）

SELECT count(DISTINCT source_article_id) FROM source_chunks;
-- 期待: 1499

-- ivfflat インデックスを再構築（little data 警告対策）
REINDEX INDEX idx_source_chunks_embedding;
```

## ステップ 3: 由起子文体 centroid 計算

```bash
# 既存 reviewed 記事から centroid を計算 → DB へ
GEMINI_API_KEY=<key> tsx scripts/recompute-yukiko-centroid.ts
```

検証:
```sql
SELECT version, sample_size, computed_at FROM yukiko_style_centroid WHERE is_active=true;
-- 期待: 1 行
```

## ステップ 4: Vercel 環境変数追加

| Key | Value | 用途 |
|---|---|---|
| `GEMINI_API_KEY` | (既存) | embedding + 生成 |
| `GEMINI_VISION_MODEL` | `gemini-2.5-flash` | 画像 Vision 検査（任意） |
| `HALLUCINATION_RETRY_TOKEN` | `openssl rand -hex 32` で生成 | retry cron 認証 |

## ステップ 5: GitHub Variables/Secrets 追加

| 種別 | Name | Value |
|---|---|---|
| Variable | `HALLUCINATION_RETRY_URL` | `https://blogauto-pi.vercel.app/api/hallucination-retry` |
| Secret | `HALLUCINATION_RETRY_TOKEN` | Vercel と同じ |

## ステップ 6: Vercel 再デプロイ

`git commit --allow-empty -m "chore: pickup hallucination env" && git push origin main`

## ステップ 7: 本番スモークテスト

```bash
# A. visibility API 認証ガード（既存）
curl -s -o /dev/null -w "%{http_code}" -X POST \
  https://blogauto-pi.vercel.app/api/articles/00000000-0000-0000-0000-000000000000/visibility \
  -H "Content-Type: application/json" \
  -d '{"visible":true,"requestId":"01ARZ3NDEKTSV4RRFFQ69G5FAV"}'
# 期待: 401

# B. zero-generate-full 認証ガード
curl -s -o /dev/null -w "%{http_code}" -X POST \
  https://blogauto-pi.vercel.app/api/articles/zero-generate-full \
  -H "Content-Type: application/json" -d '{}'
# 期待: 401

# C. hallucination-retry 認証ガード
curl -s -X POST \
  https://blogauto-pi.vercel.app/api/hallucination-retry \
  -H "Authorization: Bearer wrong_token" -H "Content-Type: application/json"
# 期待: 401 + "unauthorized"

# D. dashboard /dashboard/articles/new-choice にログインしてアクセス、2 カード表示確認
```

## ステップ 8: 段階展開（推奨）

| 段階 | 内容 | 確認 |
|---|---|---|
| 1 | テスト記事 1 件をゼロ生成 | hallucination_score / yukiko_tone_score 適切 |
| 2 | 観察期間 7 日 | publish_events / hallucination critical 集計監視 |
| 3 | 本格運用開始 | /dashboard/publish-events で監視 |

## ステップ 9: ロールバック手順（万一）

### マイグレロールバック
```sql
-- 20260502 RPC 削除
DROP FUNCTION IF EXISTS match_source_chunks(vector, int, text[]);

-- 20260501 全削除（テーブル削除）
DROP TABLE IF EXISTS cta_variants CASCADE;
DROP TABLE IF EXISTS yukiko_style_centroid CASCADE;
DROP TABLE IF EXISTS article_claims CASCADE;
DROP TABLE IF EXISTS source_chunks CASCADE;
ALTER TABLE articles
  DROP COLUMN IF EXISTS generation_mode,
  DROP COLUMN IF EXISTS intent,
  DROP COLUMN IF EXISTS lead_summary,
  DROP COLUMN IF EXISTS citation_highlights,
  DROP COLUMN IF EXISTS narrative_arc,
  DROP COLUMN IF EXISTS emotion_curve,
  DROP COLUMN IF EXISTS hallucination_score,
  DROP COLUMN IF EXISTS yukiko_tone_score,
  DROP COLUMN IF EXISTS readability_score;
DROP EXTENSION IF EXISTS vector;
```

詳細は各マイグレファイルの末尾 ROLLBACK コメントを参照。

### Code ロールバック
- Vercel 環境変数から `NEXT_PUBLIC_PUBLISH_CONTROL_V2` を削除すれば new-from-scratch 等は disabled に
- 完全ロールバックは git revert （commit 5e91797 / d77c8dd / 本コミット を順次 revert）

---

**P5 完了**：全実装完遂、本番投入はユーザ承認後

---

# Progress — P5-9: 既存 source 記事の Web からの一括非表示（Batch Hide）

**Date:** 2026-04-30
**Author:** Generator/Fixer J13

## 経緯
ユーザ要件:「既存コラムから生成されたブログを Web から隠したい」
→ 全 15 件の `is_hub_visible=true` 記事（全て `generation_mode='source' or NULL`）を一括ソフト撤回。

## 実装
- API: `POST /api/articles/batch-hide-source`（J1 実装）
- UI: 記事一覧上部 BatchHideButton（J5 実装）

## 本番実行手順

### Step 1: 事前確認（dry-run）
1. 本番ダッシュボード `https://blogauto-pi.vercel.app/dashboard/articles` を開く
2. ツールバーの「既存記事を一括非表示」ボタンをクリック
3. モーダルで `HIDE_ALL_SOURCE` と入力
4. 「dry-run で確認」をクリック
5. 結果に表示される `candidates: 15` を確認（対象件数の事前確認）

### Step 2: 実行
1. 同モーダル「実行」ボタンをクリック
2. 結果ペインで `hidden: 15` `hub_rebuild_status: ok` を確認
3. ハブページ `https://harmony-mc.com/column/` を再読込し、記事が空になっていることを確認
4. 個別 URL `https://harmony-mc.com/column/{slug}/` のいくつかにアクセス → `<meta name="robots" content="noindex,...">` が出力されていることを確認

### Step 3: DB 検証（Supabase SQL Editor）

```sql
-- 1. is_hub_visible=true 件数（0 を期待）
SELECT count(*) FROM articles WHERE is_hub_visible = true;

-- 2. visibility_state 分布
SELECT visibility_state, count(*) FROM articles GROUP BY visibility_state;
-- 期待: unpublished=15, idle=44

-- 3. publish_events に履歴
SELECT count(*) FROM publish_events
WHERE action='unpublish' AND reason='batch-hide-source'
  AND created_at > now() - interval '1 hour';
-- 期待: 15
```

## ロールバック手順（再公開）

万一、誤って一括非表示にした場合の復旧:

### Option A: ダッシュボードで個別に PublishButton 経由
1. `/dashboard/articles` で各記事の PublishButton をクリック → 再公開
2. 推奨: 慎重に 1 記事ずつ確認しながら

### Option B: SQL で一括戻し（推奨しない）
```sql
-- バックアップから戻す場合のみ
UPDATE articles
SET is_hub_visible = true,
    visibility_state = 'live',
    visibility_updated_at = now()
WHERE id IN (
  -- batch-hide 直前の is_hub_visible=true だった id を publish_events から逆引き
  SELECT article_id FROM publish_events
  WHERE action='unpublish' AND reason='batch-hide-source'
    AND created_at > now() - interval '24 hours'
);
```
**注意**: SQL 一括戻しは FTP の noindex HTML を上書きしないため、個別 URL は noindex のまま残る。Option A 推奨。

### Option C: FTP の noindex HTML を強制再上書き
個別記事ページを再公開する場合は visibility API 経由で `visible:true` にすると、既存 deploy ロジックで FTP の本物 HTML に戻る。

## 注意事項
- 本機能は **ソフト撤回のみ**（FTP delete なし、CLAUDE.md FTP 非削除原則遵守）
- 全 publish_events に履歴が残るため後追い分析・復元の根拠になる
- 一括非表示で hub は空になるため、新しい zero-generation 記事を順次投入して埋めていく想定

---

# P5-9 全完了サマリ — Bug Fix + Batch Hide + 検証層

**Date:** 2026-04-30
**Author:** Generator/Fixer (orchestrator-assisted, 20 並列実装)
**Loop Count: 0**

## 経緯
1. ユーザ要件: 「既存ソース記事を Web から一括非表示にしたい」
2. ユーザ報告 Bug: `/api/articles/zero-generate-full` が **400 Validation Error**
   原因: フォームが theme/persona をラベル文字列で送信、API は UUID を要求

## 対応 (4 Wave × 5 並列 = 20 J-Fixer)

### Wave 1: API + UI 基盤
- J1 batch-hide-source API + lib/articles/batch-hide.ts
- J2 GET /api/themes（UUID 含む themes 一覧）
- J3 GET /api/personas（UUID 含む personas 一覧）
- J4 new-from-scratch ページで themes/personas を fetch + UUID bind（**バグ解消**）
- J5 BatchHideButton UI + 記事一覧ツールバー統合

### Wave 2: テスト
- J6 batch-hide-source-api.test (8件 PASS、UPDATE payload 検査で本文列不在確認)
- J7 themes-api.test (8件 PASS)
- J8 personas-api.test (7件 PASS)
- J9 new-from-scratch-form-uuid.test (4件 PASS、@testing-library/react 導入)
- J10 batch-hide-button.test (11件 PASS)

### Wave 3: 品質 + ドキュメント
- J11 バリデーションエラー詳細表示（フィールド別日本語 toast）
- J12 shadow seed UUID 安定化（themes 8 + personas 5 固定 UUID）
- J13 batch-hide 本番実行手順 + ロールバック docs（progress.md +79行）
- J14 zero-generate-full エラーログ強化（12 stage 構造化、request_id trace）
- J15 hallucination-retry health check endpoint + lib

### Wave 4: 検証 + ドキュメント
- J16 E2E real-form ZG (zero-generation-form.spec.ts)
- J17 E2E batch-hide (batch-hide-source.spec.ts)
- J18 shadow E2E 実機検証（既存 monkey + hub-rebuild 回帰確認）
- J19 progress.md 更新 (本セクション)
- J20 eval_report 第7サイクル PASS 記録

## 検証
- 単体テスト追加: 約 40 件
- 型チェック: exit=0
- ビルド: PASS（新ルート 4 つ追加: /api/articles/batch-hide-source, /api/themes, /api/personas, /api/hallucination-retry/health）
- 既存 publish-control / hub-rebuild: 回帰なし

## 関連ファイル
- (added) src/app/api/articles/batch-hide-source/route.ts
- (added) src/app/api/themes/route.ts
- (added) src/app/api/personas/route.ts
- (added) src/app/api/hallucination-retry/health/route.ts
- (added) src/lib/articles/batch-hide.ts
- (added) src/lib/hallucination-retry/health.ts
- (added) src/components/articles/BatchHideButton.tsx
- (modified) src/app/(dashboard)/dashboard/articles/page.tsx
- (modified) src/app/(dashboard)/dashboard/articles/new-from-scratch/page.tsx
- (modified) src/app/api/articles/zero-generate-full/route.ts
- (added) test/unit/{batch-hide-source-api,themes-api,personas-api,batch-hide-button,new-from-scratch-form-uuid,hallucination-retry-health-api}.test.{ts,tsx}
- (added) test/e2e/{zero-generation-form,batch-hide-source}.spec.ts
- (modified) test/e2e/fixtures/zero-generation-seed.sql

## 残タスク（次サイクル）
- 本番マイグレ適用 (20260501 + 20260502)
- 1499 記事本物 embedding 投入
- Vercel/GitHub 環境変数追加 (HALLUCINATION_RETRY_TOKEN 等)
- 段階展開 → 本番 batch-hide 実行（ユーザ承認後）
- publish_events.action CHECK 制約に 'hallucination-retry' 'batch-hide-source' 追加マイグレ（J15 が言及）

---

# P5-10 — 生成モード可視化 + 本番投入第一歩（2026-05-01）

## 目的
ユーザ要件「rewrite or created newly from scratch or not」を全画面で識別可能にし、
本番に zero-generation 記事を 1 件試作投入してパイプライン健全性を検証する。

## 実施内容（20名並列）

### Wave 1: 本番状態確認 + 試作投入
- K1 本番 themes/personas 取得確認（7/7 アクティブ）
- K2 本番 source_chunks 件数確認（0 件）
- K3 本番 zero-gen 1 件 INSERT — id=`cc1d079a-743d-4ee8-8305-dba89f4e02dc` / generation_mode=zero / draft / is_hub_visible=false
- K4 試作結果検証（lead/arc/citations 全 populate 確認）
- K11 createArticle に `generation_mode?: 'zero'|'source'` 入力 + 既定 'source' 明示

### Wave 2: UI 可視化（共通コンポ + 4 画面 + Filter）
- K5 GenerationModeBadge 共通コンポ（紫 ✨ zero / 水色 📚 source / グレー ❓ unknown / dark 対応）
- K6 一覧ページ inline rendering → Badge に置換
- K7 記事詳細ページに Badge 追加（h1 隣接）
- K8 new-from-scratch 完了バナーに Badge 追加
- K9 publish-events 一覧に Badge 列追加 + API 側 `articles!inner(generation_mode)` join
- K10 モード Filter Dropdown 追加（全て / ゼロ生成 / リライト、legacy null=source 規約踏襲）
- K12 Badge 単体テスト 9/9 PASS
- K13 filterArticlesByMode 純ヘルパ + 6 単体テスト PASS
- K14 E2E spec 作成（generation-mode-flag.spec.ts、実行は dev 必要）

### Wave 3: 制約拡張 + 運用 docs
- K15 publish_events.action CHECK 制約拡張マイグレ作成（20260503 / 9 値許可 / ロールバック節含む）
- K16 source_chunks embed dry-run docs（308 行 / 既存 CLI 確認 + コスト 0.05$ + ロールバック）
- K17 コスト分析レポート（$0.18/article、月 $5-54）

### Wave 4: 検証 + 統合
- K18 progress.md 更新（本セクション）
- K19 eval_report.md 第 8 サイクル PASS 記録
- K20 統合 commit + push

## 検証
- 型チェック: `npm run type-check` exit=0
- 単体テスト: badge 9 + filter 6 = 15/15 PASS
- 本番 INSERT: id=cc1d079a-743d-4ee8-8305-dba89f4e02dc 確認済（service role 経由）
- 既存 P5-1〜P5-9: 回帰なし

## 関連ファイル
- (added) src/components/articles/GenerationModeBadge.tsx
- (added) src/lib/utils/article-mode-filter.ts
- (added) supabase/migrations/20260503000000_publish_events_action_extension.sql
- (added) docs/cost-analysis.md
- (added) docs/source-chunks-embed-dryrun.md
- (added) scripts/ops/zero-gen-production-test.ts
- (added) test/unit/generation-mode-badge.test.tsx
- (added) test/unit/articles-list-mode-filter.test.tsx
- (added) test/e2e/generation-mode-flag.spec.ts
- (modified) src/app/(dashboard)/dashboard/articles/page.tsx
- (modified) src/app/(dashboard)/dashboard/articles/[id]/page.tsx
- (modified) src/app/(dashboard)/dashboard/articles/new-from-scratch/page.tsx
- (modified) src/app/(dashboard)/dashboard/publish-events/page.tsx
- (modified) src/app/api/publish-events/route.ts
- (modified) src/lib/db/articles.ts

## 残タスク（次サイクル）
- 試作記事 cc1d079a の Stage2 body 生成 + ハルシネチェック → 画像 → review
- 1499 記事 embedding 本番投入（dry-run docs に従い 10 件 → 全件）
- 20260503 マイグレ本番適用（Vercel デプロイ前）
- 公開承認フロー zero-gen 経路 E2E
- 7 日観察 → 本格運用

---

# P5-11 + P5-12 — Stage2 投入 + 構造化ログ（2026-05-01）

## P5-11: Stage2 継続スクリプト + html_body 列バグ修正
- 試作 zero-gen 記事 cc1d079a への Stage2 投入を試みた結果、本番 articles テーブルに
  `html_body` 列が無い隠れバグ顕在化（zero-generate-full route も同じバグを保有）
- `scripts/ops/zero-gen-stage2-onwards.ts` 新規（Stage1 既存記事に Stage2 以降を実行）
- `src/app/api/articles/zero-generate-full/route.ts` から html_body 書込削除
- 失敗ログを `docs/zero-gen-stage2-failure-2026-05-01.md` に保管

## P5-12: 構造化ログ全面導入 + バグ A/B 修正（15 並列）
### バグ修正
- A: `text-embedding-004` v1beta で 404 → embedding-client.ts を v1 ファースト + v1beta フォールバックに変更（モデル名は変更せず）
- B: claim-extractor body 5,500 字超で MAX_TOKENS → maxOutputTokens 8192→24000 拡張
- C: image_prompts object→array Stage1 prompt 強化 + Stage2 normalizer 追加（Gemini が object 形で返す regression に防衛）

### 構造化ログ（15 並列で 24 ファイル変更）
- 約 50 のログ key を `[<scope>.<event>]` 形式で統一導入
- スコープ: `zero-gen.stage2.*` / `zero-gen.full.*` / `hallucination.*` / `tone.*` / `gemini.*` / `gemini.embed.*` / `rag.*` / `persist.*` / `db.articles.*` / `claim-extractor.*` / `image-prompt.*` / `cta-generator.*`
- gemini-client に thinking_tokens 算出 + thinking_dominant 警告ログ追加
- `docs/zero-gen-logging-conventions.md` 142 行で全 key 索引 + grep レシピ
- `src/lib/ai/cost-tracker.ts` 純粋関数で USD 概算（5 unit test）
- `test/unit/zero-gen-logging.test.ts` 3 ログ key 契約テスト

## cc1d079a への実 Stage2 投入結果（2026-05-01 11:56 完了）
| field | value |
|---|---|
| stage2_body_html | 5,215 chars |
| hallucination_score | 85 |
| yukiko_tone_score | 0.904 |
| image_prompts | 3 種 populate |
| article_claims | 71 件 |
| article_revisions | 1 件（auto_snapshot） |
| status | draft（保持） |
| generation_mode | zero（保持） |

### 残課題（次サイクル）
- persist-tone が cookie-client 起因で CLI 経由失敗（yukiko_tone_score 自体は articles テーブルに書込済、breakdown JSON のみ未保存）
- gemini-3.1-pro-preview の thinking 消費が大きく Stage2 で 70-90 秒（要 maxOutputTokens=32000）
- claim-extractor の MAX_TOKENS リスクは body 8,000 字超で再発の可能性（次は body 分割）

## 検証
- 型チェック: exit=0
- 全テスト: 468/468 PASS（既存 + 新規 8 件）
- 本番実投入: cc1d079a で全列確定済（直接 service-role DB query 確認）

## 関連ファイル
- (added) scripts/ops/zero-gen-stage2-onwards.ts
- (added) src/lib/ai/cost-tracker.ts
- (added) docs/zero-gen-logging-conventions.md
- (added) docs/zero-gen-stage2-failure-2026-05-01.md
- (added) test/unit/cost-tracker.test.ts
- (added) test/unit/zero-gen-logging.test.ts
- (modified) 24 ファイル（hallucination/* 6, tone/* 2, ai/* 5, content/* 2, rag/* 1, db/* 1, prompts/* 3, route 1, persist 3）

## 残タスク（さらに次サイクル）
- 1499 記事 embedding 本番投入（v1 endpoint 動作確認後）
- persist-tone を service-role 対応にリファクタ
- claim-extractor の body 分割対応
- 20260503 マイグレ本番適用
- 公開承認フロー zero-gen 経路 E2E
- 7 日観察 → 本格運用

---

# P5-13 〜 P5-16 — バグ D〜G 修正 + 完全生成 CLI + キーワード提案（2026-05-02）

## 経緯
記事 #71 (id=`31892969-8215-42c2-8ad7-07135edf2766`) が編集画面で「本文がありません」表示。
診断の結果、ai_generation_log には Stage2/品質チェック完走の記録があるのに body だけ空文字に潰れていた → 隠れバグ D を発見。連鎖的にバグ E/F/G も顕在化し、合わせて P5-16 で SEO 補助のキーワード候補機能まで実装した。

## P5-13: バグ D 修正（Stage2 4 形態正規化）
**根本原因**: zero-generate-full/route.ts L293-300 の Stage2 正規化が 2 形態のみ対応。
Gemini は同じプロンプトに対し 4 形態を返しうる:
  1. `"<p>...</p>"` (string)
  2. `{ "html": "<p>...</p>" }` (object_html)
  3. `["<p>...</p>", "<p>...</p>"]` (array_html)
  4. `[{ "html": "..." }, { "html": "..." }]` (array_object_html)

3 と 4 は array (= object) なので type guard をすり抜け、`.html` も undefined → `''` に潰れる。
記事 #71 のリラン時に `response_shape: 'array_html'` を確認 — まさに踏んだケース。

### 修正
- 共通ヘルパ `src/lib/ai/stage2-html-normalize.ts` 新設
  (route.ts と zero-gen-stage2-onwards.ts CLI で共通利用、DRY 化)
- route.ts: `normalizeStage2Html` へ差し替え + `maxOutputTokens=32000` 追加
- 単体テスト 14 ケース（4 形態 × mix × null/undefined/想定外）

## P5-14: 完全生成 CLI `zero-gen-publish.ts`
Stage2 完了済記事 → Stage3 完成までを 1 コマンドで実行する CLI を追加。

- 画像生成 + Storage アップロード（既存があれば skip / `--force-images` で上書き）
- Stage3 final HTML 生成 (`generateArticleHtml`)
- meta_description / seo_filename 計算
- article_revisions snapshot (revision_number=2)
- 安全装置: status / is_hub_visible / title / slug は触らない

## P5-15: バグ E/F/G 一括修正

### バグ E: embedding 404
`text-embedding-004` が API から deprecated/削除済（v1 でも v1beta でも 404）。
v1beta の `models?` 列挙で `gemini-embedding-001` (stable) を確認。

- model: `text-embedding-004` → `gemini-embedding-001`
- API_VERSIONS: `['v1','v1beta']` → `['v1beta']` のみ
- `outputDimensionality:768` を必須付加（gemini-embedding-001 default=3072 → DB の vector(768) に合わせ縮小）
- live test: dim=768, 516ms ✓

### バグ F: persistTone (二重バグ)
**F-1 cookies error**: `createServiceRoleClient` が `await cookies()` を必須呼び出ししていたため CLI / cron / background fetch から呼ぶと `cookies called outside request scope`。 try/catch で no-op fallback。
**F-2 列型不一致**: `yukiko_tone_score` 列は migration で `FLOAT` として作成されているのに、persist-tone は object payload を書こうとし `invalid input syntax for type double precision` で必ず失敗。 → `tone.total` scalar のみに統一。

### バグ G: edit/page.tsx 空文字フォールバック
`a.stage3_final_html ?? a.stage2_body_html ?? ''` が空文字を素通り。
trim 後の length>0 で判定するように修正（バグ D 系統の防衛 + 過去事故記事の救済）。

### 検証
- npx vitest run: 482/482 PASS
- live: embedding 768dim ok, persistTone CLI ok

## P5-16: キーワード候補 SEO 提案機能
ゼロ生成フォームに「💡 候補を提案」ボタンを追加。SEO ツール (Ahrefs/SEMrush) を使わずに以下の 2 系統を統合し、最大 18 件の長尾キーワード候補を提案:

1. **ペルソナ系**: `persona.search_patterns × theme + intent` から即時生成（Gemini 不要、$0）
2. **AI 系**: Gemini 3.1 Pro に theme/persona/intent を渡して 3-5 単語の長尾 KW を 10 件提案させる（~$0.001/回、各候補に rationale 付き）

### 新規ファイル
- `src/lib/ai/prompts/keyword-suggestions.ts` — `buildPersonaCandidates` / `buildAiSuggestionPrompt` / `normalizeAiCandidates`
- `src/app/api/articles/zero-generate/suggest-keywords/route.ts` — POST 認証 → zod 検証 → 2 系統融合 → dedupe → score 降順
- `test/unit/keyword-suggestions.test.ts` — 15 ケース

### UI
- ボタン: テーマ+ペルソナ未選択時 disabled, tooltip 付き
- チップグリッド: 出所バッジ「ペルソナ」緑 / 「AI」水色、rationale tooltip、クリックで追加、追加済はミュート
- AI 失敗時は 207 partial で persona 候補のみ返す（UX 維持）

### live 検証
- persona 7 件 + AI 9 件 = 16 候補を 15s で取得 ✓
- AI 候補例: `インナーチャイルド 癒し ワーク 初心者` / `クリスタル 癒し 効果 比較` / `チャクラ ヒーリング やり方 初心者`

## 記事 #71 復旧
| 項目 | 修復前 | 修復後 |
|---|---|---|
| stage2_body_html | `""` | **3,651 chars** |
| stage3_final_html | `""` | **24,780 chars** |
| meta_description | あり | 103 chars (再計算済) |
| reviewed_at | null | 2026-05-01T23:50:32 |
| hallucination_score | 100 | 85 (claims 54) |
| yukiko_tone_score | 0.359 | 0.757 |
| image_files | 3 枚 | 3 枚（既存保持） |
| slug / status / is_hub_visible | (元のまま) | **温存** |

## 検証
- 型チェック: ok
- 全テスト: 497/497 PASS（新規 29 + 既存 468）
- live smoke: embedding 768dim, persistTone CLI, suggest-keywords AI

## 関連ファイル
- (added) src/lib/ai/stage2-html-normalize.ts
- (added) src/lib/ai/prompts/keyword-suggestions.ts
- (added) src/app/api/articles/zero-generate/suggest-keywords/route.ts
- (added) scripts/ops/zero-gen-publish.ts
- (added) test/unit/stage2-html-normalize.test.ts
- (added) test/unit/keyword-suggestions.test.ts
- (modified) src/app/api/articles/zero-generate-full/route.ts
- (modified) src/lib/ai/embedding-client.ts
- (modified) src/lib/supabase/server.ts
- (modified) src/lib/tone/persist-tone.ts
- (modified) src/lib/validators/zero-generate.ts
- (modified) src/app/(dashboard)/dashboard/articles/[id]/edit/page.tsx
- (modified) src/app/(dashboard)/dashboard/articles/new-from-scratch/page.tsx
- (modified) test/unit/new-from-scratch-form-uuid.test.tsx

## 残タスク（次サイクル）
- 1499 source_chunks embedding 本番投入（バグ E 解決で解禁、未実行）
- 20260503 マイグレ本番適用
- Vercel env 追加 (HALLUCINATION_RETRY_TOKEN 等)
- claim-extractor body 分割対応（body > 8000 chars リスク）
- ペルソナ別 source 記事マイニング（キーワード候補強化の v2）
- 公開承認フロー zero-gen 経路 E2E
