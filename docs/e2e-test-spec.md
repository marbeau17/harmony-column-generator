# Zero-Generation E2E テスト仕様書 (P5-22)

**Author:** Planner
**Date:** 2026-05-02
**Scope:** 「他画面に移動できる非同期生成」「バッチ生成」「画像反映」を含む全エンドツーエンドのテストケースを定義し、本番投入前の品質ゲートとする。

---

## 1. 既知の課題

### 1.1 fs ベース job-store の限界
P5-20 で導入した `zero-gen-job-store` は `os.tmpdir()` (Vercel `/tmp`) に書き出し。
**Vercel function instance 間で `/tmp` は共有されない**ため、

```
[POST /zero-generate-async] (instance A)
  └ createJobState → A の /tmp に書込
  └ waitUntil(internal fetch) → A で実行

[GET /[job_id]/progress] (instance B, SSE)
  └ getJobState → B の /tmp は空 → null → 404 "job not found"
```

これが「job not found」エラーの真因。

### 1.2 解決策: Supabase 共有ストア化
新テーブル `generation_jobs` を作成し、`createJobState` / `updateJobState` /
`getJobState` を Supabase service role の SELECT/UPDATE/INSERT に置換。
全 instance 間で共有される真実のソースとなる。

---

## 2. アーキテクチャ修正

### 2.1 新テーブル `generation_jobs`

```sql
CREATE TABLE generation_jobs (
  id UUID PRIMARY KEY,
  user_id UUID,                                    -- 任意 (将来 RLS 用)
  stage TEXT NOT NULL DEFAULT 'queued'
    CHECK (stage IN ('queued','stage1','stage2','hallucination','done','failed')),
  progress NUMERIC DEFAULT 0,                      -- 0.0..1.0
  eta_seconds INT DEFAULT 0,
  error TEXT,
  article_id UUID,                                 -- 完了時の記事 ID
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_gen_jobs_updated ON generation_jobs (updated_at DESC);
-- 24h 経過した完了 job は cron で削除する想定 (v2)
```

### 2.2 `zero-gen-job-store` 置換
- 同一 process 内 in-memory cache (TTL 60s) を残しつつ、truth は Supabase
- `createJobState(jobId)` → INSERT (UPSERT) + memStore に格納
- `updateJobState(jobId, partial)` → UPDATE + memStore 更新 (前回値を読まずに UPDATE 直接)
- `getJobState(jobId)` → memStore hit なら即返、miss なら SELECT
- `clearJobState(jobId)` → DELETE + memStore 削除

### 2.3 SSE GET route
既存のままで OK (内部で `getJobState` を呼んでいる)。

### 2.4 認可
service role 経由なので job_id を知るユーザは進捗参照可。
将来 RLS で `user_id = auth.uid()` を追加して他人の job を見せない (v2)。

---

## 3. E2E テストケース

各ケースに **前提**, **手順**, **期待結果**, **検証方法** を明記。

### T1. 単発ゼロ生成 (基本フロー)
**前提:** ログイン済、テーマ・ペルソナマスタあり
**手順:**
1. `/dashboard/articles/new-from-scratch` を開く
2. テーマ「ヒーリングと癒し」、ペルソナ「奈々」、キーワード「初心者」、意図「情報提供」、目標 2000 を入力
3. 「生成」ボタンクリック
**期待:**
- ~200ms でトースト「🚀 生成を開始しました」
- フォーム上部に「🚀 バックグラウンドで生成中」黄色バー表示
- 全 input 群がグレーアウト
- 上部グローバルバナーに「Stage 1: 構成生成中…」(progress%)
- 90 秒後に緑バナー「✅ 記事生成完了」+「記事を開く」リンク
- localStorage の `blogauto.activeGenerationJob` に job_id が保存

### T2. 他画面に移動して継続
**前提:** T1 と同じセットアップ
**手順:**
1. T1 step 3 まで実行
2. ボタン押下後 5 秒待機
3. サイドバーから「記事一覧」へ移動
4. さらに「ダッシュボード」へ移動
5. 90 秒経過まで待機
**期待:**
- 移動した画面でも上部バナーが進捗を継続表示
- 90 秒後に完了通知 + 「記事を開く」リンク

### T3. タブを閉じて再開
**手順:**
1. T1 step 3 まで実行
2. ボタン押下後 5 秒待機
3. ブラウザタブを閉じる
4. 60 秒以内に同 URL を新規タブで開く
**期待:**
- 新タブの上部バナーに進行中の job が復帰
- 完了通知も発火する

