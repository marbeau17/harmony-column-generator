# Publish Control 統一リファクタ設計書 — `reviewed_at` × `visibility_state` 二系統解消

> **Status:** Design (実装前ドラフト)
> **Author:** Architect role / 5 エージェントループ Step 1 (Planner)
> **Scope:** Documentation only — 本書はコード変更を含まない。
> **関連 Spec:** `docs/specs/publish-control/SPEC.md` §3.2 / §8.1
> **関連 Migration:** `supabase/migrations/20260415000000_add_reviewed_columns.sql`,
>   `supabase/migrations/20260419000000_publish_control_v2.sql`

---

## 1. 問題ステートメント

Harmony Column Generator では「ハブページに表示してよい記事か」を判断するフラグが
**2 つ独立して** 持続している。

| 系統 | 列 | 導入 | 意味 |
|:---|:---|:---|:---|
| Legacy 由起子レビューゲート | `articles.reviewed_at` (TIMESTAMPTZ) / `reviewed_by` (TEXT) | `20260415000000_add_reviewed_columns.sql` | 由起子さんによる人間レビュー完了時刻 |
| Publish Control V2 ステートマシン | `articles.visibility_state` (TEXT, CHECK 制約) / `is_hub_visible` (BOOLEAN) / `visibility_updated_at` | `20260419000000_publish_control_v2.sql` | デプロイ進行と最終ハブ表示の状態機械 |

両者は **意味的に重なるのに独立して書き換えられる** ため、片方だけが更新されると
状態が破綻し、UI 表示・ハブ生成・FTP デプロイの判断がそれぞれ食い違う。

### 1.1 不整合パターン (実観測 5 例)

> 以下は P5-31 〜 P5-40 で報告されたバグから抽出した実例パターンである。

1. **R1: `reviewed_at IS NULL` だが `visibility_state='live'`**
   - 経路: `src/lib/zero-gen/run-completion.ts:463` で `autoApprove=false` のとき `reviewed_at=null`
     のまま `status` だけ `published` に上がり、`src/lib/db/articles.ts:362` の
     `publishedAutoFields.visibility_state = 'live'` がトリガーされる。
   - 結果: ハブ生成 (`src/lib/generators/hub-generator.ts:431`) は `reviewed_at IS NOT NULL` で
     除外するため、`visibility_state='live'` なのにカードに出ない「ステルス live」状態。

2. **R2: `reviewed_at IS NOT NULL` だが `visibility_state='unpublished'`**
   - 経路: 由起子さんがダッシュボード詳細 (`src/app/(dashboard)/dashboard/articles/[id]/page.tsx:721`)
     で「✅ 確認済みにする」を押すが、`visibility_state` は触らない。
     その後別経路で `batch-hide.ts:159` が `unpublished` に倒す。
   - 結果: 由起子的には承認済みなのにハブには出ず、UI バッジが「確認済み」「非公開」両方表示。

3. **R3: 公開API (`/visibility`) と確認チェックの ping-pong**
   - 経路: `src/app/api/articles/[id]/visibility/route.ts:161-166` は `reviewed_at` を
     visibility と一緒に書き込む (visible 時 set / unvisible 時 null)。一方
     `articles/[id]/page.tsx:721` のチェック切替は `visibility_state` を触らない。
   - 結果: トグル順序によって最終状態が変わる。「公開→確認解除→再公開」で `reviewed_at` が
     `公開時刻 → null → 公開時刻` と乱高下し、`reviewed_by` の意味が「公開した人」と
     「レビューした人」で混線する。

4. **R4: FTP デプロイゲート (`deploy/route.ts:42`) と V2 ステートの不一致**
   - `/api/articles/[id]/deploy` は **`reviewed_at` のみ** を 422 ゲートに使う。
     `visibility_state='live'` で `reviewed_at IS NULL` の記事 (R1 経路) を deploy しようとすると
     422 が返り、UI には「公開中」と表示されるのに FTP が更新できない矛盾が起きる。

