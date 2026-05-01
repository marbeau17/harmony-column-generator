# Zero-Generation 構造化ログ規約

Zero-Generation パイプラインの構造化ログ規約。`[<scope>.<event>]` 形式で出力され、grep / jq で時系列追跡できる。各 stage は `.begin` / `.end` の対称ペアで囲まれ、`elapsed_ms` などの計測キーが `.end` に付与される。本ドキュメントは記事生成・検証・永続化までのログキー全量を index 化し、運用時のトラブルシュート手順をまとめたものである。

---

## 1. ログキー一覧

### 1.1 Stage2 CLI (`scripts/ops/zero-gen-stage2-onwards.ts`)

| キー | 意味 | 主な payload |
|------|------|--------------|
| `[zero-gen.stage2.start]` | CLI 起動 | `article_id`, `argv` |
| `[zero-gen.stage2.article_loaded]` | 対象記事 DB 取得完了 | `article_id`, `title`, `status` |
| `[zero-gen.stage2.refs_resolved]` | 参考記事の解決 | `ref_count`, `ref_ids` |
| `[zero-gen.stage2.rag.begin]` / `.end]` | RAG retrieval | `chunks`, `elapsed_ms` |
| `[zero-gen.stage2.writing.begin]` / `.end]` | 本文生成 | `body_chars`, `elapsed_ms` |
| `[zero-gen.stage2.hallucination.begin]` / `.end]` | ハルシネ検査全体 | `claims`, `pass`, `elapsed_ms` |
| `[zero-gen.stage2.tone.begin]` / `.end]` | トーン検査 | `score`, `centroid_dist`, `elapsed_ms` |
| `[zero-gen.stage2.image.end]` | 画像生成完了 | `hero`, `body`, `summary` |
| `[zero-gen.stage2.db.update.begin]` / `.end]` | articles UPDATE | `article_id`, `elapsed_ms` |
| `[zero-gen.stage2.persist_claims.end]` | claims 永続化 | `inserted` |
| `[zero-gen.stage2.persist_tone.end]` | tone 永続化 | `inserted` |
| `[zero-gen.stage2.revision_snapshot.end]` | 履歴 INSERT | `revision_id` |
| `[zero-gen.stage2.done]` | CLI 正常終了 | `total_elapsed_ms`, `ok` |

### 1.2 Production Route (`src/app/api/articles/zero-generate-full/route.ts`)

| キー | 意味 | 主な payload |
|------|------|--------------|
| `[zero-gen.full.request.begin]` / `.end]` | リクエスト全体 | `request_id`, `elapsed_ms` |
| `[zero-gen.full.auth.ok]` | 認証通過 | `user_id`, `email_masked` |
| `[zero-gen.full.body.validated]` | 入力バリデート | `body_keys` |
| `[zero-gen.full.refs.resolved]` | 参考記事解決 | `ref_count` |
| `[zero-gen.full.outline.begin]` / `.end]` | アウトライン生成 | `sections`, `elapsed_ms` |
| `[zero-gen.full.rag.end]` | RAG 取得完了 | `chunks`, `elapsed_ms` |
| `[zero-gen.full.writing.begin]` / `.end]` | 本文生成 | `body_chars`, `elapsed_ms` |
| `[zero-gen.full.validation.begin]` | 検証フェーズ開始 | — |
| `[zero-gen.full.hallucination.result]` | ハルシネ検査結果 | `pass`, `claim_total`, `failed` |
| `[zero-gen.full.tone.result]` | トーン結果 | `score`, `pass` |
| `[zero-gen.full.image.end]` | 画像生成 | `hero`, `body`, `summary` |
| `[zero-gen.full.db.insert.begin]` / `.end]` | articles INSERT | `article_id`, `elapsed_ms` |
| `[zero-gen.full.persist.claims]` | claims 永続化 | `inserted` |
| `[zero-gen.full.persist.cta]` | CTA 永続化 | `inserted` |
| `[zero-gen.full.persist.tone]` | tone 永続化 | `inserted` |
| `[zero-gen.full.persist.revision]` | 履歴 INSERT | `revision_id` |

### 1.3 Hallucination (`src/lib/hallucination/`)

| キー | 意味 | 主な payload |
|------|------|--------------|
| `[hallucination.run-checks.begin]` / `.end]` | ランナー全体 | `pass`, `elapsed_ms` |
| `[hallucination.claims_extracted]` | 主張抽出完了 | `count` |
| `[hallucination.validator.end]` | 各 validator 終了 | `name=factual\|attribution\|spiritual\|logical`, `elapsed_ms`, `pass` |
| `[hallucination.factual.begin]` / `.end]` | 事実検査 | `claim_id`, `verdict` |
| `[hallucination.attribution.begin]` / `.end]` | 帰属検査 | `claim_id`, `verdict` |
| `[hallucination.spiritual.begin]` / `.end]` | スピリチュアル検査 | `claim_id`, `verdict` |
| `[hallucination.logical.begin]` / `.end]` | 論理整合 | `pairs`, `verdict` |
| `[hallucination.logical.pair_checked]` | 1 ペア検査 | `i`, `j`, `consistent` |
| `[claim-extractor.begin]` / `.end]` | 主張抽出器 | `body_chars`, `claims`, `elapsed_ms` |

