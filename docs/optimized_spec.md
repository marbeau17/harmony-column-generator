# Optimized Spec — P4: 残バックログ #11-#18 一斉整理

**Author:** Planner（クローズドループ・パイプライン 第 5 サイクル）
**Date:** 2026-04-25
**Scope:** P3 で未着手の 8 項目を**逐次実行**（小→大 の順）
**前サイクル:** P3 完了（commit 6a0cd54、運用基盤 5 項目本番展開済）

---

## 実行順序（小→大）

| # | バックログ ID | 項目 | サイクル ID | 推定工数 |
|---|---|---|---|---|
| 1 | #15 | `.env.local.example` テンプレ強化 | **P4-A** | 極小 |
| 2 | #17 | Supabase CLI v2.20.12 → v2.90.0 | **P4-B** | 極小 |
| 3 | #16 | README.md に V2 セクション追加 | **P4-C** | 小 |
| 4 | #18 | `docs/source-mapping-*.md` / `supabase/Claude.md` 整理 | **P4-D** | 小 |
| 5 | #13 | session-guard MONKEY_TEST bypass 強化 | **P4-E** | 小 |
| 6 | #12 | PublishButton の toast 化（alert 置換） | **P4-F** | 小-中 |
| 7 | #14 | CI で E2E 自動実行（GitHub Actions） | **P4-G** | 中 |
| 8 | #11 | scripts/* 整理（記事改変系の隔離） | **P4-H** | 中（要慎重） |

各サブサイクル完了後にユーザに報告し、次サイクルに進む。

---

## P4-A: `.env.local.example` 強化（#15）

### 目的
新規開発者が monkey E2E や FTP_DRY_RUN 等を簡単に再現できるよう、env テンプレを最新化。

### 変更
`.env.local.example` に以下キーを追加（値はダミー）:
- `MONKEY_SUPABASE_URL=http://127.0.0.1:54321`
- `MONKEY_SUPABASE_SERVICE_ROLE=`
- `MONKEY_BASE_URL=http://localhost:3000`
- `MONKEY_TEST=false`
- `FTP_DRY_RUN=false`
- `PUBLISH_CONTROL_V2=on`
- `PUBLISH_CONTROL_FTP=on`
- `TEST_USER_PASSWORD=`
- `DANGLING_RECOVERY_TOKEN=`
- `SLACK_WEBHOOK_URL=`
- `GEMINI_API_KEY=`（既存にあれば不要）
- `NEXT_PUBLIC_PUBLISH_CONTROL_V2=` (Vercel only, ローカルは optional)

### AC
- AC-A-1: 上記キーがすべて `.env.local.example` に存在
- AC-A-2: 各キーに 1 行コメントで用途記載
- AC-A-3: 既存キーの値・コメントは変更しない

---

## P4-B: Supabase CLI アップデート（#17）

### 目的
v2.20.12（2 年遅れ）→ v2.90.0 へ。新機能・バグ fix を取り込む。

### 変更
- `package.json` の devDependencies / dependencies に supabase が固定されていれば更新
- なければ `npx supabase` 経由実行のため対応不要（最新版が pull される）
- `supabase/config.toml` に新版で必須となる設定があれば追加

### AC
- AC-B-1: `npx supabase --version` が v2.90.0 以上を表示
- AC-B-2: `npx supabase status` がエラーなく動作（config.toml parse エラー再発しない）
- AC-B-3: `package.json` 内に supabase が dep として含まれていれば更新済

---

## P4-C: README.md に V2 セクション追加（#16）

### 目的
新規開発者・由起子さん（運用者）に Publish Control V2 の使い方を明記。

### 変更
README.md に以下セクション**追加**（既存の構成は壊さない）:
- 「Publish Control V2 概要」
- 「公開/非公開フロー」（PublishButton の使い方）
- 「環境変数一覧」（必須・任意の表）
- 「運用 SQL 集」（よく使う検証クエリ）
- 「監視 URL」（/dashboard/publish-events）

### AC
- AC-C-1: README に上記セクションが追加されている
- AC-C-2: 既存セクション（プロジェクト概要、技術スタック等）は無傷
- AC-C-3: コードブロックや SQL の構文が正しい

---

## P4-D: docs 整理（#18）

### 目的
不要・重複・古いドキュメントを削除 or 整理。

### 変更
- `docs/source-mapping-20260407.md` の内容確認 → 古ければ削除 or `docs/archive/` に移動
- `supabase/Claude.md` と `supabase/CLAUDE.md` が両方存在すれば統合（Mac の case-insensitive 対策）
- 仕様書ディレクトリの構造を整理（必要なら `docs/specs/` 配下を再編）

### AC
- AC-D-1: 重複ファイルなし（同じ内容で 2 ファイルが存在しない）
- AC-D-2: 削除/移動したファイルは README または docs/INDEX.md で言及
- AC-D-3: 既存の参照（コード内の path 言及）が壊れない

---

## P4-E: session-guard MONKEY_TEST bypass 強化（#13）

### 目的
現状 `MONKEY_TEST=true` 単独で session-guard が完全 bypass される。本番で誤って `MONKEY_TEST=true` がセットされた場合の事故を防ぐ追加ガード。