5. **R5: トーン Centroid 学習データの汚染**
   - `src/lib/tone/compute-centroid.ts:120` は `reviewed_at IS NOT NULL` を
     「由起子さんが品質保証した正例」として centroid を計算する前提。
     ところが `visibility/route.ts:161` は **公開操作の副作用として** `reviewed_at` を
     セットしてしまうため、由起子レビュー未経由の記事も centroid 学習対象に混ざる。

### 1.2 共通の根本原因

- `reviewed_at` の意味が **「人間レビューゲート (audit)」と「ハブ表示の事実マーカー」** の
  2 役を兼ねている (`SPEC.md §8.1` は audit-only と宣言したが実装が追従していない)。
- `visibility_state` 単独では「人間レビューを通っているか」を表現できないため、
  publish API がやむを得ず `reviewed_at` を書き換える後付け実装になった
  (`visibility/route.ts:152-154` の TODO コメント参照)。
- 読み手 (`hub-generator.ts:431`, `column/page.tsx:80`, `sitemap.ts:37`,
  `column/[slug]/page.tsx:32`) が **依然として `reviewed_at` だけ** を見ているため、
  書き手が増えるほど整合性責任が発散する。

---

## 2. 目標状態 (Target State)

### 2.1 設計原則

- ハブ表示・FTP デプロイ・SEO sitemap・SSG 列挙のすべてを **`visibility_state` 単一系統** で判定する。
- 人間レビュー (由起子さん確認) は `visibility_state` の中に
  **明示的な中間ステート `pending_review`** として組み込む。
- `reviewed_at` は **監査用タイムスタンプ** に格下げし、状態判断には使わない。
  (= 推奨案 b、§3 参照)

### 2.2 統一後ステートマシン (text 図)

```
                     [生成完了 (zero-gen / 旧フロー)]
                                │
                                ▼
                         ┌──────────────┐
                         │   draft      │  ← 既存 status='editing' 相当
                         └──────────────┘
                                │ submit_for_review
                                ▼
                         ┌──────────────┐
                         │ pending_review│ ← 由起子さん確認待ち
                         └──────────────┘
                                │ approve_review (人間)
                                ▼
                         ┌──────────────┐
                         │   idle       │ ← 公開可能・未デプロイ
                         └──────────────┘
                          │      ▲    ▲
                deploy ↓  │      │    │ unpublish
                          ▼      │    │
                    ┌─────────────┐   │
                    │  deploying  │   │
                    └─────────────┘   │
                       │   │   │      │
                  live │   │   │ failed
                       ▼   │   ▼      │
                  ┌──────┐ │ ┌───────┐│
                  │ live │ │ │failed ├┘
                  └──────┘ │ └───────┘
                       │   │
                       │ live_hub_stale (hub rebuild 失敗時)
                       ▼
                  ┌────────────────┐
                  │ live_hub_stale │
                  └────────────────┘
                       │ 再 hub deploy
                       ▼
                     live

  [unpublished] ◀── unpublish ── live / live_hub_stale
  [unpublished] ── deploy ──▶ deploying  (再公開)
  [pending_review] ── reject_review ──▶ draft  (差戻し)
```

### 2.3 各状態の定義

| state | ハブ表示 | sitemap | FTP article 物理ファイル | 意味 |
|:---|:---:|:---:|:---:|:---|
| `draft` | × | × | × | 編集中。zero-gen 中も含む。 |
| `pending_review` | × | × | × | 由起子さん人間レビュー待ち。 |
| `idle` | × | × | × | 承認済みで公開可能、まだ deploy 未実施。 |
| `deploying` | × | × | (進行中) | デプロイ中ロック。60s で dangling。 |
| `live` | ◯ | ◯ | ◯ | 公開中、ハブも整合。 |
| `live_hub_stale` | ◯ (記事のみ) | ◯ | ◯ | 記事は live だがハブ rebuild 失敗。 |
| `unpublished` | × | × | (noindex notice) | ソフト撤回済み。 |
| `failed` | × | × | (前回値) | デプロイ失敗。再試行 or roll back 待ち。 |