### 1.4 Tone (`src/lib/tone/`)

| キー | 意味 | 主な payload |
|------|------|--------------|
| `[tone.run-checks.begin]` / `.end]` | ランナー | `score`, `pass`, `elapsed_ms` |
| `[tone.yukiko_scoring.computed]` | 由起子スコアリング | `score`, `breakdown` |
| `[tone.centroid.computed]` | セントロイド距離 | `distance`, `vector_dim` |

### 1.5 Gemini client + Embedding (`src/lib/ai/`)

| キー | 意味 | 主な payload |
|------|------|--------------|
| `[gemini.request.begin]` | API 呼び出し開始 | `model`, `max_tokens` |
| `[gemini.success]` | 正常応答 | `tokens_in`, `tokens_out`, `thinking_tokens`, `elapsed_ms` |
| `[gemini.thinking_dominant]` | thinking が出力を圧迫 | `thinking_ratio`, `output_tokens` |
| `[gemini.json_truncated]` | JSON 出力が途切れた | `last_chars` |
| `[gemini.embed.begin]` | embedding 開始 | `text_len`, `version` |
| `[gemini.embed.success]` | embedding 成功 | `dim`, `version` |
| `[gemini.embed.version_fallback]` | v1→v1beta 等のフォールバック | `from`, `to`, `reason` |
| `[gemini.embed.final_failure]` | 全 version で失敗 | `error_message` |

### 1.6 RAG / DB / Persist

| キー | 意味 | 主な payload |
|------|------|--------------|
| `[rag.retrieve-chunks.begin]` / `.end]` | チャンク検索 | `query_len`, `top_k`, `chunks`, `elapsed_ms` |
| `[image-prompt.begin]` / `.end]` | 画像プロンプト生成 | `kind=hero\|body\|summary`, `elapsed_ms` |
| `[persist.claims.begin]` / `.end]` | claims 永続化 | `count`, `elapsed_ms` |
| `[persist.tone.begin]` / `.end]` | tone 永続化 | `score`, `elapsed_ms` |
| `[persist.cta.begin]` / `.end]` | CTA 永続化 | `count`, `elapsed_ms` |
| `[cta-generator.begin]` / `.end]` | CTA 生成 | `placements`, `elapsed_ms` |
| `[db.articles.create.begin]` / `.end]` | INSERT | `article_id`, `elapsed_ms` |
| `[db.articles.update.begin]` / `.end]` | UPDATE | `article_id`, `elapsed_ms` |
| `[db.articles.update.guard_blocked]` | 改変ガードでブロック | `article_id`, `reason` |

---

## 2. 共通規約

- 開始/終了 ペアは `.begin` / `.end` で対称に出す（片方だけ出さない）
- `elapsed_ms` は同名 stage の begin→end で計測（`Date.now()` 差分）
- エラーは `ok: false` + `error_message` を `.end` 側に付与
- スコープ階層は `<area>.<subscope>.<event>`（例: `zero-gen.stage2.writing.end`）
- 機密情報（API key 等）は出力禁止。メールアドレスは前 3 文字＋ `***` でマスク
- thinking 消費トークンは `gemini.success` / `gemini.thinking_dominant` で観測可能

---

## 3. 実用レシピ

### 試作記事 1 件のフルログを切り出す

```
# CLI
npx tsx scripts/ops/zero-gen-stage2-onwards.ts --id=<uuid> 2>&1 | grep -E '\[zero-gen\.stage2\.'
```

### Gemini が thinking を食い過ぎていないか確認

```
... | grep -E '\[gemini\.thinking_dominant\]'
```

### どの validator が遅いか測る

```
... | grep -E '\[hallucination\.validator\.end\]'
```

### Embedding が v1 / v1beta どちらにフォールバックしたか

```
... | grep -E '\[gemini\.embed\.version_fallback\]'
```

---

## 4. 既知の制約 / Open issues

- **thinking token 消費が大きい** (`gemini-3.1-pro-preview`)。`maxOutputTokens` は実出力の 3〜5 倍を見込む。`[gemini.thinking_dominant]` が頻出する場合は上限を引き上げる。
- **claim-extractor の MAX_TOKENS リスク**: body 5,500 字超で出力が途切れる懸念あり。現状 `maxOutputTokens=24000` でカバーしているが、次サイクルで body 分割（chunked extraction）に切り替え予定。`[gemini.json_truncated]` を監視ポイントとする。
