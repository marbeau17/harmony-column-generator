# 11. 3段階デプロイゲート仕様

## 概要

Harmony Column Generator の公開フローは「記事生成 → 品質確認 → ハブ掲出」を段階的に分離するため、
**3つの独立したゲート**を直列に持つ。各ゲートは独立のフィールドで管理され、
前段が揃わない限り後段は通過できない。

「確認してハブに掲出」ボタンは、既存の3段階ゲートの **3段目（Gate 3）のフラグ** を
UIから人間の意思で切り替えるためのトリガーである。ゲート自体を迂回するものではない。

---

## ステージ図

```
 ┌─────────────────────────────────────────────────────────────────┐
 │                     3-Stage Deploy Gate                         │
 └─────────────────────────────────────────────────────────────────┘

   [Gate 1: PUBLISHED]         [Gate 2: REVIEWED]         [Gate 3: DEPLOYED]
   status = 'published'        reviewed_at IS NOT NULL     FTPアップロード実施
   published_at set            reviewed_by = '小林由起子'   + hub rebuild
          ▲                           ▲                           ▲
          │                           │                           │
   自動: Stage3品質チェック     手動: 記事詳細 or 一覧の     手動: 「FTPデプロイ」ボタン
   合格時に queue/process       「✅ 確認済みにする」        （Gate 1 & 2 を満たすと
   が自動で昇格                  ボタン / チェックボックス     422 ブロックが外れる）

 ┌───────────────┐     ┌───────────────┐     ┌───────────────┐
 │ body_review等 │ ──→ │   published   │ ──→ │   published   │ ──→  (FTP/Hub)
 │ reviewed=null │     │ reviewed=null │     │ reviewed=set  │
 │ deploy=unable │     │ deploy=blocked│     │ deploy=allowed│
 └───────────────┘     └───────────────┘     └───────────────┘
```

重要: 3段目は DB 上の独立フラグではなく **「FTP 配信済み」という副作用** として表れる。
DB には deployed フラグ列を持たず、ハブページと /column/ 一覧の表示判定は
`status='published' AND reviewed_at IS NOT NULL` で行う。

---

## Gate 1: `status = 'published'`（品質ゲート）

| 属性 | 値 |
|---|---|
| 判定フィールド | `articles.status` |
| 昇格条件 | Stage3 品質チェック合格 |
| 主要列 | `status`, `published_at`, `published_html` |
| トリガ | 自動 (queue/process) |

### 遷移
`body_review` / `editing` → `published`

### 遷移で設定される列
- `status = 'published'`
- `published_at = now()`
- `published_html = <Stage3 確定 HTML>`
- `updated_at = now()`

### 強制ポイント
- API: `src/app/api/queue/process/route.ts` L903–912
  `runQualityCheck` 合格ブランチでのみ上記 UPDATE を実施。
  不合格時は `blocked: true, published: false` で early return。

### UI
- 記事詳細 `src/app/(dashboard)/dashboard/articles/[id]/page.tsx`
  「FTPデプロイ」「由起子さん確認」セクションは
  `article.status === 'published'` のときだけ描画（L557, L588）。
  → Gate 1 未通過なら Gate 2/3 の UI は存在しない。

---

## Gate 2: `reviewed_at IS NOT NULL`（由起子さん承認ゲート）

| 属性 | 値 |
|---|---|
| 判定フィールド | `articles.reviewed_at`, `articles.reviewed_by` |
| 昇格条件 | 本人（小林由起子）による目視確認 |
| 主要列 | `reviewed_at`, `reviewed_by` |
| トリガ | 手動（チェックボックス or ボタン） |

### マイグレーション
`supabase/migrations/20260415000000_add_reviewed_columns.sql`
```sql
ALTER TABLE articles ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
CREATE INDEX IF NOT EXISTS idx_articles_reviewed_at
  ON articles (reviewed_at) WHERE reviewed_at IS NOT NULL;
```

### 遷移で設定される列
ON 時:
- `reviewed_at = now()`
- `reviewed_by = '小林由起子'`

OFF 時（取消）:
- `reviewed_at = null`
- `reviewed_by = null`

### 強制ポイント（フィルタ / ブロック箇所）
1. FTP ハブページ生成: `src/lib/generators/hub-generator.ts` L431
   `.not('reviewed_at', 'is', null)`