### 2.4 「公開可能」の不変条件

```
visibility_state ∈ {live, live_hub_stale}
  ⇒ 必ず status='published' AND 過去に pending_review→idle を経由している
```

ハブ・sitemap・SSG の **全読み手** はこの単一条件に統一する。

---

## 3. `reviewed_at` の扱い

### 3.1 候補

| 案 | 概要 | メリット | デメリット |
|:---|:---|:---|:---|
| **a. 完全廃止** | 列を drop し、レビュー履歴は `publish_events` のみに残す | 列が消えるので不整合が物理的に発生不能 | 過去 45 件の「いつ由起子さんが確認したか」を 1:1 で保持する場所が消える。tone centroid (`compute-centroid.ts`) の正例抽出ロジックが `publish_events` join に変わり実装コスト大 |
| **b. `pending_review` 中間ステートとして表現** | state machine に `pending_review` / `idle` を追加。`reviewed_at` は audit タイムスタンプとして残すが状態判断には使わない | 既存 `reviewed_at` の値を「最終承認時刻」として後方互換に保持できる。tone centroid は `visibility_state IN ('idle','live','live_hub_stale','unpublished')` に置換可能。state 機能と audit 機能を分離できる | 列が残るため「読み手が誤って参照する」リスクが残る (lint/CI で守る必要あり) |
| **c. 別軸として残し precondition 化** | `visibility_state` 遷移の事前条件として `reviewed_at IS NOT NULL` を明示制約 (CHECK / トリガ) で強制 | 最小変更 | 二系統並立がそのまま温存される。本リファクタの目的を達成しない |

### 3.2 推奨案: **b (pending_review 中間ステート + audit 保持)**

採用根拠 (5 行以内):

1. tone centroid (`compute-centroid.ts:119-135`) は「最終承認済 45 件」を正例にしており、
   この値を物理 drop すると ML 系列の dryrun が壊れる。**audit 保持が安価**。
2. `publish_events` には `action IN ('publish','unpublish','hub_rebuild','ripple_regen')` しか
   無く、レビュー承認イベントを表現する型が無い (要 schema 拡張)。
3. 案 c は問題を解かないため除外。
4. 「由起子さんが押した」は将来 RBAC で actor を増やす可能性があり、`visibility_state` の
   遷移条件として state machine 内で扱うほうが拡張に強い。
5. `reviewed_at` を audit-only に降格すれば `SPEC.md §8.1` の宣言と実装が初めて一致する。

---

## 4. 影響範囲 (file:line table)

### 4.1 `reviewed_at` writers (状態遷移を起こす書き手)

| file:line | 書き込み内容 | 統一後の扱い |
|:---|:---|:---|
| `src/app/api/articles/[id]/visibility/route.ts:161` | `reviewed_at = now()` (publish 副作用) | 削除。`visibility_state` のみ書き込む |
| `src/app/api/articles/[id]/visibility/route.ts:164` | `reviewed_at = null` (unpublish 副作用) | 削除 |
| `src/app/(dashboard)/dashboard/articles/[id]/page.tsx:721` | `reviewed_at = now/null` (詳細ページ ✅ ボタン) | `submit_for_review` / `approve_review` action に置換 |
| `src/app/(dashboard)/dashboard/articles/page.tsx:806,817` | 一覧ページの ✅ チェックボックス | 同上 (新 API 経由) |
| `src/lib/zero-gen/run-completion.ts:400,463` | zero-gen 完了時の自動承認 | `autoApprove=true` 時に `visibility_state='idle'`、false 時 `pending_review` |
| `src/lib/articles/batch-hide.ts:162` | `reviewed_at = null` (一括非公開) | 削除。`visibility_state='unpublished'` のみ |
| `src/app/api/articles/[id]/visibility/route.ts:162,165` | `reviewed_by` | audit のため Step 4 まで保持、Step 5 で削除検討 |

