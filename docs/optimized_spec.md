# Optimized Spec — Harmony Column Generator（全ドメイン統合版）

**Version:** v2.1 (2026-05-06 / Change Request 反映)
**Status:** v2.0 で提示した要決定 6 件をユーザー判断で確定（§13 参照）。データモデル整合性 27 矛盾点を §2 に統合。Step 2/3 移行を本サイクルの実装スコープに含める。

> このファイルは Planner と Change Request だけが書き込み可能。Generator・Evaluator は読み取り専用。
> 旧 v1（P5 Zero-Generation 特化版、4/30 時点）の構成を踏襲しつつ、横断ドメイン（公開制御・運用基盤）を追補。

---

## 0. ドキュメントの位置づけ

- **対象:** `Harmony Column Generator`（Next.js 14 + Supabase + Gemini 3.1 Pro + Banana Pro + Vercel）
- **目的:** スピリチュアルカウンセラー小林由起子さんの 1,499 件のアメブロ過去記事を元に、視点を変換したオリジナルコラムを自動生成する
- **本仕様書のスコープ:** ゼロ生成 / 公開制御 / 品質 QA / コンテンツ生成 / 運用基盤 の **5 ドメイン横断**
- **継承元:** プロジェクト `CLAUDE.md` + グローバル `~/.claude/CLAUDE.md`（5エージェント・クローズドループ・パイプラインに準拠）

### 0.1 実装状況サマリ（5 ドメイン）

| ドメイン | 実装状況 | 残課題 | 重大度 |
|:---|:---:|:---|:---:|
| ゼロ生成パイプライン | ✅ 本番稼働（397/397 テストPASS） | finalizing stuck監視UI、status遷移 draft→editing 確認 | 中 |
| 公開制御・Hub・FTP | 🟠 Step1 完了、Step2/3 を本サイクルで実装中 | reviewed_at readers 5箇所の visibility_state 置換 | 高 |
| 品質QA（ハルシネ/トーン/Vision） | 🟡 部分実装 | WRITING_STYLE 30項目の 60% 未実装、auto-fix API 未実装、claim_type 6値確定 | 高 |
| コンテンツ生成 | ✅ 矛盾解消 | CTA **2 回確定**（cta1_intro 廃止）、SEO settings UI 動作確認 | 中 |
| 運用基盤 | 🟠 P0 修正待ち | article_revisions二重定義、generation_jobs RLS、cta_variants UNIQUE、FK不足 | 高 |

---

## 1. アーキテクチャ全景

### 1.1 ドメイン分割

```
src/lib/
  ai/              → Gemini クライアント・プロンプト
  zero-gen/        → Stage1〜3 + replaceImagePlaceholders + run-completion
  planner/         → プロット生成（既存パイプラインと共有）
  rag/             → 由起子記事 1499件 embedding 検索
  hallucination/   → claim抽出 + 4種validator + persist
  hallucination-retry/ → 定期再検証
  tone/            → 14項目スコアリング + centroid類似度 + persist
  image/           → vision-check.ts（has_text/has_logo/anatomy_ok/theme_alignment）
  validators/      → schema validation
  content/         → CTA generator + perspective transform + source analyzer
  generators/      → article-html-generator（apolloONEBlog 流用）
  seo/             → structured-data + meta-generator + score-calculator + seo-settings
  publish/         → auto-related + visibility helpers
  publish-control/ → state-machine + soft-withdrawal
  deploy/          → FTP デプロイ（書込のみ・削除なし）
  ftp/             → FTP クライアント
  html/            → HTML 検証・整形
  hub/             → hub-generator + hub-rebuild-trigger
  db/              → Supabase アクセス + article-revisions
  jobs/            → zero-gen-job-store
  queue/           → ジョブキュー API
  dangling-recovery/ → 60s timeout 検出と回復
  notify/          → Slack 通知
  logger.ts        → 構造化ログ
  config/          → public-urls 等の env 駆動設定
  storage/         → Supabase Storage（画像）

src/app/api/
  articles/zero-generate-async, zero-generate-full, zero-generate-batch, ...
  hub/, ftp/, publish-events/
  hallucination-retry/
  log/             → P5-69 新規（client console echo）
  queue/, dangling-recovery/, settings/, export/, source-articles/
  cta/, plans/, personas/, themes/
```

### 1.2 主要数値目標

- **生成時間:** P50 75s / P95 90s（並列化前提）
- **コスト:** 1 記事 ~$0.18（cache hit 後）/ 月 100 記事 ~$18
- **品質基準:** hallucination_score ≥ 70（critical=0必須）、yukiko_tone_score ≥ 0.80、centroid_similarity ≥ 0.85
- **記事文字数:** 約 2,000 文字
- **画像:** Banana Pro で 3 枚/記事（hero / body / summary）

---

## 2. データモデル

### 2.1 articles テーブル拡張列（P5-43 で追加・v2.1 確定版）

| 列 | 型 | DEFAULT | CHECK | 用途 |
|:---|:---|:---|:---|:---|
| `generation_mode` | TEXT | `'source'` | IN (`'zero'`,`'source'`) | 視点変換ゼロ生成 vs 既存記事書換 |
| `intent` | TEXT | NULL | NULL OR IN (`'info'`,`'empathy'`,`'solve'`,`'introspect'`) | 記事の意図 |
| `lead_summary` | TEXT | NULL | — | LLMO 用 100-150字 概要 |
| `citation_highlights` | JSONB | `'[]'` | — | 引用ハイライト 3 件 |
| `narrative_arc` | **JSONB** | NULL | — | 物語アーク（v2.1: TEXT→JSONB 訂正） |
| `emotion_curve` | JSONB | NULL | — | 感情曲線 |
| `hallucination_score` | FLOAT | NULL | — | 0-100 スコア |
| `yukiko_tone_score` | FLOAT | NULL | — | 0-1 スカラ |
| `readability_score` | FLOAT | NULL | — | 可読性スコア |
| `quality_overrides` | JSONB | `'[]'` | — | check_item_id ignore 配列 |
| `visibility_state` | TEXT | `'idle'` | IN (8値、§3.1) | ステータス機械 |
| `visibility_updated_at` | TIMESTAMPTZ | NULL | — | dangling 検出に使用 |

**実装注記:**
- TypeScript 型 `Article` / `ArticleRow` に上記 12 列を反映する（v2.0 時点で未反映、本サイクルで同期）
- ENUM 型ではなく `TEXT + CHECK` で実装。ENUM への migration は無し（運用上の柔軟性のため）