### 変更
`src/lib/publish-control/session-guard.ts` の bypass 条件を強化:
```typescript
// 現状: process.env.MONKEY_TEST === 'true' のみ
// 強化後: MONKEY_TEST=true AND (NEXT_PUBLIC_SUPABASE_URL が localhost or 127.0.0.1 を含む)
```
本番 Supabase URL は `khsorerqojgwbmtiqrac.supabase.co` のため、bypass されなくなる。

### AC
- AC-E-1: `MONKEY_TEST=true` + 本番 SUPABASE_URL の組み合わせで bypass されない
- AC-E-2: `MONKEY_TEST=true` + localhost SUPABASE_URL の組み合わせで bypass される
- AC-E-3: 単体テスト追加（2 ケース）、既存テストは PASS 維持

---

## P4-F: PublishButton toast 化（#12）

### 目的
`alert()` を react-hot-toast 等に置換して UX 改善。

### 変更
- `react-hot-toast` を package.json に追加
- `src/app/layout.tsx` または専用 provider に `<Toaster />` を配置
- `src/components/articles/PublishButton.tsx` の `alert()` 呼び出し箇所を `toast.success()` / `toast.error()` に置換

### AC
- AC-F-1: 依存追加完了、ビルド通過
- AC-F-2: PublishButton 内で alert() が 0 件
- AC-F-3: success / error 両方の toast が呼ばれる
- AC-F-4: dark mode 対応（react-hot-toast の dark 設定）

---

## P4-G: CI E2E 自動化（#14）

### 目的
PR 毎に publish-control E2E（monkey + hub-rebuild）が自動実行されることで、リグレッションを早期検知。

### 変更
- `.github/workflows/e2e.yml` を新規作成
- 必要な GitHub Secrets:
  - `MONKEY_SUPABASE_SERVICE_ROLE_KEY`（**dev/staging プロジェクト**のキー、本番ではない）
  - `MONKEY_SUPABASE_URL`
  - `TEST_USER_PASSWORD`
- ジョブステップ:
  1. checkout
  2. Node.js setup
  3. npm ci
  4. Playwright browsers install
  5. Next.js dev server を background で起動（port 3100）
  6. `npx playwright test monkey-publish-control hub-rebuild`
  7. 失敗時はテスト結果を artifact として upload

### AC
- AC-G-1: `.github/workflows/e2e.yml` 新規作成
- AC-G-2: workflow が `on: pull_request` で trigger される
- AC-G-3: README または docs/CONTRIBUTING.md に必要な Secrets 一覧記載
- AC-G-4: 実機で workflow が green になる（PR 作成時に確認）

---

## P4-H: scripts/ 整理（#11）

### 目的
`scripts/regenerate-*`, `scripts/fix-*`, `scripts/improve-*`, `scripts/recover-*` 等の**記事本文を変更する系統**を明確に隔離し、誤実行を防ぐ。

### 変更
- `scripts/dangerous/` ディレクトリ新規作成（gitignore は**しない**、リポジトリに残す）
- 上記 prefix のスクリプトを `scripts/dangerous/` に移動
- `scripts/dangerous/README.md` を作成し、各スクリプトの目的・実行条件・記事本文への影響を明記
- 安全なユーティリティ（`scripts/check-*`, `scripts/dump-*`, `scripts/find-*`, `scripts/inspect-*`, `scripts/diff-*`, `scripts/test-*`, `scripts/verify-*`）はそのまま `scripts/` に残す
- バッチデプロイ系（`scripts/ftp-deploy-*`, `scripts/redeploy-*`, `scripts/process-queue-direct.ts`）は `scripts/ops/` に移動（ops = 運用、ただし dangerous ではない）

### AC
- AC-H-1: 危険系（regenerate/fix/improve/recover）が `scripts/dangerous/` 配下に隔離
- AC-H-2: `scripts/dangerous/README.md` で各スクリプトを文書化
- AC-H-3: 運用系が `scripts/ops/` 配下に整理
- AC-H-4: 既存の参照（CI、他スクリプト、docs）が壊れない（grep で確認）
- AC-H-5: 移動したファイルは git mv で履歴保持

---

## 共通ルール（全サブサイクル）

### 安全性ガード
- 記事本文（articles.html_body / title / summary）への write 禁止
- 既存 publish-control コア（src/lib/publish-control/, src/lib/db/articles.ts, src/app/api/articles/[id]/visibility/）変更禁止（P4-E のみ session-guard.ts の bypass 条件強化を例外的に許可）
- 本番 DB への直接書込禁止
- マイグレ追加禁止（P4 はコード/設定/docs のみ）

### 検証
- 各サブサイクル完了時に: `npx vitest run` 全件 PASS、`npx tsc --noEmit` exit=0、`npm run build` PASS
- E2E は P4-G 完了後に CI で自動化されるため、それまでは shadow 手動

### Loop Count
- progress.md 先頭に `Loop Count: X` を維持
- 差し戻し発生で +1、3 回到達で停止 → ユーザ介入

---

## クローズドループ判定

| サイクル | 完了条件 |
|---|---|
| P4-A〜P4-H 各サブサイクル | 該当 AC 全件 PASS、`progress.md` 追記、Evaluator 2 確認 |
| P4 全体 | 全 8 サブサイクル完了、eval_report.md に第 5 サイクル PASS 記録 |

---

## 完了定義

- 全サブサイクル PASS
- `docs/feedback/eval_report.md` に各サブサイクルの PASS 記録
- `docs/progress.md` に各サブサイクルの完了記録
- バックログ完全クローズ（残るは step9 自動 PR @ 2026-05-09 のみ）
