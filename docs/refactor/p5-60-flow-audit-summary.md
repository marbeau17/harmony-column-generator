# P5-60 フロー全体精査 — 改善提案サマリ (20 エージェント並列レビュー)

> 20 名並列エージェント (P1–P15 詳細レポート + 5 名横断レビュー) によるゼロ生成パイプライン全体監査の集約版。
> 個別レポートは `docs/refactor/article-health-monitor.md` / `pre-deploy-ci-strengthening.md` / `test-infra-priorities.md` 等を参照。

## 1. 20 エージェント並列で発見した問題 (P1–P15 要約)

| # | カテゴリ | 代表的な発見 | 検出ソース |
|---|---|---|---|
| P1 | HTML 構造 | `<main>` / `<footer>` 二重出力 (バグ G) | structural-test agent |
| P2 | プレースホルダ | `{{...}}` 残存 80 件、Pattern2 regex の closing 消費バグ (P5-57) | placeholder-scan agent |
| P3 | 画像生成 | `<!--<img` 不正コメント混入 (バグ F、5 記事波及) | image-output agent |
| P4 | CTA 配置 | CTA 0 件で本番出荷 (バグ E)、順序崩壊事例あり | cta-placement agent |
| P5 | 由起子 FB | `""` 混入・抽象表現の AI 出力ばらつき | tone-conformance agent |
| P6 | 関連記事 | cross-mode リンク漏れ (P5-59 で同 mode フィルタ追加) | crossref agent |
| P7 | URL ドリフト | `harmony-mc.com/column/{slug}.html` ハードコードが 12 箇所 | url-lint agent |
| P8 | parity | DB `reviewed_at` ↔ FTP `visibility_state` 不整合の dangling | parity agent |
| P9 | sitemap | published 全件と sitemap.xml の件数不一致リスク | sitemap agent |
| P10 | silent failure | `.catch(() => {})` がアプリコードに 7 箇所 | silent-fail agent |
| P11 | state machine | 状態遷移テスト未カバーが 4 (from,to) ペア | transition agent |
| P12 | API エラーパス | 401/404/422/500 系が一部 500 で leak | api-error agent |
| P13 | バージョン履歴 | 4 件保持ルール違反の検出漏れ | revisions agent |
| P14 | 抜粋汚染 | GA4 script 文字列が抜粋に混入 (P5-49 で修正済) | excerpt-clean agent |
| P15 | 再デプロイ | 「再デプロイボタンが動かない」(P5-51 で根本対処) | deploy-button agent |

## 2. トップ 3 の根本原因

### 2.1 String-based HTML 操作 (40% のバグの源)
正規表現と文字列置換で HTML を組み立てている結果、`<main>` 二重・`<!--<img` 残存・closing tag 消費が全て同じ層で起きている。**処方箋**: `cheerio` 等の DOM パーサ層を導入し、生成・検証・修復の3経路を同一 AST で表現。

### 2.2 Silent Failure (デバッグ不能化の根源)
`try/catch (e) { /* 無視 */ }` と `.catch(() => {})` のパターンがアプリコード 7 箇所に潜在。CTA 0 件出荷 (バグ E) や placeholder 残存 (P5-15 まで未検知) はここで握り潰された例外が原因。**処方箋**: silent-failure-lint を pre-deploy CI で 0 件強制 + allowlist 方式。

### 2.3 AI 出力変動 (品質ばらつき)
Gemini Pro 3.1 が同一プロンプトでも `""` 混入・抽象表現・`undefined` 文字列リテラル等を確率的に出力。**処方箋**: 生成直後に禁止 grep を 100% 実行し、検出時は 1 回まで自動再生成。残れば人間レビュー前にハードフェイル。

## 3. 影響範囲ヒートマップ (ファイル数 × バグ種別)

| ファイル領域 | HTML破損 | placeholder | silent-fail | URL drift | tone | parity | 合計 |
|---|---|---|---|---|---|---|---|
| `src/lib/generators/` | 8 | 4 | 1 | 0 | 0 | 0 | **13** |
| `src/lib/content/` | 2 | 1 | 2 | 3 | 5 | 0 | **13** |
| `src/lib/db/` | 0 | 0 | 1 | 0 | 0 | 4 | **5** |
| `src/app/api/` | 1 | 0 | 3 | 4 | 0 | 2 | **10** |
| `scripts/` | 0 | 5 | 0 | 5 | 0 | 3 | **13** |
| `src/lib/ai/` | 0 | 0 | 0 | 0 | 6 | 0 | **6** |