### 2.2 新規テーブル（v2.1 確定版）

| テーブル | 主用途 | 主要列 / CHECK |
|:---|:---|:---|
| `source_chunks` | RAG 検索ソース | embedding **vector(768)** + themes[] + spiritual_concepts[] + emotional_tone + content_hash |
| `article_claims` | ハルシネ検証結果 | sentence_idx, claim_type **(6値)**, risk **(4値含む critical)**, source_chunk_id (FK SET NULL), similarity_score, evidence(JSONB) |
| `yukiko_style_centroid` | 文体 centroid | embedding(768), is_active, sample_size, version (ISO timestamp) |
| `cta_variants` | CTA 配置 | position **CHECK (1,2,3)**, persona_id, stage, utm_content, **UNIQUE (article_id, position)** |
| `generation_jobs` | ジョブキュー | stage **(7値)** queued/stage1/stage2/hallucination/finalizing/done/failed, **progress NUMERIC 0-100**, eta_seconds, error, article_id |
| `article_revisions` | バージョン履歴 | revision_number, **html_snapshot**, change_type, changed_by, **comment(JSON pack: title/meta_description 等を内包)**（最新 3 件保持、v2.1 で二重定義統合） |
| `publish_events` | 公開操作監査 | action **(12値)** publish/unpublish/hub_rebuild/ripple_regen/batch-hide-source/batch-hide-source-sql/hallucination-retry/dangling-recovery/manual-edit/review_submit/review_approve/review_reject、actor_id, actor_email, **before_state, after_state** |

**v2.1 確定事項:**
- **claim_type 6 値**: `factual` / `attribution` / `spiritual` / `logical` / `experience` / `general`（人物体験談・一般論を別 type で分析）
- **risk 4 値**: `low` / `medium` / `high` / `critical`（TS 型 `RiskLevel` に critical 追加が必要）
- **CTA 2 回確定**: 仕様 §6.2 で詳述。SQL の position CHECK は (1,2,3) のまま保持（互換のため）、INSERT は position 2/3 のみ
- **progress 0-100 スケール**: NUMERIC で 0.0〜100.0、CHECK で範囲制限。UI でそのまま % 表示
- **publish_events.before_state/after_state 列追加**: 監査機能の完全性のため

### 2.3 RLS ポリシー（v2.1 整理）

| テーブル | RLS | ポリシー | 備考 |
|:---|:---:|:---|:---|
| articles | ✅ | authenticated (ALL) + public (is_hub_visible=true) | 公開記事のみ anon read |
| source_articles, source_chunks, article_claims, yukiko_style_centroid, cta_variants, publish_events, article_revisions | ✅ | authenticated (ALL) | 単一テナント前提 |
| personas, themes, settings, generation_logs, content_plans, generation_queue | ✅ | authenticated (ALL) | 同上 |
| **generation_jobs** | ✅ | **deny-all (FALSE)** | service_role のみアクセス。**v2.1 で明示的ポリシー追加** |

**実装注記:** `generation_jobs` は `ENABLE ROW LEVEL SECURITY` のみで明示的 POLICY が無いため、デフォルトで全アクセス拒否されている状態。Supabase の service_role は RLS をバイパスするため運用上は機能しているが、**監査明確化のため CREATE POLICY を追加**する。

### 2.4 データインテグリティ事項（v2.1 新設・本サイクル実装範囲）

| ID | 項目 | 修正内容 | 優先度 |
|:---:|:---|:---|:---:|
| D1 | article_revisions テーブル二重定義 | DROP CASCADE → 統合 migration で再定義（v2.1 で `20260506000000` 適用済） | ✅ 解消 |
| D2 | article_revisions スキーマ統一 | **コード `src/lib/db/article-revisions.ts` の `html_snapshot + comment(JSON)` 方式**に合わせて統合（title/meta_description は comment JSON 内に格納） | ✅ 解消 |
| D3 | generation_jobs RLS 明示ポリシー | `CREATE POLICY service_role_only ON generation_jobs USING (FALSE)` | P0 |
| D4 | cta_variants UNIQUE 制約 | `UNIQUE (article_id, position)` 追加 | P0 |
| D11 | content_plans.article_id FK | `FK + ON DELETE CASCADE` 追加 | P1 |
| D12 | generation_queue.article_id FK | 同上 | P1 |
| D13 | articles.source_article_id FK | `ON DELETE SET NULL` 追加 | P1 |
| D14 | article_claims article_id 単独 INDEX | 追加（複合のみだったため） | P1 |
| D15 | generation_jobs.updated_at TRIGGER | `BEFORE UPDATE` で `NOW()` 自動更新 | P1 |
| D16 | publish_events に before_state/after_state | ADD COLUMN（前後 state を記録） | P1 |
| D17 | article_claims.evidence 書込実装 | persist-claims.ts で evidence を構築・INSERT | P1 |
| D18 | article_claims.similarity_score 書込実装 | retrieve-chunks → persist-claims のハンドオフ | P1 |
| D19 | articles.stage1_image_prompts と image_prompts 共存解消 | 用途確認後どちらかに統一 | P2（将来） |
| D20 | articles.published_html 廃止 | article_revisions.html_snapshot に統合済 | P2（将来） |
| D22 | is_hub_visible ↔ visibility_state 同期 | TRIGGER または application 側で保証 | P1 |
| D24 | persist-claims DELETE→INSERT を transaction 化 | RPC 関数で atomic 化 | P1 |

### 2.5 マイグレーション一覧（v2.1 追加分含む）

```
（既存）
20260404000000_initial_schema.sql
20260404100000_add_theme_category.sql
20260404200000_content_planner.sql
20260405000000_add_usage_count.sql
20260407000000_add_quality_check.sql
20260415000000_add_reviewed_columns.sql
20260417000000_article_revisions.sql                   ※ 二重定義の片方
20260419000000_publish_control_v2.sql
20260425000000_publish_control_v2_rls_switch.sql
20260501000000_zero_generation_v1.sql
20260502000000_zero_generation_rpc.sql
20260502010000_quality_overrides.sql
20260502020000_generation_jobs.sql
20260502030000_generation_jobs_finalizing_stage.sql
20260503000000_publish_control_unification_step1.sql
20260503000000_publish_events_action_extension.sql
20260503000001_publish_events_review_actions.sql

（v2.1 で追加 — 本サイクル）
20260506000000_data_model_consolidation.sql            P0 修正一括（D1〜D4）
20260506000001_foreign_key_completeness.sql            P1 FK 追加（D11〜D13）
20260506000002_index_and_trigger.sql                   P1 INDEX/TRIGGER（D14, D15, D22）
20260506000003_publish_events_state_columns.sql        P1 before_state/after_state（D16）
20260506000004_progress_scale_migration.sql            progress 0-1 → 0-100 既存データ × 100
20260506000005_step2_visibility_state_migration.sql    Step2: reviewed_at readers 置換準備
```

