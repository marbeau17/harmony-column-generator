# Runbook: 記事生成が "finalizing" / "image_generating" で停滞したときの復旧

> P5-67 (2026-05-04) で確立した手順。zero-gen 経由の生成ジョブが "finalizing 90% / 残り -90s" のように
> 進捗が止まる事象に対する一次対応をまとめる。

## 1. 症状

- ダッシュボード進捗バナーが `Stage 4: 画像生成 + 仕上げ中 (90%)` のまま動かない
- ETA が負値 (例: `残り ~-90s`) を表示する → UI 側は `処理中…(時間超過)` に切り替わるが、
  **5 分以上 stage が変わらない場合は実体ハング**
- DB 側で `generation_jobs.stage` が `finalizing` または `image_generating` で `updated_at` が 5 分以上前

## 2. 根本原因 (P5-67 で確認済み)

`src/app/api/articles/zero-generate-full/route.ts` に `export const maxDuration` が指定されておらず、
Vercel default の 60 秒を継承していた。実処理は以下のように 60 秒では到底足りない:

| ステップ | 想定時間 |
|:---|---:|
| Banana Pro 画像生成 (3 枚) | 90s × 3 = 270s |
| Supabase Storage upload | 5–15s |
| Stage3 finalize (HTML 構築 + DB UPDATE) | 5–10s |
| **合計** | **約 290s** |

→ Vercel が 60s で SIGTERM を送ってプロセスを殺すため、`generation_jobs` の stage 進行 UPDATE が
   走らないまま終了し、UI は最後にポーリングした `finalizing 90%` を表示し続ける。

## 3. 検知方法

### 3.1 自動 (CI)

GitHub Actions の毎日 7:00 JST `article-health-daily.yml` で `H-13: stuck finalizing ジョブ 0 件` が
検査されている。critical 失敗時は GitHub Issue が自動オープンされる。

### 3.2 手動

```bash
# dry-run でカウントだけ確認
npx tsx scripts/recover-stuck-finalizing.ts

# health モニタを単発実行
npx tsx scripts/health/run-all.ts
```

## 4. 復旧手順

### Step 1: 状況把握 (read-only)

```bash
npx tsx scripts/recover-stuck-finalizing.ts
```

出力例:
```
[stuck-finalizing] 5 分以上停滞している generation_jobs: 1 件
- 9e0421c7-... article=1a87b046-... stage=finalizing updated_at=2026-05-03T...
```

### Step 2: 失敗マーク (--apply)

```bash
npx tsx scripts/recover-stuck-finalizing.ts --apply
```

これで stuck ジョブを `stage='failed'` にマークし、UI のバナーが消える。
記事自体は draft / editing 状態で残るので、ユーザーは「記事一覧」から再生成を選択できる。

### Step 3: maxDuration 設定の確認

```bash
grep -n "maxDuration" src/app/api/articles/zero-generate-full/route.ts
# → export const maxDuration = 300;
```

`= 300` が無い場合は Vercel Pro の上限 (300s) まで上げる。
**注意**: Pro plan でしか 300 まで上げられない。Hobby plan は 60 が上限なので、その場合は
処理を非同期キュー (Inngest など) に切り出す必要がある。

### Step 4: Vercel ログ確認

```bash
vercel logs --since 30m | grep "zero-generate-full"
```

`504` や `FUNCTION_INVOCATION_TIMEOUT` が出ていないかを確認。出ていれば maxDuration 起因確定。

## 5. 再発防止

- **maxDuration を 300 に固定** (P5-67 で対応済み)
- **進捗 UI は eta 負値を吸収** (`処理中…(時間超過)`) し、5 分以上 stage 停滞で警告表示
- **CI 健全性チェック H-13** で日次検知 → Issue 自動オープン
- **`recover-stuck-finalizing.ts` --apply** をオンコール手順に組み込み

## 6. 関連ファイル

- `src/app/api/articles/zero-generate-full/route.ts` — maxDuration = 300
- `src/components/articles/GenerationProgressBanner.tsx` — eta 負値分岐 + stall 警告
- `scripts/recover-stuck-finalizing.ts` — stuck ジョブの検知 / 失敗マーク
- `scripts/health/run-all.ts` — H-13 として常時監視
- `.github/workflows/article-health-daily.yml` — 日次自動実行
