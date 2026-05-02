# 包括的 QA チェックリスト (P5-23)

**Author:** Planner
**Date:** 2026-05-02
**目的:** カット&トライ運用から脱却し、デプロイ前に網羅的に検証することで品質を担保する。

---

## 1. テスト分類

### 1.1 自動テスト (CI で常時実行)
- **vitest unit**: 純粋関数、ロジック単位
- **vitest integration**: API ルート (mocked auth + DB)
- **Playwright public**: 認証不要の公開ページ
- **Playwright authed**: TEST_USER_PASSWORD で driver login → 全画面 smoke

### 1.2 手動テスト (デプロイ後 30 分)
- **smoke**: 各ページ表示、コンソールに app 由来エラーなし
- **happy path**: 単発ゼロ生成 → 画像反映 → 公開
- **edge cases**: 失敗ケース、二重投入、stale localStorage
- **regression**: 直前のバグ (D/E/F/G/H/I/J/K/L) が再発しないか

### 1.3 ライブ確認 (本番のみ)
- **smoke**: 重要 API が 200/401/404 を正しく返す
- **logs**: Vercel runtime logs に未対応 5xx が無い

---

## 2. 全 23 のテストケース

### 認証 (3 件)
- **A1**: 未ログインで /dashboard → /login へリダイレクト ✓
- **A2**: 未ログインで API エンドポイントは 401
- **A3**: ログイン成功で /dashboard 表示

### ダッシュボード (3 件)
- **D1**: 統計カード (公開記事数 / 下書き数 / 元記事数 / 生成済み数) が表示
- **D2**: 最近の記事 5 件リスト
- **D3**: ナビゲーション全項目クリックで遷移

### ゼロ生成フォーム (8 件)
- **G1**: テーマ未選択で送信 → toast「テーマを選択してください」
- **G2**: ペルソナ役割が dropdown に表示 (例: `奈々 — 30-39 / 起業・コーチング`)
- **G3**: テーマ+ペルソナ選択 → 自動的にキーワード候補が出る (~500ms)
- **G4**: 候補チップクリックで keyword 欄に追加
- **G5**: 「生成」クリック → 200ms で toast「🚀 生成を開始しました」
- **G6**: フォーム上部に「🚀 バックグラウンドで生成中」黄色バー
- **G7**: 全 input + ボタン disabled
- **G8**: 上部グローバルバナーに進捗、90 秒で「✅ 完了」緑バナー + 記事リンク

### バッチ生成 (3 件)
- **B1**: /batch-zero-generate で行追加・削除が動く
- **B2**: 「全ペルソナ展開」テンプレで 7 行になる
- **B3**: 5 件投入 → コスト確認ダイアログ → 投入で 5 個 job_id 取得

### 記事編集 (5 件)
- **E1**: 編集画面で本文がプレビュー表示
- **E2**: TipTap エディタで編集 → 自動保存「保存中... 保存済み」
- **E3**: 「画像を反映」で IMAGE プレースホルダ → img タグに置換
- **E4**: 「公開」→ 品質チェックダイアログ表示
- **E5**: fail item に「⚙️ 修復」ドロップダウン → 4 戦略選択可

### 設定 (3 件)
- **S1**: SEO タブで構造化フォームが表示
- **S2**: 著者名を変更 → 保存 → リロードしても保持
- **S3**: schema トグルで Article/FAQPage 等の ON/OFF

### 規格事項 (4 件)
- **R1**: コンソールに我々アプリ由来のエラー 0 件 (拡張機能由来は除外)
- **R2**: localStorage の stale job_id が自動回収される
- **R3**: 各ページが <2s で初期表示
- **R4**: ダークモードで全画面の背景・文字が読める

### 認可 / セキュリティ (3 件)
- **C1**: 他人の記事 ID で /api/articles/[id] → 適切なレスポンス
- **C2**: service role キーがクライアント JS に流出していない
- **C3**: SQL injection 試行 (URL に ' or 1=1) → 400/404

---

## 3. テスト実行順序

| Phase | 何を実行 | 目的 |
|---|---|---|
| 0 | tsc + vitest run | 静的解析 + 単体テスト |
| 1 | Playwright smoke (auth 不要) | login ページ表示、redirect 動作 |
| 2 | Playwright authed (要 TEST_USER_PASSWORD) | 全ページ smoke |
| 3 | 手動: G5〜G8 (実 Gemini コール、$0.18) | 単発生成完走 |
| 4 | 手動: E3〜E5 (生成済記事に対し) | 編集・公開フロー |
| 5 | Vercel logs 確認 | 5xx エラー 0 件 |

---

## 4. 既知の制約と運用

### 4.1 Vercel Pro 必須
- maxDuration=300 が必要な API: zero-generate-async / zero-generate-full /
  zero-generate-batch / batch-generate-images
- Hobby プランでは 10s 制限で 90s 生成が完走しない

### 4.2 拡張機能の console エラー
ブラウザ拡張 (ABP / Sentry を含む拡張等) が `chrome-extension://` から
`Uncaught ReferenceError: window is not defined` 等を投げる。
**我々のアプリ由来ではない**。シークレットモードで再現しないことで判別可能。

### 4.3 Supabase /tmp 共有不可問題
P5-22 で job-store を Supabase テーブルに移行済。
ただし古い localStorage に残った job_id は SSE で「job not found」を受けて
**自動クリア** (P5-23 修正、commit `fd4bf36`)。

### 4.4 拡張機能無しテスト
シークレットモード (Cmd+Shift+N) または別ブラウザで実施することで、
拡張機能干渉のないクリーンな環境で確認可能。

---

## 5. v2 候補

- GitHub Actions で PR 毎に Playwright authed 自動実行
- Vercel preview デプロイに対する自動 smoke
- ステージング環境の常設化
- error rate / latency の Slack 通知