---

## 3. 公開制御・Hub・FTP

### 3.1 visibility_state 8 値と遷移ルール

| 状態 | ハブ表示 | sitemap | FTP記事 | 意味 |
|:---|:---:|:---:|:---:|:---|
| `draft` | ✗ | ✗ | ✗ | 編集中（Step1で追加、フロー未実装） |
| `pending_review` | ✗ | ✗ | ✗ | レビュー待ち（Step1で追加、Step3で運用予定） |
| `idle` | ✗ | ✗ | ✗ | 承認済・デプロイ可能 |
| `deploying` | ✗ | ✗ | 進行中 | FTP アップロード中 |
| `live` | ◯ | ◯ | ◯ | 公開中（ハブ整合） |
| `live_hub_stale` | ◯ | ◯ | ◯ | 記事は公開、ハブ rebuild 失敗 |
| `unpublished` | ✗ | ✗ | noindex | ソフト撤回（FTP に noindex 上書き） |
| `failed` | ✗ | ✗ | 前回値 | デプロイ失敗 |

**公開判定の単一ルール（P5-43 Step1 適用済 → v2.1 で全 readers 統一）:**
```
applyPubliclyVisibleFilter() = visibility_state IN ('live', 'live_hub_stale')
```

**デプロイ可能ルール:**
```
isDeployable() = visibility_state IN ('idle', 'failed', 'live_hub_stale', 'unpublished')
```
- 拒否対象: `draft`, `pending_review`, `deploying`, `live`（既に公開中なので再 deploy 不要）

**実装参照:** `src/lib/publish-control/state-machine.ts`, `src/app/api/articles/[id]/visibility/route.ts:122-232`

### 3.1.1 Step2/3 移行（v2.1 本サイクル実装範囲）

旧 v2.0 では「別タスク」としていたが、ユーザー判断 ❻ で本サイクル実装に確定。

**Step 2: Readers 統一（reviewed_at → visibility_state ベース置換）**

| ファイル | 旧条件 | 新条件 |
|:---|:---|:---|
| `src/lib/hub/hub-generator.ts:431` | `reviewed_at IS NOT NULL` | `visibility_state IN ('live','live_hub_stale')` |
| `src/app/sitemap.ts:37` | 同上 | 同上 |
| `src/app/api/articles/route.ts` | 同上（リスト取得） | 同上 |
| `src/app/dashboard/articles/page.tsx` | bulk deploy フィルタ | `applyPubliclyVisibleFilter()` 経由 |
| `src/app/column/[slug]/page.tsx` | 個別ページ可視性 | `visibility_state` チェック |

**Step 3: Writers 整理（visibility API の reviewed_at 副作用削除）**

| API | 旧動作 | 新動作 |
|:---|:---|:---|
| `POST /api/articles/[id]/visibility` | visibility_state 変更時に `reviewed_at` も更新 | `reviewed_at` は audit-only（書き込まない） |
| `POST /api/articles/[id]/review`（新設） | — | `pending_review → idle (approve)` / `→ draft (reject)` |

**reviewed_at 列の扱い:**
- v2.1 では **削除しない**（audit log として保持）
- 将来 v2.2+ で別 audit テーブルに extract 後 DROP
- writers は audit 用途以外で書き込まない

**デグレ警戒（最高優先）:**
- 既存 45 件の記事で `reviewed_at IS NOT NULL` ⟺ `visibility_state IN ('live','live_hub_stale')` の parity を移行前後で検証
- parity スクリプト `scripts/verify-publish-state-parity.ts` を Step 2 直前と直後に実行

### 3.2 デプロイゲート（3 段階）

| ゲート | 検証内容 | 実装 |
|:---|:---|:---|
| Local 検証 | `status ∈ {editing, published}` AND `stage3_final_html` 非空 | `checkVisibilityGuard()` |
| Preview | `visibility_state` 即時遷移 | `/api/articles/[id]/visibility` |
| Production | `isDeployable()` 通過時のみ FTP 書込 | ハードゲート |

### 3.3 ソフト撤回フロー（unpublished）

- **削除ではなく上書き**: noindex meta タグ入りの notice HTML を FTP に上書き配置
- **FTP レイヤに削除呼出は 1 箇所もない**（grep で確認済み・絶対ルール）
- 通知欄を上書き（ユーザーへのメッセージ）
- **実装:** `src/lib/publish-control/soft-withdrawal.ts`
- **環境フラグ:** `PUBLISH_CONTROL_FTP=on`（デフォルト未設定 → 動作要確認）

### 3.4 Hub の zero-gen 限定化（P5-55）

**フィルタ:** `hub-generator.ts:427-433`
```ts
if (process.env.NEXT_PUBLIC_HUB_INCLUDE_REWRITES !== 'on') {
  visibleQuery = visibleQuery.eq('generation_mode', 'zero');
}
```
- デフォルト: zero 記事のみ Hub 表示
- 緊急脱出: `NEXT_PUBLIC_HUB_INCLUDE_REWRITES=on` で旧挙動復帰
- **関連記事も同モード限定**（P5-59、cross-mode 禁止）

### 3.5 環境変数（URL 駆動・P5-44）

```
NEXT_PUBLIC_SITE_URL = https://harmony-mc.com
NEXT_PUBLIC_HUB_PATH = /spiritual/column
FTP_REMOTE_PATH       = /spiritual/column/
```
- 整合性チェック: `src/lib/config/public-urls.ts::assertConsistency()`
- **絶対ルール:** ハードコード禁止（CLAUDE.md §2 と整合）

### 3.6 受け入れ基準（Playwright 検証可能）

| AC ID | 内容 | セレクタ / クエリ |
|:---|:---|:---|
| PC-01 | `live` 状態の記事のみ Hub 表示 | `.entry[data-slug]` の data-slug が visibility_state='live'/'live_hub_stale' のものに一致 |
| PC-02 | `unpublished` 時 noindex 出力 | `curl /spiritual/column/{slug}/index.html | grep 'content="noindex'` |
| PC-03 | `pending_review` は Hub 不出現 | `.entry[data-slug]` 不在 |
| PC-04 | badge 統一 | zero=「新規」(green), source=「書換」(gray), pending_review=「確認待ち」(yellow) |
| PC-05 | article_revisions 増加 | 編集 1 回ごとに `SELECT count(*) FROM article_revisions WHERE article_id={id}` が +1（最大 3） |