ホットスポットは `src/lib/generators/` と `src/lib/content/` (各 13 件)。最初の 1 ヶ月はここに集中投資する。

## 4. 緊急度別の改善ロードマップ

### 今週 (Week 1) — 出血止血
- [ ] `scripts/ci/silent-failure-lint.ts` 実装 + `npm run ci:pre-deploy` に組込 (pre-deploy-ci-strengthening §5)
- [ ] `scripts/ci/url-lint.ts` で `harmony-mc.com/column/{slug}.html` ハードコードを 0 件化
- [ ] 既存 `scan-broken-img.ts` に `--json` フラグ追加 → H-03 健康監視に流用 (article-health-monitor §3)
- [ ] Live Article Smoke (P1) を GitHub Actions cron で dry-run 開始

### 今月 (Month 1) — 構造改革
- [ ] `cheerio` ベース HTML パーサ層を `src/lib/html-ast/` に新設し、generator 出力を AST 経由で検証
- [ ] HTML 構造 Unit Test (P2) を vitest 836 件に追加 (`<main> 1個` / CTA 3個 / 免責事項末尾)
- [ ] Generator Output Grep 排除テスト (P3) を全 generator に適用
- [ ] Article Health Monitor Phase 1 (critical Slack 通知 / CI は緑のまま)
- [ ] regex coverage / state-machine integrity の 2 ジョブを CI 必須化

### 今四半期 (Quarter 1) — 仕組み化
- [ ] API ルート エラーパス テスト (P4) を Playwright + supertest で 401/404/422/500 網羅
- [ ] State Machine 全遷移 + Parity テスト (P5) を table-driven で完備
- [ ] Article Health Monitor Phase 2 → 3 (デプロイ前ゲート化、`npm run release` の pre-flight 統合)
- [ ] AI 出力 contract test を導入 (Gemini レスポンスを Zod スキーマで検証 + 1 回まで auto-retry)
- [ ] Step9 自動 PR (`trig_01YMtfRoZmA61aChNmhtRB2r`) と health monitor の結果連動

## 5. メトリクスで追うべき KPI

| KPI | 定義 | 現状 (推定) | 目標 (Q1 末) | 計測方法 |
|---|---|---|---|---|
| バグ密度 | 本番反映後 7 日以内に検出された critical bug 件数 / 100 記事 | 4.2 件 | **0.5 件以下** | `health_check_runs` の critical 集計 |
| 手動修復回数 | 1 週間あたり手動で `article_revisions` INSERT した記事数 | 8 件/週 | **1 件以下/週** | `article_revisions` の `author='manual'` 集計 |
| silent-failure 件数 | アプリコード内 `.catch(() => {})` 件数 | 7 箇所 | **0 箇所** (allowlist 化) | `ci/silent-failure-lint` の出力 |
| HTML 構造違反率 | `<main>` ≠ 1 / `<footer>` ≠ 1 の記事数比 | 0.3% (5/1499) | **0%** | health monitor H-01/H-02 |
| CTA 配置完全性 | 各記事 CTA = 3 件の達成率 | 99.6% | **100%** | health monitor H-11 |
| AI 出力 NG パターン検出率 | 生成直後 grep でリジェクトされた割合 | 計測なし | **5% 以下** で安定 | `tone-conformance` ログ |
| dangling 記事数 | DB `published` かつ FTP 未配置の件数 | 2 件 | **0 件** | health monitor H-09 |
| pre-deploy CI 緑率 | 連続成功日数 | 0 日 (未稼働) | **連続 30 日** | GitHub Actions API |

## 6. 次のアクション

1. 今週分の 4 項目を P5-61 として起票し、Generator/Fixer に並列割り当て (グローバル §3 並列性原則)
2. KPI ダッシュボードを `/admin/health` に新設 (Vercel Cron からの結果集計を表示)
3. 30 日後 (2026-06-01) に再度 20 エージェント並列レビューを走らせ、本サマリの数値を更新
