# source_chunks 初期 embedding ドライラン手順書

**Date:** 2026-05-01
**Owner:** Zero-Generation V1 / RAG パイプライン
**Status:** 本番投入前（本番 `source_chunks` は 0 件）

---

## 1. 目的

本番 Supabase の `source_chunks` テーブルへ、`source_articles`（小林由起子さん旧アメブロ約 1,499 記事）の chunk + 768 次元 embedding を一括投入する **初回バッチの手順を確定** する。実行前に必ず本ドキュメントの「ドライラン」と「サンプル実投入」を経由し、本投入を行う。

関連: [コスト分析](./cost-analysis.md) §4

---

## 2. 対象ファイル / スクリプト

実装は既に存在する（H11 で投入済み）。新規作成は不要。

| 役割 | 絶対パス |
|---|---|
| CLI エントリ（resumable / dry-run / cost report） | `/Users/yasudaosamu/Desktop/codes/blogauto/scripts/embed-all-source-chunks.ts` |
| chunk 化 + 1 記事 embed コアロジック | `/Users/yasudaosamu/Desktop/codes/blogauto/src/lib/rag/embed-source-chunks.ts` |
| Gemini `text-embedding-004` クライアント | `/Users/yasudaosamu/Desktop/codes/blogauto/src/lib/ai/embedding-client.ts` |
| 検索側（参照のみ） | `/Users/yasudaosamu/Desktop/codes/blogauto/src/lib/rag/retrieve-chunks.ts` |
| pgvector + ivfflat 定義 | `/Users/yasudaosamu/Desktop/codes/blogauto/supabase/migrations/20260501000000_zero_generation_v1.sql` |

### 主要パラメータ（コード参照済み・改変禁止）

- chunk 戦略: 段落分割（空行区切り）→ 段落超過時のみ sliding window
- `windowTokens = 400`, `overlapTokens = 50`（`splitIntoChunks` 既定値）
- 文字長換算: `1.5 chars/token` で stride 計算
- embedding モデル: `text-embedding-004`（`EMBEDDING_MODEL_DEFAULT`）
- 次元: **768**（`EMBEDDING_DIMENSIONS` 固定。Gemini 応答が異なれば warn ログを残し継続）
- task_type: index 時 `RETRIEVAL_DOCUMENT`、`title` を Gemini に送る
- 重複排除: chunk_text の SHA-256 を `content_hash` に格納し、既存ハッシュと一致したら skip（記事 id × hash で判定。再実行可能）

---

## 3. 推定コスト

[`docs/cost-analysis.md` §4](./cost-analysis.md) より引用:

- 平均 3 chunks/記事 × 1,499 記事 ≒ **約 5,000 chunks**
- 平均 350 token/chunk → **約 1.75M tokens**
- `text-embedding-004` 単価 $0.025 / 1M tokens → **初回約 $0.05 USD**
- 月次差分 re-embed: $0.001 程度

CLI 自身も `estimateCost` で同等の試算を出力するので、ドライラン時の数値が想定範囲（$0.04〜$0.10）であることを確認する。

---

## 4. 推定実行時間（オーダー）

- API 1 回 ≒ 200〜500ms（Gemini embedding、リージョン依存）
- batchSize=10 並列 → 約 50ms/chunk 換算
- 5,000 chunks × 50ms ≒ **約 4〜5 分**（理論下限）
- 実際にはレート制限・リトライで余裕を見て **15〜30 分** を目安。

---

## 5. ドライラン手順（10 件サンプル）

### 5-1. ロジックのみ（API 課金ゼロ）

```bash
tsx scripts/embed-all-source-chunks.ts --limit=10 --dry-run --confirm --verbose
```

確認項目:

- `cost estimate` ログに `articles=10`, `chunks` が表示される
- `chunks` が `articles × 平均3` 前後（おおむね 20〜40）
- Gemini 呼び出しが発生しない（`gemini.embed.success` ログが出ない）
- 終了コード 0

### 5-2. 10 件で実 INSERT（本番に近いリハーサル）

```bash
# 環境変数チェック
echo "URL=${NEXT_PUBLIC_SUPABASE_URL:?missing}"
echo "KEY=${SUPABASE_SERVICE_ROLE_KEY:+set}"
echo "GEMINI=${GEMINI_API_KEY:+set}"

# サンプル投入
tsx scripts/embed-all-source-chunks.ts --limit=10 --batch-size=5 --confirm --verbose
```