---

## 4. ゼロ生成パイプライン

### 4.1 ステージと状態遷移

```
queued → stage1 → stage2 → hallucination → finalizing → done
                                      └──→ failed（任意ステージから）
```

**generation_jobs.stage 遷移:** 5-7 段階（P5-67 で `finalizing` 追加）
- 旧仕様 §3 では「Stage3 = HTML 生成のみ」だが、現状は **finalizing で画像生成 + Stage3 HTML 組立 + meta 生成 + placeholder 置換** を統合実行（実装に合わせて仕様更新）

**articles.status 遷移:**
- 生成完了時: `draft` → `editing`（validation 通過時のみ・P5-36 設計）
- ⚠️ **要確認:** P5-36 status 遷移の実装確認が未済（Evaluator マター）

### 4.2 入出力契約

#### POST `/api/articles/zero-generate-async`（非同期単一）
```
Request:  { theme_id, persona_id, keywords[], intent, target_length }
Response: { job_id: UUID, status: 'queued' }
SSE:      GET /api/articles/zero-generate/{job_id}/progress
          → { stage, progress(%), eta_seconds, article_id? }
```

#### POST `/api/articles/zero-generate-full`（同期フル）
```
maxDuration: 300s
Response: 201（全成功）/ 207（部分成功）/ 400/401/502/500
{ article_id, partial_success, scores, stages, error? }
```

#### POST `/api/articles/zero-generate-batch`（最大10件）
```
Request:  { jobs: [...max10] }
Response: { batch_id, jobs: [{index, job_id, status:'queued'}, ...] }
並列度: 3 固定（Vercel + Gemini レート考慮）
```

### 4.3 finalizing ステージの責務（旧 spec 未記載・追加）

```
1. outline.image_prompts → articles.image_prompts 正規化コピー
2. 3 枚実画像生成（Banana Pro via Gemini Image Model）
3. Supabase Storage upload → articles.image_files に URL 記録
4. meta_description / seo_filename 計算
5. Stage3 final HTML 生成（generateArticleHtml）
6. image placeholder 置換（replaceImagePlaceholders、§5.5 参照）
7. articles UPDATE（revision_number=2 snapshot 保存）
```

**stuck timeout:** 5 分以上同一ステージ滞留で auto-fail（P5-67/70）
**観測ログ:** logger.error で `category=ai, action=zero_gen_stuck, article_id` を必ず emit

### 4.4 Stage1〜2 入出力スキーマ

- **Stage1 (outline):** `zeroOutlineOutputSchema`
  - lead_summary, narrative_arc, emotion_curve, h2_chapters, citation_highlights, faq_items, image_prompts(3枚分)
  - Temperature: 0.5, topP=0.9（決定的）
- **RAG 検索:** cosine similarity ≥ 0.75、top-5 MMR 多様化、`insufficient_grounding` 警告で空でも継続
- **Stage2 (writing):** outline + RAG + 由起子 14項目FB → HTML body
  - Temperature: 0.7, presencePenalty=0.3
  - **必須出口ガード:** body 100 文字未満は INSERT 禁止（P5-69、silent failure 防止）

### 4.5 並列検証（Stage2 後・Promise.all）

1. Claim 抽出 → 4 validator → article_claims に persist（§5）
2. 由起子トーン → centroid 類似度 → articles.yukiko_tone_score に persist

### 4.6 受け入れ基準

| AC ID | 内容 |
|:---|:---|
| ZG-01 | テーマ「グリーフケア」+ ペルソナ「喪失悲嘆を抱える人」+ keywords + intent=empathy で生成 → 5 分以内に done |
| ZG-02 | generation_jobs の stage が queued→stage1→stage2→hallucination→finalizing→done に推移 |
| ZG-03 | 生成記事が `generation_mode='zero'`、status='draft'（または 'editing'） |
| ZG-04 | hallucination_score, yukiko_tone_score, readability_score が float で記録 |
| ZG-05 | article_claims に 4 種 claim_type 全て記録（factual/attribution/spiritual/logical） |
| ZG-06 | cta_variants が 3 行（position 1/2/3）— ⚠️ 現実装は 2 行（§6.2 矛盾参照） |
| ZG-07 | 100文字未満の body で INSERT 拒否される（silent done 防止） |
| ZG-08 | 5 分 stuck で auto-fail され logger.error が emit |

---

## 5. 品質 QA

### 5.1 ハルシネーション検出

#### 6 分類 validator（v2.1 確定）
| claim_type | 検証方法 | Temperature | 用途 |
|:---|:---|:---:|:---|
| `factual` | RAG `source_chunks` cosine 照合 | 0.1 | 数値・固有名詞・事実主張 |
| `attribution` | URL/人名 → knowledge base 照合 | 0.1 | 引用・出典の正確性 |
| `spiritual` | NG 辞書 + Gemini 文脈判定 | 0.1 | スピリチュアル断定の禁止 |
| `logical` | 隣接文ペア → 矛盾 LLM judge | 0.1 | 文脈整合・矛盾検出 |
| `experience` | 由起子個人体験談（claim ではないが分類保持） | 0.1 | 「カウンセリング中で」等の体験記述 |
| `general` | 一般論・自明な記述 | 0.1 | risk=low 固定で persist スキップ可 |

**v2.1 注記:** 旧 v2.0 で「4 分類」としたのは spec 起草段階の値。実装は当初から 6 値で動作中（`experience`/`general` を分析容量として保持）。仕様を実装側に合わせて確定。

#### TS 型定義（v2.1 で同期）
```ts
// src/types/hallucination.ts
export type ClaimType = 'factual' | 'attribution' | 'spiritual' | 'logical' | 'experience' | 'general';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'; // v2.1: critical 追加
```

#### スコア計算
```
score = 100 - Σ(risk_weight)
risk_weight = { none:0, low:3, medium:7, high:15, critical:25 }
```
- 公開ゲート: `critical >= 1` で `is_hub_visible=false`
- 受容: score ≥ 70 推奨

