# バッチ・ゼロ生成 (P5-21) 仕様書

**Author:** Planner
**Date:** 2026-05-02
**Scope:** 5〜10 記事を一気にゼロ生成する UI + API + バナー拡張。
P5-20 案B (`zero-generate-async` + `useGenerationJob` + `<GenerationProgressBanner>`) の基盤を再利用し、複数ジョブの並列管理を追加する。

---

## 1. 背景と目的

### 1.1 現状
- ゼロ生成は 1 記事ずつ POST `/api/articles/zero-generate-async`
- フォームで選択 → 即返 → SSE 進捗バナー → 完了通知
- **複数記事を一気に投入する UI なし**

### 1.2 ゴール
1. 1 画面で **N 行 (最大 10)** の生成依頼を入力可能なフォーム
2. POST `/api/articles/zero-generate-batch` で **batch_id** + N 個の job_id を一括取得
3. グローバルバナーが **N 件の集計** で進捗表示 (例: "📝 3/10 完了、4 件処理中、3 件待機")
4. 各 job 個別の完了通知 + バッチ全体完了通知
5. **コスト見積**を投入前に表示 (`$0.18 × N`)

### 1.3 非ゴール
- 真のキュー管理 (Vercel function 制約のため、3 件並列が現実的上限)
- バッチの中断・再開
- バッチごとの記事一覧フィルタ (v2)

---

## 2. アーキテクチャ

### 2.1 並列度の決定
Vercel function は 1 リクエストあたり最大 300 秒。  
Gemini API のレート制限 + 90 秒/記事 を考慮し、**並列度 = 3** で固定。  
それ以上は queue で逐次実行 (各 async route 起動間に 200ms 待機)。

```
batch route (1 function call)
  ├─ Job 1: zero-generate-async kick (waitUntil)  ─┐
  ├─ Job 2: zero-generate-async kick (waitUntil)  ─┼─ 並列度 3
  ├─ Job 3: zero-generate-async kick (waitUntil)  ─┘
  ├─ Job 4: setTimeout 後に kick
  └─ ...
```

実装上は内部 `fetch /api/articles/zero-generate-async` を N 回 (200ms 間隔) で kick して即返。各 async route が waitUntil で本体処理を継続。

### 2.2 API 設計

#### `POST /api/articles/zero-generate-batch`

**Body:**
```jsonc
{
  "jobs": [
    {
      "theme_id": "uuid",
      "persona_id": "uuid",
      "keywords": ["タロット", "初心者"],
      "intent": "info",
      "target_length": 2000
    },
    // ... 最大 10 件
  ]
}
```

**Response (即返 ~200ms × N + 並列起動):**
```jsonc
{
  "batch_id": "uuid",
  "jobs": [
    { "index": 0, "job_id": "uuid", "status": "queued" },
    { "index": 1, "job_id": "uuid", "status": "queued" }
    // ...
  ]
}
```

**バリデーション:**
- jobs: 最低 1 件、最大 10 件
- 各 job: 既存 `zeroGenerateRequestSchema` を流用

### 2.3 フック拡張

新フック `useGenerationJobs()` (複数版):
- `localStorage` キー: `blogauto.activeGenerationJobs` (配列)
- 各 job_id ごとに EventSource を購読 (最大 10 並列)
- 集計値: `summary = { total, done, failed, in_progress, queued }`
- 個別 job の詳細リストも保持

既存 `useGenerationJob` (単一版) は **後方互換のため残す** が、新規 UI からは `useGenerationJobs` を使う。

### 2.4 バナー拡張

`<GenerationProgressBanner>` を 2 モードに:
- **単一モード** (既存): job 1 つだけのとき、現状のプログレス表示
- **集計モード** (新): job 複数のとき
  ```
  📝 5/10 完了、3 件進行中、2 件待機  [詳細▼] [閉じる]
  ```
  - 詳細クリックで dropdown 表示 (各 job のタイトル/状態/article_id)

### 2.5 UI ページ

`/dashboard/articles/batch-zero-generate/page.tsx`:
- ヘッダ: タイトル + 説明
- 入力テーブル (各行 = 1 ジョブ):
  | 行 | テーマ | ペルソナ | キーワード | 意図 | 文字数 |
  |---|---|---|---|---|---|
  | 1 | select | select | chip | radio | input |
  | + 行追加 (最大 10 行)
- クイックテンプレ:
  - 「全 7 ペルソナ × 同テーマ」: テーマ 1 つ選択 → 全ペルソナ 7 行が自動生成
  - 「同ペルソナ × N キーワード」: ペルソナ + キーワード配列 → N 行生成
- コスト見積: `合計 N 件 × $0.18 = $X.XX`
- 「バッチ投入」ボタン → 確認ダイアログ → POST

---

## 3. 実装計画 (20 並列)

| # | ファイル | 内容 | 並列可? |
|---|---|---|---|
| F1 | `docs/batch-zero-generation-spec.md` | 本ファイル | ✅ |
| F2 | `src/lib/validators/batch-zero-generate.ts` | zod スキーマ | ✅ |
| F3 | `src/app/api/articles/zero-generate-batch/route.ts` | バッチ API | F2 後 |
| F4 | `src/hooks/useGenerationJobs.ts` | 複数版フック | ✅ |
| F5 | `src/components/articles/GenerationProgressBanner.tsx` | 集計モード追加 | F4 後 |
| F6 | `src/app/(dashboard)/dashboard/articles/batch-zero-generate/page.tsx` | フォーム UI | F2/F4 後 |
| F7 | `scripts/ops/batch-image-generate.ts` | CLI 画像バッチ (auth 不要) | ✅ |
| F8 | `test/unit/batch-zero-generate-validator.test.ts` | zod テスト | F2 後 |
| F9 | `test/unit/useGenerationJobs.test.tsx` | 複数 hook テスト | F4 後 |
| F10 | `docs/progress.md` 追記 | F1-F9 後 |

---

## 4. 受入基準

- AC-1: フォームで 5 行投入 → 5 個の job_id が返る
- AC-2: バナーに「5/5 待機 → 5/5 完了」推移が見える
- AC-3: 各 job 完了で個別 toast、全完了で「バッチ完了」toast
- AC-4: 並列度 3 で起動 (それ以上は順次 200ms 間隔で kick)
- AC-5: コスト見積が「合計 N 件 × $0.18 = $X.XX」と正確に表示
- AC-6: 既存 `useGenerationJob` と並行運用しても干渉しない
- AC-7: localStorage に保存され、タブを閉じて開き直しても復帰
- AC-8: `npx tsc --noEmit` 0 errors / `npx vitest run` 全 PASS
- AC-9: バッチ投入時に確認ダイアログでコストとジョブ件数を提示

---

## 5. リスクと緩和

| リスク | 緩和策 |
|---|---|
| Vercel function timeout (300s) | 並列 3 + 200ms 間隔の kick で 1 batch route は 数秒以内に終了 |
| Gemini API レート制限 | 並列 3 を上限。10 件投入時は約 5 分で全完了 |
| コスト暴走 | 確認ダイアログで「$X.XX 消費されます」を明示 |
| job_id を見失う | localStorage に永続化、60 分以内なら復帰 |
| 一部 job 失敗 | バナーで個別表示、再投入ボタンを失敗 job 横に出す (v2) |

---

## 6. v2 候補

- バッチごとの記事一覧フィルタ (`articles?batch_id=xxx`)
- 失敗 job の自動リトライ
- バッチ進捗の専用ダッシュボード
- CSV インポートからのバッチ投入
- スケジュール実行 (毎週日曜にバッチ)