2. FTP デプロイゲート: `src/app/api/articles/[id]/deploy/route.ts` L42–47
   `if (!article.reviewed_at)` → 422 返却
3. Next.js /column/ 一覧: `src/app/column/page.tsx` L80
   `.not('reviewed_at', 'is', null)`
4. Next.js /column/[slug]: `src/app/column/[slug]/page.tsx` L31
   `.not('reviewed_at', 'is', null)`（個別ページも 404 で隠す）
5. API 更新: `src/lib/validators/article.ts` の
   `updateArticleSchema` に `reviewed_at`/`reviewed_by` を受理するフィールドあり

### 起点となるユーザ操作
- 記事一覧のチェックボックス:
  `src/app/(dashboard)/dashboard/articles/page.tsx` L640–670
  `PUT /api/articles/:id` で `{ reviewed_at, reviewed_by }` を送信。
  成功時に `/api/hub/deploy` は **別途呼び出す** か、Gate 3 側でトリガする。
- 記事詳細ページの「✅ 確認済みにする」/「確認を取消」ボタン
  (`[id]/page.tsx` L602–624)。

---

## Gate 3: FTP 配信実行ゲート

| 属性 | 値 |
|---|---|
| 判定フィールド | なし（副作用として FTP 上に記事 HTML が存在する） |
| 昇格条件 | Gate 1 & Gate 2 を通過済みで、管理者が明示的に実行 |
| トリガ | 手動（「FTPデプロイ」ボタン / ハブ再生成） |

### 処理
`POST /api/articles/[id]/deploy` (`src/app/api/articles/[id]/deploy/route.ts`)
1. 認証チェック
2. 記事取得
3. **Gate 2 確認**: `!article.reviewed_at` → 422
4. `generateArticleHtml` で HTML 生成
5. 品質チェックリスト `runDeployChecklist` → 失敗時 422
6. テンプレート整合性 `runTemplateCheck` → 失敗時 422
7. FTP で記事 HTML + 画像をアップロード
8. `/api/hub/deploy` を呼び出してハブ再生成（バックグラウンド）

### 強制ポイント
- **API Guard**: 上記 3. の 422（`reviewed_at` が null なら確実にブロック）
- **品質ゲート**: 5. 6. の 2 重チェック
- **UI**: 記事詳細で `status === 'published'` のときだけボタン表示

### DB 書込み
Gate 3 は **状態を持たない**。FTP 配信の事実は FTP サーバ側にのみ記録される。
→ 再デプロイや、Gate 2 を取消したあとの「既にデプロイ済み HTML をどう扱うか」は
   別仕様（ハブ rebuild で一覧から消える／個別 HTML は FTP 上に残る可能性あり）。

---

## 列ベースの状態マトリクス

| 状態 | `status` | `published_at` | `reviewed_at` | FTP 上の HTML | ハブ掲出 |
|---|---|---|---|---|---|
| 生成中 | `body_review`等 | null | null | 無 | 無 |
| 品質合格・未確認 | `published` | set | null | 無 (deploy 422) | 無 |
| 本人確認済・未配信 | `published` | set | set | 無 | 無（※1）|
| 本人確認済・配信済 | `published` | set | set | 有 | 有 |
| 再審査中（取消） | `published` | set | null | 旧HTML残存の可能性 | 無（フィルタで除外） |

※1: Gate 2 通過時点で `/column/` (Next.js) には即表示される。FTP ハブ
(`harmony-mc.com/column/`) は Gate 3 実行まで反映されない。

---

## 単一「確認してハブに掲出」ボタンの統合案

既存 UI はチェックボックス（Gate 2 のみ切替）＋「FTPデプロイ」ボタン（Gate 3 のみ実行）の
二段構成。これを **1ボタン化**する場合の設計オプションは3つ。

### 選択肢 (a): Gate 1–3 すべてが揃っていることを要求する純ビジビリティ
- ボタンは押下前に `status === 'published' && reviewed_at && lastDeployedAt` を要求
- 押下は「ハブ掲出フラグ」だけを書き換える（新規列 `hub_visible_at` 等を追加）
- **Pros**
  - 3つのゲートを完全保持。意味的に最も clean。
  - ボタン誤爆で FTP 転送が走ることはない。