### T4. job not found エラーが起きない (P5-22 の核)
**手順:**
1. 普通に生成 → 完了まで進める
**期待:**
- SSE 接続が **404 を一度も返さない**
- 「❌生成失敗: job not found」トーストが**出ない**
**検証:** ブラウザ DevTools Network タブで `/progress` の status を全件チェック

### T5. 二重投入防止
**手順:**
1. T1 step 3 で生成投入
2. ボタンが disabled になっていることを確認
3. 全 input が disabled になっていることを確認
4. もう一度クリックを試みる (反応しない)
**期待:**
- ボタンに「生成進行中」テキスト + opacity 50%
- title attr に「別の生成が進行中です」表示
- 二重投入されない

### T6. 失敗ケース (バリデーション)
**手順:**
1. テーマだけ未選択でクリック → トースト「テーマを選択してください」
2. キーワード 0 件でクリック → トースト「キーワードを 1 つ以上追加」
3. 文字数を 100 にしてクリック → トースト「800〜5000」
**期待:** 全て個別エラートースト + jobActive にならない

### T7. 失敗ケース (サーバー)
**手順:**
1. 不正な theme_id (UUID でない) を直接 fetch で送信
**期待:** 400 + 詳細メッセージ + フォームに jobActive 残らない

### T8. 画像反映
**前提:** image_files が 3 枚登録済、本文に `IMAGE: 説明-->` placeholder が 2 件残った記事
**手順:**
1. `/dashboard/articles/<id>/edit` を開く
2. 「画像を反映」ボタンをクリック
**期待:**
- トースト「画像を反映しました（位置名一致 X 件 / 順序割当 Y 件）」
- プレビューに画像 (img タグ) が表示される
- 文中に IMAGE プレースホルダが残らない

### T9. キーワード候補提案
**手順:**
1. テーマ + ペルソナを選択
2. 0.5 秒後に候補チップが自動表示 (Phase 1: persona)
3. 15 秒後に AI 候補が追加 (Phase 2)
**期待:**
- 13-18 候補表示
- ペルソナ系チップは緑、AI 系は水色
- クリックでキーワード欄に追加

### T10. バッチゼロ生成
**手順:**
1. `/dashboard/articles/batch-zero-generate` を開く
2. 1 行目を入力 → 「テンプレ: 全ペルソナ展開」クリック
3. 7 行に展開 → 投入確認ダイアログで OK
**期待:**
- バナー「📚 バッチ生成: 0/7 完了」開始
- 並列度 3 で逐次完了
- 全完了で「🎉 バッチ生成完了」toast

### T11. 認証
**手順:** ログアウト状態で `/api/articles/zero-generate-async` を直接 POST
**期待:** 401 認証エラー

### T12. 品質チェック自動修復
**手順:**
1. 生成完了記事の編集画面で「公開」クリック
2. 失敗項目に「⚙️ 修復」表示
3. 「🔧 自動補正」選択
**期待:** ~15 秒後に修復、品質チェック再実行で fail 数減る

---

## 4. 受入基準

- AC-1: T1〜T7 を手動 (本番 URL) で実行し全 PASS
- AC-2: T8〜T12 を 1 回ずつ実行し PASS
- AC-3: `/progress` SSE が 404 を返さない (T4)
- AC-4: 二重投入できない (T5)
- AC-5: ブラウザコンソールに `job not found` エラーが出ない
- AC-6: `npx tsc --noEmit` 0 errors
- AC-7: `npx vitest run` 全 PASS
- AC-8: マイグレ `20260502020000_generation_jobs` を本番適用

---

## 5. テスト実行手順

### 自動 (vitest)
```bash
npx tsc --noEmit
npx vitest run
```

### 手動 (本番デプロイ後)
1. ハードリロード (Cmd+Shift+R)
2. T1〜T12 を順次実行
3. 各テストの期待結果を確認 → ✓ / ✗ をメモ
4. 失敗があれば commit hash + ステップ + 観測事象を共有

---

## 6. 既知の v2 候補

- `generation_jobs` の RLS (user_id = auth.uid())
- 24h 超完了 job の cron 削除
- リアル進捗イベント (今は時間ベース擬似進捗)
- リトライボタン (失敗時)
- バッチごとの記事一覧フィルタ