#### Persist（v2.1 で transaction 化）
- `article_claims` に DELETE → INSERT を **RPC 関数で atomic 化**（D24 修正）
- UNIQUE: `(article_id, sentence_idx, claim_type)`
- **evidence**: source_chunk_id + similarity_score + raw_excerpt の構造化 JSONB（D17 修正）
- **similarity_score**: retrieve-chunks の cosine 値を直接保存（D18 修正）
- 失敗時: API ハンドラで 500 返却（silent skip 禁止）

#### Retry 機構
- `is_hub_visible=false && risk='critical'` の記事を定期再検証
- 実装: `src/lib/hallucination-retry/retry.ts`

### 5.2 由起子トーン

#### 14 項目スコアリング（重み付け平均、合格 ≥ 0.80）
| # | 項目 | 実装 |
|:---:|:---|:---:|
| 1 | 視点変換度（「でも実は」「けれど」） | ✅ |
| 2 | ダブルポスト回避 | ⚠️ stub（常に 1） |
| 3 | 抽象度逆スコア（「たとえば」「カウンセリング中で」） | ✅ |
| 4 | 深い納得度（「なんです」「ありませんか」） | ✅ |
| 5 | 語尾優しさ（断定比率 <20%） | ✅ |
| 6 | 比喩オリジナリティ（クリシェ辞書非該当） | ✅ |
| 7 | ひらがな化率 | 🟡 計測のみ・置換マップ未実装 |
| 8 | 短短長リズム | ✅ |
| 9-10 | **必須通過**: ""非使用、スピ断定回避（ブロッカー） | ✅ |
| 11-14 | CTA 自然挿入、絵文字抑制、CTA-URL 提示、禁止フレーズ | ✅ |

#### Centroid 類似度
- 記事本文 → embedding（RETRIEVAL_DOCUMENT）→ 由起子 centroid との cosine
- **合格閾値:** `CENTROID_SIMILARITY_THRESHOLD = 0.85`
- **fallback:** embedding timeout 時 similarity=0、tone のみで判定（⚠️ silent fallback、UI 警告必要）

#### 合否判定
```
passed = tone.passed && centroidSimilarity >= 0.85
```

#### Persist
- `articles.yukiko_tone_score` (FLOAT) に `tone.total` スカラ値のみ UPDATE

#### ⚠️ WRITING_STYLE_SPEC 30項目との乖離
- 実装は WRITING_STYLE_SPEC R01-R30 のうち約 **40% のみ**
- 未実装: 改行・余白、文末バリエーション詳細、「しかし」禁止検出、ダッシュ「——」検出、「……」多用検出、結びパターン詳細
- **要決定:** 完全実装するか、現状の 14 項目を仕様として確定するか（§13）

### 5.3 Vision 画像チェック

| 項目 | 配点 | 内容 |
|:---|:---:|:---|
| `has_text=false` | 30 | 画像内テキスト無し |
| `has_logo=false` | 20 | ロゴ・透かし無し |
| `anatomy_ok=true` | 20 | 解剖学的正確性 |
| `theme_alignment` | 0-30 | テーマ整合性スコア |

- **合格閾値:** score ≥ 70（`FLAG_THRESHOLD`）
- **失敗時:** `flagged=true` で再生成推奨
- ⚠️ Vision API timeout は silent fallback 中 → UI 警告必須

### 5.4 受け入れ基準

| AC ID | 内容 |
|:---|:---|
| QA-01 | 既知の偽陽性記事で score < 0.15 |
| QA-02 | critical claim 1件以上で `is_hub_visible=false` |
| QA-03 | 由起子記事 sample 10 件で tone.total ≥ 0.85 |
| QA-04 | NG 画像で flagged=true & score<70、OK 画像で flagged=false |
| QA-05 | 編集画面で hallucination_score / yukiko_tone_score / vision_flagged が可視化 |
| QA-06 | persist 失敗時に 500 を返す（silent skip 禁止） |

---

## 6. コンテンツ生成（HTML / CTA / 関連記事 / SEO）

### 6.1 HTML 生成のメインパス

- **メイン関数:** `src/lib/generators/article-html-generator.ts::generateArticleHtml()`
- **CTA 挿入:** `insertCtasIntoHtml()`
- **画像 placeholder 置換:** `src/lib/zero-gen/replace-placeholders.ts::replaceImagePlaceholders()`（§7 参照）
- **SEO:** `src/lib/seo/{structured-data,meta-generator,seo-settings}.ts`

#### スモーク必須項目（HTML 生成後の self-test）
| 項目 | 期待値 |
|:---|:---|
| `<main>` | 1個 |
| `<footer>` | 1個 |
| `<!--<img` | 0個（コメント化された img タグ無し） |
| `<!DOCTYPE html>` 混入 | 0個 |

### 6.2 CTA 配置（v2.1 確定 — 2 回）

#### 仕様（v2.1 確定）
- **2 回配置:** `cta2_mid`（本論中盤後）/ `cta3_end`（まとめ内）
- 誘導先: `https://harmony-booking.web.app/`
- UTM: 各 CTA 固有 utm_content
- **`cta1_intro` は廃止**（冒頭 CTA は読者没入を妨げる、由起子 FB「ダブルポスト回避」と整合）

#### 実装参照
- `src/lib/content/cta-generator.ts::insertCtasIntoHtml()`（行 271-272 で cta2/cta3 のみ挿入）
- DB 側は `cta_variants.position CHECK (1,2,3)` を保持（互換のため）、INSERT は position 2/3 のみ

#### v2.1 確定事項
- 旧 SPECIFICATION.md §9.1 の「3 回配置必須」は廃止
- cta_variants テーブルに **UNIQUE (article_id, position)** を追加（D4 修正）
- 既存 32 zero 記事は cta_variants 2 行で確定（再 INSERT は不要）

### 6.3 関連記事フィルタ（P5-59・実装済 ✅）

- **同一 generation_mode のみ**（zero ↔ source/null 跨ぎ禁止）
- 候補が 3 件未満 → `related_articles=[]` で保存
- 実装: `src/lib/publish/auto-related.ts:82-87, 157-160`
- **デグレ警戒:** `selectRelatedArticles()` 関数内部に generation_mode 知識なし → 呼出元で必ず事前フィルタする規約を維持

### 6.4 SEO・構造化データ・LLMO

- **設定ソース:** `settings` テーブル `key='seo'` JSONB
- **ローダ:** `src/lib/seo/seo-settings.ts::getSeoSettings()`
- **デフォルト:** `DEFAULT_SEO_SETTINGS`（旧ハードコード値を移植）
- **ジェネレータ:** `generateArticleSchema(settings)`, `generateMetaTitle()`, `generateMetaDescription()`
- **メタ字数:** title 28-35字、description 80-120字
- **LLMO:** lead_summary 100-150字、citation_highlights 3件
- ⚠️ **設定 UI 死にコード化疑い:** ダッシュボード SEO タブの保存先確認必要