- **Cons**
  - 新列追加と全クエリの再配線が必要（デグレ表面積が大）。
  - 3箇所を操作してからでないと押せない → UX 悪化（現状より悪い）。
  - 既存の「`reviewed_at` で全レイヤフィルタ」ロジックとの整合崩れ。

### 選択肢 (b): ボタンが Gate 2 と Gate 3 を連続実行（推奨）
- 押下で以下を順次実行:
  1. `PUT /api/articles/:id` で `reviewed_at = now()` / `reviewed_by = '小林由起子'`
  2. `POST /api/articles/:id/deploy` （FTP + `/api/hub/deploy`）
- Gate 1 は前提条件。未達なら UI でボタンを disabled にする。
- **Pros**
  - 「確認 = 掲出」を人間の意図と一致させ、UX 1 クリック化。
  - 既存の強制ポイント（API Guard 5 箇所、品質チェック、テンプレ検証）を一切改変せず再利用。
  - 失敗時は 422 でロールバック判断が可能（Gate 2 を自動で戻すか要設計）。
- **Cons**
  - Gate 2 ON のあと Gate 3 が失敗した場合、DB は「確認済・未配信」状態になり
    Next.js /column/ には即表示されるが FTP ハブは古いまま、という乖離が起こる。
  - 対応: エラー時に `reviewed_at` を自動 rollback、または「確認のみ成功」UIで明示。

### 選択肢 (c): ゲートから独立した純ビジビリティフラグ
- 新列 `hub_visible = bool` を追加し、このボタンはそれだけを切り替える。
- FTP 配信・本人確認とは完全に独立。
- **Pros**
  - 実装は最小（列追加＋ハブ生成のフィルタに AND 条件を 1 つ足すだけ）。
- **Cons**
  - 「未確認なのに掲出される」「FTP にデプロイされていないのに掲出フラグ ON」が
    論理的に発生可能 → ハブに載っているのに記事ページが 404 / 旧版、という最悪事故。
  - 既存の reviewed_at フィルタとの二重管理でロジック散乱。**デグレ温床。**

---

## 推奨統合（Recommended）

**選択肢 (b)**。

理由:
- 既存の 5 箇所の `reviewed_at` フィルタ／Gate 3 API Guard／品質 2 重チェックを **一切変更しない**。
  → デグレ表面積がゼロ。
- ボタンは「既存の 2 クリック（✅ 確認 → FTP デプロイ）」の逐次実行ラッパに過ぎず、
  既存挙動の差分は UI 層のみ。API・DB・FTP 層は無改変。
- Gate 1 未通過時はボタンを disabled（現行でも該当セクション自体非表示）。

必須要件:
1. ボタン disabled 条件: `article.status !== 'published'`
2. Gate 2 PUT 成功 → Gate 3 POST 失敗時の挙動:
   - **デフォルト**: `reviewed_at` を自動ロールバック（null 戻し）。
     → FTP 失敗でハブに記事が載らないまま Next.js 側だけ露出、という乖離を防ぐ。
   - 代替: トースト「確認は保存されましたが FTP 配信に失敗しました。再試行してください」で
     手動再送に委ねる（ロールバックしない）。
3. 確認ダイアログ: Gate 2 取消時の「ハブから非表示になります」モーダル（既存）は維持。
4. 404 回避: Gate 2 OFF を押したときは、FTP 上の記事 HTML を削除するか、
   `harmony-mc.com/column/<slug>/` にアクセスされた場合の扱いを別 issue とする
   （本スペックの範囲外）。

---

## 参考ファイル

- `supabase/migrations/20260415000000_add_reviewed_columns.sql`
- `src/app/api/articles/[id]/deploy/route.ts`
- `src/app/api/queue/process/route.ts` (L903–912)
- `src/lib/generators/hub-generator.ts` (L427–432)
- `src/app/column/page.tsx` (L75–82)
- `src/app/column/[slug]/page.tsx` (L29–32)
- `src/app/(dashboard)/dashboard/articles/page.tsx` (L640–670)
- `src/app/(dashboard)/dashboard/articles/[id]/page.tsx` (L557, L588, L602–624)
- `docs/review-toggle-spec.md`