確認項目:

| 観測対象 | 期待値 |
|---|---|
| `chunk count` | 10 記事で 20〜40 chunks |
| embedding dim | 全件 768（warn `gemini.embed.unexpected_dims` が 0） |
| INSERT 成功率 | 100%（`errors=0`） |
| `tmp/embed-progress.json` | `completedArticleIds.length === 10` |
| `source_chunks` 行数 | 投入前 + 20〜40 |

検証 SQL（10 件ぶんに限定）:

```bash
npx supabase db query --linked "
  SELECT count(*) AS chunks,
         count(DISTINCT source_article_id) AS articles,
         avg(array_length(string_to_array(content_hash, ''), 1)) AS hash_len
  FROM source_chunks;"
```

`embedding` 次元の単発確認:

```bash
npx supabase db query --linked "
  SELECT vector_dims(embedding) AS dim
  FROM source_chunks LIMIT 1;"
```

期待値: `dim = 768`。

### 5-3. 再実行可能性（idempotency）

```bash
# 同コマンドをもう一度。skipped が今度は ~全件、inserted=0 になるはず
tsx scripts/embed-all-source-chunks.ts --limit=10 --batch-size=5 --confirm --verbose
```

`skippedChunks` が前回 inserted と一致 / `insertedChunks=0` を確認。

---

## 6. 本番実行手順（1499 件）

### 6-1. 事前チェック

1. 環境変数:
   - `NEXT_PUBLIC_SUPABASE_URL`（本番 URL）
   - `SUPABASE_SERVICE_ROLE_KEY`（本番 service role）
   - `GEMINI_API_KEY`（課金有効なキー）
2. マイグレ確認: `source_chunks` テーブルと ivfflat インデックスが本番に適用済み
   ```bash
   npx supabase db query --linked "SELECT count(*) FROM source_chunks;"  # 0
   npx supabase db query --linked "SELECT indexname FROM pg_indexes WHERE tablename='source_chunks';"
   ```
3. `source_articles` 件数:
   ```bash
   npx supabase db query --linked "SELECT count(*) FROM source_articles;"  # ≒ 1499
   ```
4. **論理バックアップ**（万一の取り直し用、空テーブルなのでスナップショットで十分）:
   ```bash
   npx supabase db dump --linked -f tmp/backup-pre-embed.sql --data-only -t source_chunks
   ```
5. ストレージ容量: 5,000 行 × (chunk_text 数 KB + 768 floats ≒ 6 KB) ≒ **約 50〜80 MB** を見込む。

### 6-2. 投入

```bash
tsx scripts/embed-all-source-chunks.ts \
  --batch-size=10 \
  --progress-every=50 \
  --resume \
  --confirm \
  --verbose \
  2>&1 | tee tmp/embed-source-chunks-$(date +%Y%m%d-%H%M).log
```

- `--batch-size=10`: Gemini 並列度。レート制限（429）が出たら **5 → 3** に段階的に下げる。
- `--resume`: `tmp/embed-progress.json` から再開可能。中断・再投入で重複が起きない（`content_hash` でも二重防衛）。
- 開始時の確認 prompt は `--confirm` で skip（CI でも動く）。

### 6-3. レート制限対策

- 429 が出ても `embedding-client.ts` 内で 1 回リトライ（指数バックオフ 1s → 2s）
- 連続 429 が観測されたら一旦 Ctrl+C → `--batch-size=3` で再起動（`--resume` 効きます）
- Free tier は 1 分あたり制限が厳しいので、課金有効なキーを必ず使う

### 6-4. 再実行可能性

- 中断: いつでも Ctrl+C してよい。`tmp/embed-progress.json` がバッチごとに更新される
- 再開: 同じコマンドに `--resume` を付けるだけ
- 手動で 1 記事だけやり直したい: 該当 `source_chunks` を DELETE → `tmp/embed-progress.json` から該当 id を除外 → 再実行

---

## 7. ロールバック手順

### 7-1. 全量ロールバック（やり直し）

```sql
-- pgvector ivfflat インデックスは保持（再 INSERT で再構築される）
TRUNCATE TABLE source_chunks RESTART IDENTITY CASCADE;
```

`article_claims.source_chunk_id` は `ON DELETE SET NULL` なので CASCADE しても claim 側はリセットされる（既に zero-gen を回している場合は注意）。

