# Zero-Gen Stage2 投入 失敗ログ — 2026-05-01

実行: `npx tsx scripts/ops/zero-gen-stage2-onwards.ts --id=cc1d079a-743d-4ee8-8305-dba89f4e02dc`

## 進行と各 Stage の結果（再実行で再現可）

| Stage | 結果 | 備考 |
|---|---|---|
| Article load | ✅ | title="[ゼロ生成テスト] 人間関係とソウルメイト × 和子" / theme/persona resolved |
| RAG retrieve | ⚠️ skipped | `text-embedding-004` が v1beta で 404（後述 Bug A） |
| Stage2 writing | ✅ | body 5,535 chars / Gemini 3.1 Pro / completion 2528 tok |
| Hallucination | ⚠️ partial | claim-extractor が MAX_TOKENS 切断（後述 Bug B）→ claims=0 / score=100 |
| Tone | ✅ | total=0.757 / passed=undefined |
| Image prompts | ✅ | hero/body/summary 全て populate |
| **DB UPDATE** | ❌ **FAIL** | `Could not find the 'html_body' column of 'articles' in the schema cache`（後述 Bug C） |

## Bug A: text-embedding-004 が 404

```
Gemini Embedding API error 404: {
  "error": {
    "code": 404,
    "message": "models/text-embedding-004 is not found for API version v1beta, or is not supported for embedContent."
  }
}
```

- 場所: `src/lib/ai/embedding-client.ts:122` / `src/lib/rag/retrieve-chunks.ts:229`
- 影響: RAG が常に空チャンクで継続（source_chunks に grounding が無いだけで本フローはブロックしない）
- 対応案: `EMBEDDING_MODEL_DEFAULT` を `gemini-embedding-001` 等の現行モデル名に更新（次サイクル）

## Bug B: claim-extractor MAX_TOKENS 切断

```
[claim-extractor.gemini_failed] AI出力がトークン上限で切り捨てられました。再試行してください。
  at extractClaims (src/lib/hallucination/claim-extractor.ts:206)
```

- ハルシネ判定は claims=[] のまま継続し score=100 を返す
- 真にゼロハルシネだったかは確認できていない（claim 抽出自体が失敗したため）
- 対応案: claim-extractor の `maxOutputTokens` を 8000→16000 以上に拡張、または body を分割して抽出

## Bug C: html_body 列が存在しない（致命的）

```
UPDATE failed: Could not find the 'html_body' column of 'articles' in the schema cache
```

- 本番 articles テーブル列 (確認済): `stage2_body_html`, `stage3_final_html`, `image_files`, `image_prompts` … `html_body` は **無い**
- migrations grep で `html_body` 定義 0 件 → 過去マイグレでも作られていない
- **波及:** `src/app/api/articles/zero-generate-full/route.ts:332` の `insertZeroArticle` も同列に書込しており、本番呼出すれば同じ 500 エラーが出る隠れバグ
- 対応: Stage2 継続スクリプト + `insertZeroArticle` から `html_body` を削除（`stage2_body_html` だけで十分）

## 中間成果（DB に未反映）

- Stage2 body HTML 5,535 chars（CTA + claim spans 完備）
- hallucination_score: 100（要再検証）
- yukiko_tone_score: 0.7572815533980582
- image_prompts: hero/body/summary 完備

## 次アクション

1. 本ファイルでバグ A/B/C 文書化（完了）
2. `scripts/ops/zero-gen-stage2-onwards.ts` から `html_body` 削除（致命的修正）
3. 同件で `src/app/api/articles/zero-generate-full/route.ts:332` も修正
4. 再実行（Stage2 + tone + image prompts 投入、ハルシネは不完全のまま受容）
5. 後日: Bug A（embedding model）と Bug B（claim-extractor token）に着手
