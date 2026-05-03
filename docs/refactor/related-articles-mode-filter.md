# P5-59 関連記事の mode フィルタ設計判断

## 1. 背景

ユーザー要件として「新規生成記事 (zero-generation) と書き換え記事 (rewrite) は別系統として扱い、関連記事ブロックでは同じ mode の記事だけを推薦したい」という指摘があった。これまでの自動関連記事ロジック (`auto-related.ts`) は記事 mode を区別せず、全公開記事プールから類似度順に上位 N 件を抽出していたため、新規記事の末尾に書き換え記事が混入する／その逆が発生し、由起子さん側の編集体験を損なっていた。

## 2. 設計判断: 「同 mode のみ filter」採用

候補として以下を検討した。

- A 案: スコアリングで mode 一致をボーナス加算 (soft filter)
- B 案: 取得 SQL で `mode = $current_mode` を WHERE 条件にする (hard filter) ← 採用
- C 案: UI 側で post-filter

A 案は閾値設計が必要で、件数が少ない時に他 mode が紛れ込むリスクが残る。C 案はネットワーク往復が無駄。B 案は SQL 1 行で要件を完全に満たし、結果件数の予測も明快なため採用する。実装は `fetch-published-articles.ts` のクエリビルダに `eq("mode", mode)` を追加し、`auto-related.ts` の呼び出し側で `currentArticle.mode` を引き渡す。

## 3. 実装影響範囲

- `src/lib/content/auto-related.ts`: シグネチャに `mode: ArticleMode` を追加し、候補取得関数へ伝播。
- `src/lib/db/fetch-published-articles.ts`: `mode?: ArticleMode` オプションを受けて WHERE 句に反映。既存呼び出し側 (一覧表示・サイトマップ等) は引数を渡さず従来通り全件取得を維持し、後方互換を保つ。
- 単体テストは `auto-related.test.ts` に同 mode のみ返すケースと、足りない時に空配列になるケースを追加する。

## 4. 既存記事の扱い (recompute による更新)

既存記事の `related_articles` カラムは recompute バッチで更新する。バッチは「本文・タイトル・コンテキストには触れず、`related_articles` のみ書き換える」設計とし、`article_revisions` への履歴 INSERT もこの 1 カラム差分のみ。memory ルール「明示指示なく既存記事の本文/タイトル/コンテキストを変更禁止」と「HTML 書き換え時は履歴 INSERT 必須」の両方に整合する。

## 5. 「足りない時は空欄」ルール

同 mode 内に類似記事が閾値件数に満たない場合は、無理に他 mode を補充せず関連記事ブロックを空配列のまま返す。レンダリング側はこれをハンドリングしてブロック自体を非表示にする (既存挙動を踏襲)。これは「足りない時は空欄」memory ルールおよびハルシネーション防止方針と整合する判断であり、推薦品質を量より優先する。
