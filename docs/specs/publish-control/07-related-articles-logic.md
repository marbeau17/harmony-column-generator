# 07. 関連記事ロジック（現状） — publish-control 連携観点

対象: Harmony Column Generator / 2026-04-19 時点の現状コードベース
目的: 新しい「確認ボタン（公開/非公開）」が関連記事ブロックの見え方を制御するため、
現行の関連記事の「選定 → 保存 → 埋め込み → 再計算」フローを正確に把握する。

---

## 1. 関連記事の選定アルゴリズム

実装: `src/lib/generators/related-articles.ts`

- 手法: **TF-IDF ベースのコサイン類似度**。タグマッチでもベクトル埋め込みでもなく、手動指定でもない。
- トークナイザー: 日本語テキストを **bigram**（2文字ずつ）で分割。空白・全半角記号は前処理で除去し小文字化する（`tokenize`）。
- コーパス: 「新規記事のキーワード」＋「候補タイトル群」全てを1コーパスとして IDF を算出する。
- スコア計算: `cosineSimilarity(queryVec, docVec) + spiritualTermBonus`
  - クエリは `article.keyword`、候補は各記事の `title`（本文は見ない）。
  - `SPIRITUAL_TERMS`（ツインレイ/チャクラ/前世/カルマ/…25語、`related-articles.ts:115-141`）が
    キーワードとタイトル両方に含まれれば **+0.15** のボーナス。
- 出力: スコア降順 `topN`（既定3件）、`excludeHref` で自分自身を除外。
- 返却型: `{ href: string; title: string; score: number }[]`。

フォールバック（DBに保存済みの関連記事が空だった場合、Next.js の `/column/[slug]` でのみ動作）:
`src/app/column/[slug]/page.tsx:51-113` — 同 `theme` の published 記事を最新順で最大3件、
足りなければ全テーマから最新順で補完する。

---

## 2. 保存場所とスキーマ

- テーブル: `public.articles`
- カラム: `related_articles JSONB DEFAULT '[]'::jsonb`
  - 定義: `supabase/schema.sql:95`, `supabase/migrations/20260404000000_initial_schema.sql:94`
- 形式: `[{ href: "/column/<slug>/", title: "..." }, ...]`（最大3件、`score` は保存時に削る）
- 書き込み元は以下の3箇所のみ:
  1. `computeAndSaveRelatedArticles(articleId)` — `src/lib/publish/auto-related.ts:55-108`
  2. `updateAllRelatedArticles()` — `src/lib/publish/auto-related.ts:116-173`
  3. （どちらも `.update({ related_articles })` を発行する）

候補集合は **`status = 'published'` の記事のみ**（`auto-related.ts:41`, `fetchPublishedArticleCards`）。

---

## 3. 記事HTMLへの埋め込み

関連記事ブロックが生成されるのは **記事HTMLを組み立てるタイミング** で、
保存済みの `article.related_articles` (JSONB) を読み出して差し込む。

### 3-1. FTPデプロイ先（本番 `harmony-mc.com/column/<slug>/index.html`）

- 生成器: `src/lib/generators/article-html-generator.ts`
  - `buildRelatedArticlesHtml(article.related_articles)` を呼ぶ（`:134-153`, `:297`）。
  - テンプレート上の埋込位置は `<section class="article-related">` → `<div class="article-related-grid">${relatedArticlesHtml}</div>`（`:690-696`）。
  - カード要素は `<a href="<href>">` + `<img src="/column/<slug>/images/hero.jpg">` + タイトル。
  - 空配列なら「他のコラムも準備中です。お楽しみに。」のプレースホルダ。
- 呼び出し経路:
  - `src/app/api/articles/[id]/deploy/route.ts:50-55` — 個別記事デプロイ時に都度生成。
  - `src/lib/export/static-exporter.ts:133-140` — `out/column/<slug>/index.html` への静的エクスポート時。
- リンク書換え（FTP/out用）:
  - `/column/<slug>/` → `../<slug>/index.html`（deploy/route.ts:61, static-exporter.ts:153）
  - サムネ `/column/<slug>/images/...` → `../<slug>/images/...`

### 3-2. Next.js SSR（開発ダッシュボードのプレビュー `/column/<slug>`）

- `src/app/column/[slug]/page.tsx:278, 416-441` — `getRelatedArticles(article)` で
  DB の `related_articles` を優先、空ならテーマベース補完。ここは **実行時取得** なので常に新しい。

### 3-3. ハブページ

ハブページ（`/column/index.html`）自体には関連記事ブロックはない。ハブは全 published 記事の一覧カードのみ。

---

## 4. 「関連記事を一括更新」ボタン

### 4-1. UI

- ファイル: `src/app/(dashboard)/dashboard/articles/page.tsx`
- ボタン: `:379-390`、ラベル `関連記事を一括更新` / アイコン `RefreshCw`。
- ハンドラ: `handleBulkUpdateRelated` (`:272-288`) — `POST /api/articles/update-related` を叩き、
  `updated` 件数を `${count} 件の記事の関連記事を更新しました` として表示する。

### 4-2. API

- ルート: `POST /api/articles/update-related`
  - 実装: `src/app/api/articles/update-related/route.ts`
  - 認証: `supabase.auth.getUser()` が必須（未ログインなら 401）。
  - 本体: `updateAllRelatedArticles()` を呼ぶだけ。`maxDuration = 60`。
- 本体: `src/lib/publish/auto-related.ts:116-173`
  - `status = 'published'` の全記事を取得 → それぞれを自身を除外して TF-IDF 計算 →
    `articles.related_articles` に上書き保存。
  - レスポンス: `{ updated, errors[] }`。
  - **実行中はDB書込のみ。HTML再生成・FTP再アップロード・out/再生成は行わない。**

