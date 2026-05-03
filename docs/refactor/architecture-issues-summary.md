# Harmony Column Generator アーキテクチャ上の根本問題サマリ

> 作成: 2026-05-02 / 役割: Planner（read-only 分析）
> 対象: 中長期リファクタ計画の起点。各項目は P5 系チケット候補。

本ドキュメントは Harmony Column Generator のコードベースに蓄積されている
「構造的負債」を 5 領域に整理したもの。各セクションは **現状 / 根本原因 / 改善提案**
の 3 段構成で記述する。

---

## 1. string-based HTML manipulation の蓄積

### 現状
- `src/lib/content/`、`src/lib/generators/`、各種 post-process スクリプト群で
  正規表現による HTML 書き換えが多数積み重なっている。
- 「`<h2>` の前に CTA を挿入」「特定の `<p>` を削除」「`""` を全角に置換」など
  目的別のワンショット regex が並列に走り、実行順依存が暗黙化している。
- `scripts/` 配下に 30 本超のアドホック修復 CLI があり、同様の正規表現を再実装している。

### 根本原因
- HTML を木構造ではなく**文字列**として扱う設計が初期から続いている。
- AI 出力ゆらぎ（タグ閉じ忘れ・空白差分）が直接 regex を破壊するが、
  パース層を挟まないため、ゆらぎ吸収を全部 regex 側で吸収する羽目になっている。

### 改善提案
- `htmlparser2` ＋ `cheerio` を統一パース層として導入し、
  すべての post-process を「DOM transform pipeline」として再実装。
- 既存 regex 処理を `transformers/*.ts` に 1:1 で移植し、ユニットテスト化。
- 新規 HTML 編集は **regex 直書き禁止** を ESLint custom rule で強制。

---

## 2. state の二系統並立 (publish-control)

### 現状
- `articles.reviewed_at`（旧フラグ）と `articles.visibility_state`（新ステートマシン）が
  併存しており、P5-43 で読み取り側の一部を `visibility_state` 一本化済み。
- ただし publish-control の **Step 4 (revision diff)** と **Step 5 (取り下げ)** は
  まだ `reviewed_at` を参照する経路が残っている。
- ダッシュボード一覧と単記事 API でフラグの読み方が微妙に異なり、
  「公開済みなのに未レビュー扱い」「reviewed なのに非公開」など UI 不整合が発生する。

### 根本原因
- 状態遷移を一気に切り替えず、「既存運用を壊さないため」両系統を残した結果、
  書き込み側だけ二重化されたまま読み取り側の収束が後回しになっている。
- `reviewed_at` は timestamp（NULL or 値）、`visibility_state` は enum で、
  セマンティクスがそもそも一致しない。

### 改善提案
- Step 4/5 を `visibility_state` 専用に書き換え、`reviewed_at` は
  「最後にレビューした時刻」のメタデータに格下げ（公開判定には使わない）。
- マイグレーションで残存する `reviewed_at` 参照を grep + 静的解析で全列挙し、
  P5-XX 単発チケットで一括コミット。
- 状態遷移図を `docs/publish-control-unification.md` に追記し、
  enum を single source of truth とする。

---

## 3. AI 出力変動の吸収不足

### 現状
- Stage1 (キーワード/構成) と Stage2 (本文生成) のプロンプト出力は
  AI モデルバージョン・温度・乱数によって構造が揺れる。
- 一部ルートでは `zod` による schema validation + 自動修復ループが入っているが、
  生成系の半数以上はベタ JSON.parse のみで、失敗時は throw して終わる。
- P5-13/P5-15 で 4 形態正規化など局所修復は入ったが、Stage 全体での統一はない。

### 根本原因
- スキーマ定義が「呼び出し側ファイル内」に散在し、共通化されていない。
- 自動修復ロジック（リトライ・部分パース・LLM-fix-pass）が個別実装で、
  ベストプラクティスの横展開がされていない。

### 改善提案
- `src/lib/ai/schemas/` に Stage1/Stage2 等の **zod スキーマを集約**。
- 共通の `parseWithRepair(input, schema, opts)` ユーティリティを実装。
  - 1st pass: 直接 parse / 2nd pass: 構造修復 / 3rd pass: LLM 再投入
- 全 AI 呼び出しを当該ユーティリティ経由に統一し、失敗率をメトリクス化。

---

## 4. silent failure の蔓延

### 現状
- 管理ダッシュボードの fetch 失敗が UI に出ず、空配列として描画される箇所が複数。
- P5-51 で「記事一覧」の silent failure 1 件は対処済だが、
  キーワード提案・revision diff・関連記事プレビュー等で同種の握り潰しが残っている。
- API ルートの try/catch も `console.error` のみで `Sentry` 等に飛ばないものがある。

### 根本原因
- React コンポーネントの `useEffect` 内 fetch でエラーバウンダリが整備されておらず、
  `setState(null)` フォールバックが「正常な空状態」と区別不能になっている。
- API 側のエラーレスポンスフォーマットが統一されておらず、UI 側で discriminated union
  で扱えていない。

### 改善提案
- `useFetch` 共通フック（`{ data, error, loading }` を必ず返す）に統一し、
  個別の `useEffect + fetch` を全面置換。
- API エラーレスポンスを `{ ok: false, code, message }` 形式に統一。
- `ErrorBoundary` をダッシュボードのレイアウトレベルで強制適用し、
  Sentry へ自動転送（既設定の DSN を再利用）。

---

## 5. deployment verification 不足

### 現状
- 本番デプロイ後の自動検証は `scripts/smoke-*` 系のみで、
  対象は管理 app（Vercel 上の Next.js）に限定されている。
- 公開先である **harmony-mc.com の記事 HTML** が
  デプロイ後に正しく書き換わったかをチェックする仕組みが無い。
- 過去に「FTP 反映成功 → 実 HTML が古いまま」というインシデントが
  人手発見になっているケースが複数。

### 根本原因
- デプロイパイプラインが「上流（admin app）」と「下流（harmony-mc.com 静的 HTML）」で
  分断され、後者の検証責任者がいない。
- smoke テストが「200 OK」までしか見ておらず、内容ハッシュや構造アサーションが無い。

### 改善提案
- `scripts/verify-public-html.ts` を新設し、
  対象記事の URL を fetch → cheerio で構造検証 → 期待ハッシュと比較。
- デプロイ完了通知 (Slack/メール) のトリガーを「smoke pass」から
  「smoke pass + public verify pass」の AND に変更。
- 失敗時は visibility_state を自動で `degraded` に落とし、再デプロイを促す。

---

## 優先度サジェスト（Planner 私見）

| # | 領域 | 影響範囲 | 推奨着手順 |
|---|------|----------|------------|
| 4 | silent failure | 運用品質 | 最優先（小さく刻める） |
| 2 | publish-control state | データ整合性 | 高（Step 4/5 残作業） |
| 5 | deployment verify | 障害検知 | 高（インシデント実例あり） |
| 3 | AI 出力変動 | 生成成功率 | 中（局所対処は済） |
| 1 | string-based HTML | リファクタ全般 | 中長期（規模が大きい） |