### 6.5 受け入れ基準

| AC ID | 内容 |
|:---|:---|
| CG-01 | 1 記事の HTML に `[href*="harmony-booking.web.app"]` が **2 個**（v2.1 確定） |
| CG-02 | `data-cta-key` が `cta2` / `cta3` で各 1 個 |
| CG-03 | 関連記事リンクの href 全部が同じ generation_mode の記事を指す |
| CG-04 | スモーク: `<main>=1`, `<footer>=1`, `<!--<img =0`, `<!DOCTYPE>=1` |
| CG-05 | JSON-LD: Article schema に headline/url/datePublished/author/publisher が存在 |
| CG-06 | metaTitle 28-35字、metaDescription 80-120字 |

---

## 7. 画像 placeholder（Phase 1/2/3 Fallback）

### 7.1 placeholder 形式（P5-57 教訓で固定化）

**唯一の正規形式:**
```
[IMG_HERO]
[IMG_BODY]
[IMG_SUMMARY]
```
- AI prompt 側に「必ずこの形式で出力」と指示（破られる前提で post-validate）
- 過去 fallback された旧形式（`<!--IMAGE:position-->`, `<p>IMAGE:...</p>`）も互換的に検出するが、**新規生成は新形式のみ**

### 7.2 3-Phase Fallback（`replace-placeholders.ts:88-198`）

| Phase | 検出対象 | 戦略 |
|:---|:---|:---|
| Phase 1 | 位置名付き正規 placeholder | 直接 cheerio で `<img>` 置換 |
| Phase 2 | 順序割当（hero=0, body=1, summary=2） | 残存 placeholder を順番に充当 |
| Phase 3 | 残存検出（warning） | logger.warn で `placeholder_mismatch` を emit、residual と residualFull を分離出力 |

### 7.3 絶対ルール（CLAUDE.md§2 アンチパターンと整合）

1. **HTML を `string.replace(regex)` で操作禁止** → 必ず cheerio/htmlparser2
2. **`[\s\S]*?` 貪欲マッチ禁止** → 段落跨ぎで本文消失（P5-49, P5-57 事例）
3. **`{1,200}` 等の数値範囲 fallback regex 禁止** → P5-55 事例（本文200字消失）
4. **closing tag 巻込 regex 禁止** → P5-57 事例（`-->` 消失）
5. **AI 出力を信用するな** → 必ず post-validate

### 7.4 受け入れ基準

| AC ID | 内容 |
|:---|:---|
| IMG-01 | 生成 HTML に `[IMG_HERO]`, `[IMG_BODY]`, `[IMG_SUMMARY]` が残存しない |
| IMG-02 | 3 つの `<img>` タグが `src=` 付きで存在 |
| IMG-03 | Phase 3 残存検出ログが出ない（正常パス） |
| IMG-04 | Phase 3 で残存検出時、UI badge「画像プレースホルダ残存」が表示 |

---

## 8. 運用基盤

### 8.1 Supabase クライアント

- **anon クライアント:** ブラウザ・公開記事閲覧
- **service_role クライアント:** バックエンド（生成・delete・update）
- **RLS:** 全テーブル authenticated 一括許可（generation_jobs のみ deny-all）

### 8.2 ジョブキュー

- DB テーブル: `generation_jobs`
- ステージ遷移: §4.1 の通り
- 実装: `src/lib/jobs/zero-gen-job-store.ts`
  - createJobState / updateJobState / getJobState（60s TTL in-memory cache 併用）
  - markJobDone / markJobFailed
- API: `GET /api/queue`（一覧）, `GET /api/articles/zero-generate/{job_id}/progress`（SSE）

### 8.3 dangling-recovery（60s timeout 検出と回復）

```
visibility_state='deploying' AND visibility_updated_at < now - 60s
  → visibility_state='failed' に更新
  → publish_events に action='dangling-recovery' で監査 INSERT
```
- 実装: `src/lib/dangling-recovery/recover.ts`
- API: `POST /api/dangling-recovery`（maxDuration=60s, Bearer token 認可）
- **要追加:** `generation_jobs.stage='finalizing'` の stuck 検出（5分超）も同枠で扱うか別途 cron 化

### 8.4 logger.ts と /api/log

- **構造化ログ:** JSON emit、level (ERROR/WARN/INFO/DEBUG) + category (api/ai/auth/db/system/generator/deploy/ftp/related-articles/export/utility)
- **非同期計測:** `logger.timed<T>()` で elapsed_ms 自動
- **出力先:** console.error/warn/log/debug → Vercel runtime stdout
- **`/api/log`:** P5-69 新規。ブラウザ console イベントを server-side logger に echo
  - POST のみ（GET/PUT は 405）
  - Rate limit: IP ベース 100 events/分
  - Payload: `{ category, action, level, details? }`
  - ⚠️ 永続化（DB 保存）は未実装。Vercel logs CLI でのみ確認可能

### 8.5 article_revisions（バージョン履歴 3 件保持）

- **実装:** `src/lib/db/article-revisions.ts::saveRevision()`
- **3 件超で最古を自動削除**
- **必須呼出箇所:**
  - `src/lib/zero-gen/run-completion.ts`（zero-gen 完了時）
  - `src/app/api/articles/[id]/regenerate-segment/route.ts`（再生成時）
  - PUT `/api/articles/[id]` 直前（⚠️ 要確認）
  - バッチ操作（batch-add-cta, batch-add-toc, batch-add-highlights）（⚠️ 要確認）
- **API:** `GET /api/articles/[id]/revisions`, `POST .../[revisionId]/restore`
- **絶対ルール（memory）:** HTML 書換処理は必ず article_revisions に履歴 INSERT してから本体 UPDATE

### 8.6 通知（Slack）

- 実装: `src/lib/notify/`
- トリガー: dangling-recovery、デプロイ失敗、critical claim 検出 等

### 8.7 受け入れ基準

| AC ID | 内容 |
|:---|:---|
| OPS-01 | `supabase migration list` で全マイグレーション applied、CI で diff 0 |
| OPS-02 | RLS テスト: anon が article_claims/source_chunks を read/write できない |
| OPS-03 | 編集 1 回ごとに article_revisions に 1 行 INSERT、4 件目以降は最古削除 |
| OPS-04 | logger.error が Vercel logs CLI で確認可能 |
| OPS-05 | dangling-recovery が 60s timeout 検出で自動 failed 遷移 |
| OPS-06 | /api/log の rate limit が 101 req/分目で 429 返却 |