### 4.2 `reviewed_at` readers (状態判断に使っている読み手)

| file:line | 用途 | 統一後の置換 |
|:---|:---|:---|
| `src/lib/generators/hub-generator.ts:431` | ハブカード列挙の必須条件 | `.in('visibility_state', ['live','live_hub_stale'])` |
| `src/app/sitemap.ts:37` | sitemap.xml 出力対象 | 同上 |
| `src/app/column/page.tsx:80` | 公開コラム一覧 (Next.js public) | 同上 |
| `src/app/column/[slug]/page.tsx:32` | 公開コラム詳細 | 同上 |
| `src/app/api/articles/[id]/deploy/route.ts:42` | FTP デプロイゲート | `visibility_state IN ('idle','failed','live_hub_stale','unpublished')` をデプロイ可能条件に |
| `src/lib/tone/compute-centroid.ts:120` | tone 学習正例抽出 | `visibility_state IN ('live','live_hub_stale')` または `reviewed_at IS NOT NULL` (audit 列を読む) |
| `src/app/(dashboard)/dashboard/articles/page.tsx:128,129,243,245,750,780,792,793` | 一覧 UI のフィルタ・バッジ | `visibility_state` 派生のフィルタに置換 |
| `src/app/(dashboard)/dashboard/articles/[id]/page.tsx:704,729,734` | 詳細 UI のバッジ・ボタン | 同上 |

### 4.3 `visibility_state` writers / readers (現存)

| file:line | 役割 |
|:---|:---|
| `src/app/api/articles/[id]/visibility/route.ts:122,157,179,224,232` | 公開トグル本体 (writer) |
| `src/app/api/queue/process/route.ts:914` | キュー処理完了時 (writer) |
| `src/lib/dangling-recovery/recover.ts:74,98` | dangling 回復 (reader+writer) |
| `src/app/api/dangling-recovery/route.ts:7-8` | dangling 回復 API |
| `src/lib/articles/batch-hide.ts:159` | 一括非公開 (writer) |
| `src/lib/db/articles.ts:249,353,362` | published auto-fields (writer) |
| `src/lib/publish-control/state-machine.ts:1-33` | 遷移定義 (定義) |
| `src/lib/publish-control/session-guard.ts:37` | session guard 監視列 |
| `src/lib/publish-control/guards.ts` | 公開 NOOP / TRANSITION 判定 |
| `src/types/article.ts:138` / `src/lib/db/articles.ts:62` | 型定義 |
| `supabase/migrations/20260419000000_publish_control_v2.sql:13,19,31` | スキーマ |

### 4.4 検証スクリプト (削除/更新候補)

未コミット scripts (status 参照): `scripts/check-empty-body-articles.ts`,
`scripts/verify-article-10.ts` 等。grep 結果に応じて Step 4 で並行更新。

---

## 5. マイグレーション手順

> **原則:** 列を直接 drop しない。**読み取り側 → 書き取り側 → 列削除/降格** の順で
> 各ステップの間に E2E 検証を挟む。各ステップは独立に rollback 可能なサイズに分割する。

### Step 1 — スキーマ拡張 (additive only)

- `visibility_state` の CHECK 制約に `'draft'`, `'pending_review'` を追加
  (新マイグレーション e.g. `20260503000000_publish_control_unification_step1.sql`)。
- `state_machine.ts` の `TRANSITIONS` に `draft` / `pending_review` ノードを追加。
- 既存行は **データ変更しない**。`reviewed_at IS NOT NULL AND visibility_state='idle'` の
  行は引き続きそのまま。新規列追加もなし。
- **動く:** 既存全フロー
- **動かない:** まだ無し (additive only)

### Step 2 — 読み手の統一 (readers migration)

