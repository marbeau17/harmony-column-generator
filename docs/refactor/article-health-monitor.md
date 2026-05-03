# 本番記事ヘルスチェック自動実行設計 (Article Health Monitor)

> 目的: 本番反映済みの記事に対し毎日自動でヘルスチェックを走らせ、HTML 構造破損 / プレースホルダ残存 / cross-mode 漏れ / parity 崩壊 / sitemap 不整合 等を **発覚前 24h 以内** に検知する仕組みを敷く。

## 1. チェック項目 (12 件)

| # | 項目 | 期待値 | 既存資産 | 重大度 |
|---|---|---|---|---|
| H-01 | 各記事 HTML 中の `<main>` 出現回数 | ちょうど 1 | (新規) | critical |
| H-02 | 各記事 HTML 中の `<footer>` 出現回数 | ちょうど 1 | (新規) | critical |
| H-03 | `<!--<img` 等の不正コメント残存数 | 0 | `scripts/scan-broken-img.ts` | high |
| H-04 | `{{...}}` プレースホルダ残存数 | 0 | `scripts/fix-80-placeholders.ts` 流用 | critical |
| H-05 | published URL の HTTP 応答コード | 200 (一部 301 許容) | (新規 fetch) | critical |
| H-06 | 関連記事リンクの `generation_mode` 一致 | 同 mode 100% | `scripts/check-related-zerogen.ts` | high |
| H-07 | sitemap.xml が published 全件を出力 | 件数完全一致 | (新規) | high |
| H-08 | ハブ (zero-gen index) の記事数 vs DB zero-gen 数 | 一致 | `scripts/check-generation-mode-distribution.ts` | medium |
| H-09 | parity (`reviewed_at` ↔ `visibility_state`) | mismatch 0 件 | `scripts/verify-publish-state-parity.ts` | critical |
| H-10 | placeholder mismatched カウント | 全記事 0 | `scripts/inspect-remaining-parity.ts` | high |
| H-11 | CTA 出現回数 (`harmony-booking.web.app`) | 各記事 3 回 | (新規) | medium |
| H-12 | 免責事項 (disclaimer) 末尾付与有無 | 100% | (新規) | medium |

実装は `scripts/health/` 以下に集約し、`scripts/health/run-all.ts` が JSON サマリ (`out/health-YYYYMMDD.json`) を吐く。critical が 1 件でもあれば exit 1。

## 2. 実行方法

### 2.1 一次系: GitHub Actions cron (推奨)
- `.github/workflows/article-health.yml` を新設
- `schedule: - cron: '0 22 * * *'` (JST 7:00 / UTC 22:00)
- ジョブ: `npm ci` → `tsx scripts/health/run-all.ts`
- 結果アーティファクト保存 + Slack 通知 (`slackapi/slack-github-action`)
- Slack channel `#harmony-alerts` に critical/high 数と out URL を投稿

### 2.2 二次系: Vercel Cron (本番 fetch 系のみ)
- `/api/cron/health/url-probe` を新設し H-05 / H-07 のみを Vercel ランタイムから実行
- Edge ネットワーク経由で実 URL を叩くことで GitHub Actions では検知できないキャッシュ層異常を補足
- 実行ログは `health_check_runs` テーブルに INSERT (RLS service-role only)

### 2.3 通知ポリシー
- critical: Slack `@channel` メンション + GitHub Issue 自動起票
- high: Slack 通常通知のみ
- medium: 翌朝のダイジェストにまとめて投稿

## 3. 既存スクリプトの活用方針

| 既存 script | 流用先 | 変更点 |
|---|---|---|
| `scan-broken-img.ts` | H-03 | `--json` フラグ追加で機械可読出力 |
| `verify-publish-state-parity.ts` | H-09 | exit code 化 (mismatch>0 → 1) |
| `inspect-remaining-parity.ts` | H-10 | 同上 |
| `check-related-zerogen.ts` | H-06 | 集計ロジックを lib に切り出して共有 |
| `check-generation-mode-distribution.ts` | H-08 | hub HTML パース部を追加 |

共通化のため `src/lib/health/` 配下に `checkers/` (各 H-XX) と `runner.ts` を置き、CLI と Vercel cron の双方から import する。

## 4. 段階的導入計画

| フェーズ | 期間 | 動作 | ゲート |
|---|---|---|---|
| Phase 0 | 1 週 | dry-run のみ。Slack に warn だけ流す | 通知精度を観察 |
| Phase 1 | 2 週 | critical を Slack `@channel`、ただし CI は緑のまま | 誤検知率 <5% を目標 |
| Phase 2 | 以降 | critical で GitHub Actions 失敗 / Issue 自動起票 / `main` への merge をブロック | 連続 7 日 緑なら本番運用化 |
| Phase 3 | 安定後 | 本パイプラインを `npm run release` の pre-flight にも組み込み、デプロイ前ゲート化 | step9 自動 PR と統合 |

## 5. ロールアウト時の注意

- 1499 件の URL probe を毎日叩くため、`p-limit` で同時 8〜16 並列に絞り、UA に `harmony-health-monitor/1.0` を明示
- Slack 通知のレート制限を避けるため critical はバッチ化 (5 分以内に発生したものをまとめて 1 通)
- `reviewed_at` parity チェック (H-09) は §6 グローバル「無許可のアーキテクチャ変更禁止」に抵触しないよう、検出のみで自動修復しない
- `article_revisions` への履歴 INSERT を伴う修復は別バッチに切り離し、ヘルスチェック側からは触らない (HTML History Rule 厳守)
