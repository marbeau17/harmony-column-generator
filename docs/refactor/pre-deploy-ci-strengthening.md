# Pre-Deploy CI 強化設計

## 目的
既存の vitest 836 件 + `tsc --noEmit` 0 エラーに加え、PR / push 前に以下 5 種の自動検証を pre-deploy ゲートで実行し、過去に発生した壊れ HTML / silent failure / URL ドリフトの再発を防ぐ。

## 追加検証項目

### 1. 生成 HTML smoke (`scripts/ci/html-smoke.ts`)
- テスト用 fixture (`tests/fixtures/articles/*.json`) を 5 件ロードし `generateArticleHtml` を実行。
- 出力に対して以下を assert:
  - `<!--<img` (コメントアウトされた img タグ) が 0 件
  - `<main>` の出現回数が 1 回ちょうど (`<main>×2` 検出時 fail)
  - `<footer>` の出現回数が 1 回ちょうど (`<footer>×2` 検出時 fail)
  - `<!DOCTYPE html>` が文書冒頭に 1 件存在
- 失敗時は差分 HTML を `out/ci/html-smoke/<slug>.html` に書き出し artifact 化。

### 2. regex coverage (`scripts/ci/regex-coverage.ts`)
- `src/lib/generators/replace-placeholders.ts` の 4 つの replace patterns (タイトル / 本文 / 画像 / メタ) を AST スキャン。
- 各 pattern に対して `tests/lib/generators/replace-placeholders.test.ts` 内に少なくとも 1 件のテストケース (matching `it(...)` ブロック) が存在することを検証。
- 0 件の pattern を検出したら fail。

### 3. state-machine integrity (`scripts/ci/state-machine-coverage.ts`)
- `src/lib/state/VALID_TRANSITIONS` を import し、定義された全遷移 `(from, to)` を列挙。
- `tests/lib/state/transitions.test.ts` 内のテストタイトルから `from -> to` 表現を抽出し、未カバー遷移が 1 件でもあれば fail。

### 4. URL pattern lint (`scripts/ci/url-lint.ts`)
- ハードコード `harmony-mc.com/column/{slug}.html` を `src/` 全体で grep。
- マッチ件数が 0 件でない場合 fail。代わりに `getColumnUrl(slug)` ヘルパ経由を強制。

### 5. silent-failure lint (`scripts/ci/silent-failure-lint.ts`)
- アプリコード (`src/` 配下、`tests/` 除外) で `.catch(() => {})` `.catch(()=>{})` `.catch(async () => {})` のいずれかにマッチする箇所を AST/regex で検出。
- マッチが 0 件でない場合 fail。
- 例外承認リスト: `docs/refactor/silent-failure-allowlist.txt` (file:line 形式) に明示登録された箇所のみスキップ。

## 実行統合
- `package.json` に `npm run ci:pre-deploy` を追加し、上記 5 スクリプトを `Promise.all` で並列実行 (グローバル §3 並列性原則)。
- GitHub Actions `.github/workflows/pre-deploy.yml` の PR / push トリガで `npm run ci:pre-deploy` を必須チェック化。
- pre-commit (Husky) では軽量な 4 / 5 のみ実行 (1〜3 は CI 側のみ、ローカル待機を回避)。

## 失敗時の動作
- 各スクリプトは exit code 1 で失敗、`out/ci/<job>.json` に詳細レポートを出力。
- CI は artifact として `out/ci/**` を 7 日間保持し、Evaluator が `eval_report.md` 起票時に参照可能にする。