### 7-2. 特定記事だけロールバック

```sql
DELETE FROM source_chunks WHERE source_article_id = '<UUID>';
```

進捗ファイルも合わせて編集:

```bash
# tmp/embed-progress.json の completedArticleIds から当該 UUID を除外
```

### 7-3. 進捗ファイル破棄（クリーンスタート）

```bash
rm -f tmp/embed-progress.json
```

`source_chunks` は `content_hash` で 2 重防衛されるので、進捗ファイルだけ消しても課金が二重に発生することはない。

---

## 8. 監視 / ログ観点

実行中ログから見るべきもの:

| ログ key | 観点 |
|---|---|
| `[embed-all-source-chunks] cost estimate` | 想定 token / USD が cost-analysis.md と整合するか |
| `[embed-all-source-chunks] progress N/1499` | 1 分あたりの処理数（停滞検知） |
| `[gemini.embed.success]` | dims=768、durationMs の中央値 |
| `[gemini.embed.retry]` | 多発したら batch-size を下げる |
| `[gemini.embed.unexpected_dims]` | **1 件でも出たら停止** して原因調査 |
| `[gemini.embed.final_failure]` | 最終失敗。errors サマリで該当記事を要確認 |
| `insert failed:` | Supabase 側のエラー（PK 重複・RLS など） |

終了時:

- exit code `0`: 全件成功
- exit code `2`: 一部失敗あり（`errors[]` をログ末尾で確認）
- exit code `1`: 致命的（環境変数欠落 / 例外）

---

## 9. 完了後検証

```sql
-- 9-1. 件数とカバレッジ
SELECT
  count(*)                           AS total_chunks,
  count(DISTINCT source_article_id)  AS covered_articles,
  (SELECT count(*) FROM source_articles) AS source_total
FROM source_chunks;
-- 期待: covered_articles ≒ source_total（1499 前後）

-- 9-2. 次元検証
SELECT vector_dims(embedding) AS dim, count(*) AS n
FROM source_chunks
GROUP BY 1;
-- 期待: dim=768 のみ、他次元は 0 行

-- 9-3. NULL/空文字検出
SELECT count(*) AS null_or_empty
FROM source_chunks
WHERE embedding IS NULL OR length(chunk_text) = 0;
-- 期待: 0

-- 9-4. content_hash 重複（記事内）
SELECT source_article_id, content_hash, count(*) AS dup
FROM source_chunks
GROUP BY 1, 2
HAVING count(*) > 1;
-- 期待: 0 行

-- 9-5. ivfflat インデックス利用確認（任意）
EXPLAIN ANALYZE
SELECT id FROM source_chunks
ORDER BY embedding <=> (SELECT embedding FROM source_chunks LIMIT 1)
LIMIT 5;
-- 期待: Index Scan using idx_source_chunks_embedding
```

### 9-6. アプリ側スモーク

`match_source_chunks` RPC（`20260502000000_zero_generation_rpc.sql`）が値を返すか:

```sql
SELECT count(*) FROM match_source_chunks(
  query_embedding := (SELECT embedding FROM source_chunks LIMIT 1),
  match_threshold := 0.5,
  match_count     := 5
);
-- 期待: > 0
```

---

## 10. チェックリスト

- [ ] 5-1 ドライラン（dry-run）で chunk 数 / コスト試算が想定範囲
- [ ] 5-2 10 件サンプル投入で 768 次元 / errors=0
- [ ] 5-3 同コマンド再実行で skip のみ（idempotent 確認）
- [ ] 6-1 環境変数 / マイグレ / 件数確認 OK
- [ ] 6-2 1499 件本投入 → exit 0
- [ ] 9-1〜9-5 すべて期待値
- [ ] 9-6 RPC スモーク OK
- [ ] `tmp/embed-source-chunks-*.log` をアーカイブ

---

## 11. 備考

- npm script は **未登録**。直接 `tsx scripts/embed-all-source-chunks.ts` を叩く運用。必要なら別タスクで `package.json` の `scripts` に `"embed:source": "tsx scripts/embed-all-source-chunks.ts"` を追加してよい。
- 月次の差分再 embed は同コマンドの `--resume` を外して走らせれば、`content_hash` で skip されるため安全（コスト ~$0.001）。cron 化する場合は別タスクで検討。