- §4.2 の reader 8 箇所を全て `visibility_state` ベースに置換。
- 但し書き手側はまだ `reviewed_at` を二重書き込みしているので、**シャドー期間** として
  両方が一致しているはず。`scripts/verify-publish-state-parity.ts` (新規) で
  全 articles に対し `(reviewed_at IS NOT NULL) === (visibility_state IN ('live','live_hub_stale'))`
  をアサート。差異が出る行は手動修復。
- **動く:** ハブ・sitemap・SSG・FTP deploy gate (`visibility_state` で動作)
- **動かない:** UI チェックボックス即時反映 (writer 側はまだ旧経路)。書き手と一時的に
  名前空間が分かれるが、シャドー期間の不変条件 (parity script) で守る。

### Step 3 — 書き手の統一 (writers migration) + `pending_review` 導入

- 新 API: `POST /api/articles/[id]/review` (action: `submit` / `approve` / `reject`)。
  `reviewed_at` / `reviewed_by` は audit-only としてここでだけ書く。
- §4.1 の writer 7 箇所を新 API もしくは `visibility_state` 直接更新に置換。
  `visibility/route.ts` の `reviewed_at` 副作用 (line 161-166) は **削除**。
- zero-gen `run-completion.ts` の `autoApprove=true` パスは `visibility_state='idle'` を、
  false パスは `pending_review` をセットするよう修正。
- ダッシュボード UI の ✅ ボタンは新 API を呼ぶよう差し替え。
- **動く:** 単一系統で全状態遷移
- **動かない:** 旧 `reviewed_at` だけを直接 SQL で書き換える運用スクリプト
  (本リポジトリ内の `scripts/*.ts` で grep される ad-hoc 修復系) は更新が必要。

### Step 4 — `reviewed_at` を audit-only に降格

- DB レベル: `reviewed_at` を `NOT NULL` 化しない (歴史データのため null 容認)。
  ただし migration コメント・`session-guard.ts` の guard 対象から外し、
  「読み取り禁止」を CI lint (custom ESLint rule) で機械的に強制。
- 例外: `compute-centroid.ts` の正例抽出は Step 2 で `visibility_state` ベースに移行済みなので
  ここでは何もしない。
- **動く:** 全フロー
- **動かない:** 旧 SQL 直書きスクリプトのうち未更新のもの

### Step 5 — 列削除 (任意・後日)

- 1 リリース以上 (推奨 2 週間) 安定稼働を確認後、`reviewed_at` / `reviewed_by` を物理 drop
  するか判断。45 件の audit 履歴を残すなら Step 4 の状態で恒久運用も可。
- 推奨案 b の本旨は「列を残してでも参照しない」ことなので、**Step 5 は実施しなくても
  リファクタは完了する**。

---

## 6. リスクと検証計画

### 6.1 デグレリスク

| リスク | 影響フロー | 緩和策 |
|:---|:---|:---|
| Step 2 シャドー期間の parity 崩れ | ハブ表示が一部記事だけ消える | parity script を pre-deploy CI で実行、差異 0 を必須化 |
| `pending_review` 追加で既存 45 件が宙ぶらりんに | 既存 reviewed 済記事が一括で非表示 | Step 1 マイグレーションで既存 `reviewed_at IS NOT NULL` 行は `visibility_state='live'` を維持 (back-fill しない) |
| zero-gen autoApprove フラグの意味変化 | 自動承認設定の運用変更 | Step 3 リリース前に `docs/specs/publish-control/SPEC.md` の §3.2 を Change Request 経由で更新 |
| FTP deploy gate の意味変化 | 422 が減って意図せず deploy が走る | Step 3 で `visibility_state IN ('idle','failed','live_hub_stale','unpublished')` のみ deploy 許可、`pending_review` は 422 維持 |
| tone centroid 学習の正例選定がブレる | ML 出力の品質低下 | Step 2 で centroid 抽出を `visibility_state` ベースに変えた直後に dryrun (`docs/source-chunks-embed-dryrun.md`) で旧/新 cosine 差分 < 0.01 を確認 |
| `publish_events` に review action が無い | 監査ログの欠落 | Step 3 で `action` CHECK 制約に `'review_submit','review_approve','review_reject'` を追加 |