---

## 5. 公開/非公開との同期セマンティクス（重要）

現状コードにおける「関連記事が自動再計算される瞬間」は次の3つだけ:

| トリガ | 処理 | 場所 |
|---|---|---|
| 記事が `editing → published` に遷移した時 | `computeAndSaveRelatedArticles(id)` → `updateAllRelatedArticles()` をバックグラウンドで実行 | `src/app/api/articles/[id]/transition/route.ts:131-138` |
| キュー処理の最終ステップで `published` になった時 | 同上（直接 import して await） | `src/app/api/queue/process/route.ts:922-930` |
| ダッシュボードで「関連記事を一括更新」を押した時 | `updateAllRelatedArticles()` のみ（手動） | `/api/articles/update-related` |

### 5-1. ステータス遷移表（`src/lib/db/articles.ts:16-24`）

```
draft              → [outline_pending]
outline_pending    → [outline_approved, draft]
outline_approved   → [body_generating, draft]
body_generating    → [body_review]
body_review        → [editing, body_generating]
editing            → [published, body_review]
published          → []   ← 終端。戻せない
```

つまり **現行スキーマには「公開済みを非公開に戻す」遷移が存在しない**。
新しい「確認ボタン」が追加する「非公開化（hide）」は、この VALID_TRANSITIONS に対する新機能である。

### 5-2. 記事を非公開にした時 — 他記事への波及は？

**自動クリーンアップは発生しない。**

- `related_articles` は JSONB で各記事に "push" 済みの静的スナップショット。
- 非公開化時に他記事の `related_articles` から当該 `href` を取り除く処理は **どこにも書かれていない**。
- `fetchPublishedArticleCards()` は将来の再計算時に non-published を除外するが、
  それは「次に再計算が走った時」初めて反映される（pull 型ではなく **push 型キャッシュ**）。
- 結果として非公開にした記事の `/column/<slug>/` へのリンクと
  `/column/<slug>/images/hero.jpg` のサムネが、本番サーバ上の他記事から残り続ける。
- 本番HTMLはFTP上の静的ファイルなので、仮にDBの `related_articles` を更新しても、
  HTML再生成 + 再FTPアップロードをしない限り見た目は変わらない。

### 5-3. 新たに公開した記事 — 既存記事の関連記事は更新される？

**DBレベルでは更新される。HTMLレベルでは更新されない。**

- `transition/route.ts` と `queue/process/route.ts` の公開フローで
  `updateAllRelatedArticles()` が走る → 全 published 記事の `related_articles` JSONB が書き換わる。
- しかし **本番の `index.html` に反映するにはFTP再アップロードが必要**。
  - `/api/articles/[id]/deploy` を個別 or `全記事デプロイ` ボタン等で再実行しないと、
    本番サーバ上のHTMLは古い関連記事のまま。
  - 「関連記事を一括更新」ボタン自体もDB更新のみで、FTPは再実行しない。
- SSR (`/column/[slug]` 開発プレビュー) は都度DBを読むので即座に反映される。

---

## 6. 可視性変更で再生成が必要なファイル一覧

記事1件の可視性が変わった時、理論上ステイルになる可能性のあるファイル:

| 種別 | パス | 更新が必要な条件 |
|---|---|---|
| DB | `articles.related_articles` (全 published 行) | 候補集合が変わる → 再計算が要る |
| FTP 本番HTML | `harmony-mc.com/column/<他slug>/index.html` | 関連記事ブロックに当該記事への `<a href>` とサムネ `<img>` が埋まっている行すべて |
| FTP ハブHTML | `harmony-mc.com/column/index.html` | 当該記事カードの掲載/非掲載。関連記事ブロックは無いが一覧自体が要更新 |
| ローカル静的エクスポート | `out/column/<他slug>/index.html` | 同上（`exportArticleToOut`） |
| ローカル静的ハブ | `out/column/index.html` | 同上（`exportHubPageToOut`） |
| Next.js SSR | `/column/[slug]` | 再生成不要（毎回DBをpull） |

影響を受ける他記事を特定するクエリ例（実装されていない）:

```sql
select id, slug from articles
 where status = 'published'
   and related_articles::jsonb @> '[{"href":"/column/<対象slug>/"}]'::jsonb;
```

---

## 7. まとめ — 「確認ボタン」設計時の論点

1. **VALID_TRANSITIONS に逆遷移が無い**。非公開化は新ステータス追加 or `reviewed_at`/別フラグでの実装が必要。
2. 候補集合判定は `status = 'published'` のみ（`auto-related.ts:41`）。
   新フラグ（例: `is_visible`, `hidden_at`）を導入する場合、ここと `static-exporter.ts:186`、
   `hub/deploy` の "published記事取得" 箇所を同じフィルタに揃える必要がある。
3. **push 型キャッシュ**である以上、可視性変更は必ず以下を連鎖させる必要がある:
   - a) `updateAllRelatedArticles()` で DB 再計算
   - b) 影響を受けた他記事HTMLを再生成 (`generateArticleHtml`)
   - c) FTP で該当 `index.html` を再アップロード（＋ハブ）
4. 「関連記事を一括更新」ボタンは現在 (a) しか行わない。
   確認ボタンで非公開/公開を切り替えるなら、(a)+(b)+(c) を同時に担うか、
   あるいは「ボタン押下 → DB更新 → "再デプロイが必要です" バナー」UXにするかの決断が要る。