---

## 9. UI/UX

### 9.1 主要画面

| パス | 用途 | 主要要素 |
|:---|:---|:---|
| `/dashboard/articles/new-from-scratch` | 単一ゼロ生成 | 左60%フォーム + 右40%ライブプレビュー |
| `/dashboard/articles/batch-zero-generate` | バッチ最大10件 | 入力テーブル + クイックテンプレ + コスト見積 |
| `/dashboard/articles` | 一覧 | badge（新規/書換/確認待ち）+ visibility_state 列 |
| `/dashboard/publish-events` | 公開操作監査 | publish_events 一覧 + dangling-recovery 履歴 |
| `/column/{slug}` | 公開記事 | visibility ∈ {live, live_hub_stale} のみ表示 |

### 9.2 グローバル要素

- **GenerationProgressBanner:** stage1→stage2→hallucination→finalizing→done を脈動アニメーション + 経過秒/推定残り秒
- **Score badge:** hallucination_score / yukiko_tone_score / readability_score を色分け（critical:赤, high:橙, medium:黄, low:灰）
- **Quality 結果ペイン:** claim list（各 claim ごと type+risk badge）+ 該当文ハイライト + 修正案ボタン
- **Toast:** 各種失敗時に表示（Gemini timeout / validation error / placeholder 残存 警告）

### 9.3 受け入れ基準

| AC ID | 内容 |
|:---|:---|
| UI-01 | 新規生成画面でフォーム送信→ProgressBanner 出現→done で記事リンク |
| UI-02 | 各 stage の脈動アニメ表示 |
| UI-03 | critical claim 1件以上で PublishButton disabled + tooltip |
| UI-04 | placeholder 残存時に warning badge 表示 |
| UI-05 | バッチ画面で「3/10 完了、4 件処理中、2 件待機」集計表示 |

---

## 10. テスト戦略

### 10.1 単体テスト
- 各 lib モジュール（hallucination, tone, image, content, publish）
- Stage1〜3 の入出力契約（zod schema validation）
- replaceImagePlaceholders の Phase 1/2/3 各分岐

### 10.2 E2E（ZG-01〜ZG-08, PC-01〜PC-05, QA-01〜QA-06, CG-01〜CG-06, IMG-01〜IMG-04, OPS-01〜OPS-06, UI-01〜UI-05）
- Playwright `--workers=auto` で並列最大投入
- `globalSetup`: サーバー疎通確認 + `supabase db reset` + storageState 保存

### 10.3 リグレッション（デグレ防止・最重要）
- 既存 source 記事 59 件が誤って Hub から消えないこと
- visibility_state Step1 移行で既存 45 件が誤分類されないこと
- centroid 再計算前後で同一記事の similarity が ±0.05 以内
- article_revisions 3 件保持の自動削除が正しく動作

### 10.4 mock 戦略
- Gemini API は production 統合テストで実呼出、unit は mock
- FTP は dry-run モードで検証（`tmp/ftp-dry-run/` は ignore 済）

### 10.5 shadow seed
- DB seed: scripts/seed.ts で persona/theme/centroid を投入

### 10.6 CI（pre-deploy ゲート）
- Lint + 型チェック + 単体 + 主要 E2E の必須通過
- migration list の diff 0 検証
- HTML スモーク 4 項目検証

---

## 11. 安全性ガード

### 11.1 グローバル絶対ルール（CLAUDE.md §5 準拠）

1. 役割宣言の義務（`[現在の役割: 〇〇]`）
2. 責務越境禁止（Evaluator はコード触らない、Generator は仕様変えない）
3. 並列性の最大化
4. 自動圧縮の徹底（progress.md に状態スナップショット）
5. 無許可のアーキテクチャ変更禁止
6. フック前提（pre-commit, globalSetup）
7. ハードコード禁止（URL は env、`NEXT_PUBLIC_SITE_URL` 単一ソース）
8. 証拠保全（評価は MCP Playwright で実ブラウザ操作）
9. 実行前疎通確認（Playwright 起動前にローカルサーバー応答確認）
10. ワークスペース自由（/tmp）
11. コミュニケーション全日本語・UTF-8
12. デグレ敏感性（既存機能の変更は明示指示なく行わない）

### 11.2 プロジェクト固有禁止事項

- 関連記事は同 generation_mode 内のみ（cross-mode 禁止）
- HTML 書換は必ず article_revisions INSERT 後（履歴ロスト防止）
- 既存記事の本文/タイトル/コンテキストを明示指示なく変更禁止
- FTP レイヤに削除系呼出を追加禁止（ソフト撤回方式維持）
- 医療アドバイス・宗教的断定は AI 生成で禁止
- 免責事項を全記事末尾に自動付記

### 11.3 アンチパターン（P5-31〜P5-69 教訓）

1. HTML を string.replace(regex) で操作 → 必ず cheerio/htmlparser2
2. `[\s\S]*?` 貪欲マッチ
3. `{1,200}` 数値範囲 fallback regex
4. fetch エラーを catch で握り潰す
5. AI 出力を信用する（必ず post-validate）
6. 同じロジックを複数ファイルに重複（src/lib に集約）
7. catch 後の `stage='done'` 無条件 UPDATE（silent done = 完了表示×本文ゼロ）
8. sub-100 char body の DB INSERT
9. stage transition の logger.info を省略
10. 旧実装コピーを別ファイルに残す

---

## 12. デグレ警戒事項一覧

| # | リスク | 対象 | 防御策 |
|:---:|:---|:---|:---|
| 1 | placeholder closing tag 巻込再発 | replace-placeholders.ts | regex 追加時の単体テスト必須、cheerio 経由のみ |
| 2 | centroid 再計算で既存スコア崩壊 | yukiko_style_centroid | バージョニング、比較は同一バージョン同士 |
| 3 | article_revisions INSERT 漏れ | updateArticle, batch 操作 | 全書換ルートに saveRevision 呼出を担保 |
| 4 | CTA 仕様変更で既存記事影響 | cta-generator.ts | 既存 32 記事の凍結（書換禁止） |
| 5 | FTP 削除系の追加 | src/lib/deploy, src/lib/ftp | grep でゼロ件を CI でガード |
| 6 | visibility_state 意味変更 | publish-control | 段階移行時に parity スクリプト実行 |
| 7 | sub-100 char body INSERT | run-completion.ts | Stage2 出口 + run-completion 入口の二重ガード |
| 8 | catch 後の silent done | zero-gen 全 stage | catch では failed のみ、done は明示成功時 |
| 9 | hallucination/tone persist 失敗の沈黙 | persist-claims, persist-tone | API ハンドラで 500 返却 |
| 10 | 関連記事 cross-mode 復活 | auto-related.ts | 呼出元の事前フィルタ規約を維持 |
| 11 | URL ハードコード復活 | ハブ・FTP 関連 | grep + ESLint カスタムルールで検出 |
| 12 | maxDuration 時間切れ | zero-generate-full | 300s 設定確認 + stuck timeout 5分 |