### 6.2 E2E 検証シナリオ (Playwright 必須)

> グローバル §2「テストと検証フロー」に準拠。すべて `globalSetup` 後に `--workers=auto` で実行。

1. **承認→公開→撤回→再公開** が ✅ ボタン経由で `pending_review → idle → live → unpublished → live` を
   往復し、`reviewed_at` が「最後に approve した時刻」で固定される (publish/unpublish では
   変わらないことをアサート)。
2. **承認なしで FTP deploy 実行** → 422 と `code: 'PENDING_REVIEW'` (新)。
3. **zero-gen 完走 (autoApprove=false)** で `visibility_state='pending_review'` に着地し、
   ハブ・sitemap には現れない。
4. **zero-gen 完走 (autoApprove=true)** で `visibility_state='idle'` に着地し、
   FTP deploy までゲートを通過。
5. **batch-hide で 5 件一括非公開** → 全件 `unpublished` になり、`reviewed_at` は null 化されない
   (audit が保持される) ことをアサート。
6. **dangling deploying 60s ロック切れ** → recover.ts が `failed` に倒し、再 deploy が `idle` 経由で
   通る (R1 のステルス live が再現しないこと)。
7. **由起子さんが詳細ページで「確認を取消」** → `pending_review` に戻り、ハブから即座に消える。

### 6.3 Rollback 戦略

- **Step 1 / Step 2 ロールバック:**
  reader を旧 `reviewed_at` ベースに戻す PR を revert で作成。スキーマは additive なので
  DB 変更不要。
- **Step 3 ロールバック (高リスク):**
  - 直前 commit で savepoint タグ `chore: savepoint before unification step3`。
  - 失敗時は `git reset --hard <savepoint>` し、parity script で `visibility_state` を
    旧 `reviewed_at` から再構築 (UPDATE SQL を 1 本)。
  - `pending_review` 状態の記事は `idle` に戻すか `draft` に戻すかをオペレータが判断
    (新ステートが消えるため)。
- **Step 4 ロールバック:**
  CI lint を外すだけで戻る。データ変更ゼロ。
- **Step 5 (列削除) は実施推奨しない。** 実施した場合は復元用 dump を migration 直前に取得し、
  Supabase `pg_dump` の差分復元で対応。

---

## 7. 完了条件 (Definition of Done)

1. `git grep "reviewed_at" -- src/` の結果が **audit 用 `compute-centroid.ts` (任意)** と
   `types/article.ts` の型定義のみに収束する。
2. ハブ・sitemap・コラム公開ページ・FTP deploy ゲートのすべての判断が
   `visibility_state` 単一列を読む実装になっている。
3. parity script `scripts/verify-publish-state-parity.ts` を pre-deploy CI で常時実行し、
   差異 0 が継続している。
4. `docs/specs/publish-control/SPEC.md §3.2 / §8.1` が新ステートマシンと一致する内容に
   Change Request で更新済み。
5. 本書 §6.2 の E2E 7 シナリオがすべて green。

---

## 8. 未決事項 / 議論ポイント

- `pending_review` を導入する際、既存 status 列 (`editing` / `published` / `archived`) との
  関係を整理するか、status 列自体も visibility_state に吸収するかは別議論。
  本書は **status 列はそのまま残す前提** (zero-gen の途中段階を表現するため)。
- `reviewed_by` を将来 RBAC 拡張するか (例: 編集者・由起子さん・運用担当の 3 ロール) は
  本リファクタのスコープ外。
- 案 a (完全廃止) を採用する場合、tone centroid の正例抽出を `publish_events` join に
  書き換える追加コスト (推定 +0.5 日) を別途計上する必要あり。

---

(End of design document)
