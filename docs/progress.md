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