---

## 13. 仕様/実装ギャップ — v2.1 確定状況

### 13.1 確定済み（v2.1 ユーザー判断 ❶〜❻ + 確定）

| # | 項目 | 確定内容 |
|:---:|:---|:---|
| ❶ | CTA 配置数 | **2 回**（cta2_mid / cta3_end）、cta1_intro 廃止 |
| ❷ | claim_type 値域 | **6 値**（factual / attribution / spiritual / logical / experience / general） |
| ❸ | risk TS 型 | **critical 追加**（src/types/hallucination.ts） |
| ❹ | narrative_arc 型 | **JSONB**（spec §2.1 の TEXT 表記を訂正） |
| ❺ | progress スケール | **0-100 NUMERIC**（既存データ × 100 マイグレ + UI 整合） |
| ❻ | Step2/3 移行 | **本サイクルで実施**（reviewed_at readers 5箇所置換、writers 整理） |
| 7 | scope 形式ロギング | category+action 形式に確定（scope 形式は廃案） |

### 13.2 残課題（本サイクル外、別タスク化）

| # | 項目 | 取扱い |
|:---:|:---|:---|
| R1 | status 遷移 draft→editing 実装確認 | Evaluator が検証 → 実装ありなら維持、なしなら削除 |
| R2 | WRITING_STYLE_SPEC 30 項目 → 14 項目確定 | 暫定: 14 項目を仕様確定。残 16 項目は将来拡張として注記（要追加判断） |
| R3 | auto-fix API（6プロンプト + UI） | 別 spec で段階実装計画。本 spec 範囲外 |
| R4 | SEO settings UI 死にコード化確認 | Evaluator 検証 → 削除 or 修復判定 |
| R5 | log API 永続化（app_logs テーブル） | 別タスク（Phase 2 として記録） |
| R6 | scripts/ops/*.ts 実在確認 | Evaluator 検証 → 欠落分は Generator が補完 |

### 13.3 本サイクル Generator 実装スコープ

P0/P1 マイグレーション（D1〜D4, D11〜D18, D22, D24）+ TS 型同期 + progress スケール変更 + Step2/3 移行 + persist-claims evidence/similarity_score 書込 + transaction 化を 5 並列で実装。

---

## 14. 受け入れ基準サマリ（全 AC 一覧）

```
PC-01〜05: 公開制御（5 項目）
ZG-01〜08: ゼロ生成（8 項目）
QA-01〜06: 品質 QA（6 項目）
CG-01〜06: コンテンツ生成（6 項目）
IMG-01〜04: 画像 placeholder（4 項目）
OPS-01〜06: 運用基盤（6 項目）
UI-01〜05: UI/UX（5 項目）

合計: 40 項目
全 AC は Playwright で検証可能（実ブラウザ操作 or DB クエリ）
```

---

## 15. 変更履歴

| 日付 | バージョン | 主な変更 |
|:---|:---|:---|
| 2026-04-30 | v1.0 | P5 Zero-Generation V1 特化版（Planner 初版） |
| 2026-05-06 | v2.0 | 5 ドメイン横断統合、CTA 矛盾明記、placeholder Phase 1/2/3 追補、visibility_state 8 値整理、要 Change Request 10 件特定 |
| 2026-05-06 | **v2.1** | **本版**: ユーザー判断 ❶〜❻ 確定（CTA=2回、claim_type=6値、risk に critical 追加、narrative_arc=JSONB、progress=0-100、Step2/3 を本サイクル実装）。データモデル整合性 27 矛盾点を §2.4 に統合。Generator 実装スコープを §13.3 で明示。 |

---

## 16. 次のステップ（v2.1 → Generator 5 並列実装）

本仕様書 v2.1 を根拠として、**Generator 5 並列**で以下を実装する:

| Agent | 担当 | 主要ファイル |
|:---:|:---|:---|
| G1 | P0 マイグレーション統合（D1〜D4） | `20260506000000_data_model_consolidation.sql` |
| G2 | TS 型同期（claim_type 6値、risk critical、Article/ArticleRow に P5列） | `src/types/hallucination.ts`, `src/types/article.ts`, `src/lib/db/articles.ts` |
| G3 | progress 0-1 → 0-100 移行（DB CHECK + コード + 既存データ） | `20260506000004_progress_scale_migration.sql`, `src/lib/jobs/zero-gen-job-store.ts`, UI |
| G4 | Step2/3 移行（reviewed_at readers 5箇所 + writers 整理） | `src/lib/hub/hub-generator.ts`, `src/app/sitemap.ts`, `src/app/api/articles/[id]/visibility/route.ts`, `src/app/api/articles/[id]/review/route.ts`(新設) |
| G5 | persist-claims evidence/similarity_score + transaction 化 + FK/INDEX/TRIGGER 追加 | `src/lib/hallucination/persist-claims.ts`, `20260506000001〜000003.sql` |

### Generator 共通ガード（CLAUDE.md 準拠）
- **Loop Count <= 3** で停止（progress.md でカウント管理）
- 各エージェントは独立ファイルのみ編集（並列衝突回避）
- 既存記事 32 件（zero）+ 27 件（source）の本文/タイトル/HTML は触らない（preserve-article-content ルール）
- migration は **既存データ破壊防止**を最優先（× 100 変換は dry-run で件数確認後）

### Evaluator 検証（Generator 後）
1. **デグレ確認最優先**（既存 59 記事の Hub 表示が崩れていないこと、parity スクリプト実行）
2. migration list が CI で diff ゼロ
3. 受け入れ基準 40 項目から smoke 優先で抽出（PC-01, ZG-01, CG-01, IMG-01, OPS-01〜03）
4. 残課題 R1〜R6（§13.2）の Evaluator 担当分（R1, R4, R6）を確認
