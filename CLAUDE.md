# Harmony Column Generator

## プロジェクト概要
スピリチュアルカウンセラー小林由起子さんの1,499件のアメブロ過去記事を元に、
視点を変換したオリジナルコラムを自動生成するシステム。

## 技術スタック
- Next.js 14 (App Router) + TypeScript
- Supabase (PostgreSQL + Auth + Storage)
- Gemini Pro 3.1 (テキスト生成)
- Banana Pro (画像生成)
- TailwindCSS + TipTap Editor
- Vercel (デプロイ)

## 重要な仕様
- CTA: https://harmony-booking.web.app/ への誘導を各記事に3回配置（必須）
- 記事文字数: 約2,000文字（設定で変更可能）
- 画像: Banana Pro で3枚/記事（hero/body/summary）
- 既存サイト: https://harmony-mc.com/column/ と調和するデザイン
- apolloONEBlog (marbeau17/apolloONEBlog) のコードを最大限流用

## カラーパレット
- Primary: #8b6f5e (ウォームブラウン — WCAG AA準拠に調整済み)
- Dark: #53352b (ダークブラウン)
- Gold: #d4a574 (アクセント)
- Background: #faf3ed (クリームベージュ)

## ブランチ戦略
- main: 本番
- develop: 開発統合

## コマンド
- `npm run dev` - 開発サーバー
- `npm run build` - ビルド
- `npm run test` - テスト
- `tsx scripts/import-csv.ts` - CSVインポート
- `tsx scripts/seed.ts` - 初期データ投入

## ディレクトリ構成
- src/app/ - Next.js App Router pages & API routes
- src/lib/ai/ - Gemini AI client & prompts
- src/lib/db/ - Supabase database access layer
- src/lib/content/ - CTA generator, source analyzer, perspective transform
- src/lib/seo/ - Structured data, meta generator, score calculator
- src/lib/generators/ - HTML generator (from apolloONEBlog)
- src/components/ - React components
- supabase/ - Database schema
- scripts/ - Import & seed scripts
- templates/ - HTML/CSS templates

## 注意事項
- .env.localにSupabaseとGeminiのキーが必要
- 医療アドバイス・宗教的断定はAI生成で禁止
- 免責事項を全記事末尾に自動付記

## プロジェクト固有の禁止事項
- 関連記事 (related_articles) は同じ generation_mode の記事のみで構成すること
- 関連記事の候補が 3 件未満の場合は空配列で保存すること
- cross-mode (zero ↔ source) の関連付けは禁止

## アンチパターン (P5-31〜P5-59 で繰り返し発生)

- **HTML を `string.replace(regex)` で操作するな**: 必ず htmlparser2/cheerio を使う。
  理由: P5-49 (buildBodyWithCtas h3 削除過剰), P5-57 (placeholder regex で `-->` 消失) で同種バグ
- **`[\s\S]*?` で複数行マッチするな**: 段落跨ぎで本文消失。
- **`{1,200}` などの数値範囲 fallback regex は使うな**: P5-55 で本文 200 文字消失バグ
- **fetch のエラーを catch で握り潰すな**: 必ず toast / logger.error で UI に伝える
- **AI 出力を信用するな**: prompt で「必ず X 形式」と指示しても破られる前提で schema validation
- **同じロジックを複数ファイルに書くな**: replace-placeholders 等は src/lib/ に集約して共有

---

# プロジェクト固有の拡張ルール（グローバル `~/.claude/CLAUDE.md` への追補）

5エージェント・クローズドループ（Planner / Evaluator / Generator / Evaluator 2 / Change Request）の構成、役割定義、ファイル規約 (`/docs/optimized_spec.md` / `/docs/progress.md` / `/docs/feedback/eval_report.md`)、ループカウンタ上限 (3)、RLS・フック・設定駆動原則、絶対ルール（役割宣言／責務越境禁止／並列性最大化 等）はすべて **グローバル `~/.claude/CLAUDE.md` を継承する**。

本ファイルは **そのうえで本プロジェクト固有の拡張・上書き** のみを記載する。本ファイルが沈黙している項目はグローバルに従うこと。

---

## 1. 二段チェックリスト規約（仕様書フォーマット）

`/docs/optimized_spec.md` の全機能・受け入れ基準は、実装と検証を独立に追跡できるよう、必ず以下のネストされたチェックリスト形式で記述する。

```markdown
- 機能名 / 受け入れ基準
  - [ ] Implemented (Generator)
  - [ ] Tested (Evaluator 2)
```

**グローバル §4.2「ファイル規約」への書込権限追補:**

| 対象 | 切替権限 | タイミング |
|:---|:---|:---|
| `[ ] Implemented` → `[x]` | Generator (Fixer) | Step 3 の最後、コード編集完了直後 |
| `[ ] Tested` → `[x]` | Evaluator 2 | Step 4 の最後、PASS した場合のみ |
| 仕様本文（その他の記述） | Planner / Change Request のみ | （グローバル §4.2 のまま） |

Generator と Evaluator 2 は **自身に割り当てられたチェックボックスのみ** をトグルでき、仕様本文の他の部分を編集してはならない。

## 2. Playwright マルチレポーター運用

Step 2（Evaluator）および Step 4（Evaluator 2）で Playwright を起動するときは、必ず人間可読レポーターと JSON レポーターを並列に出力する。AI による解析と IDE のストリーミング表示を両立させるため。

```bash
npx playwright test --workers=auto --reporter=line,json --output=/tmp/pw-results
```

- JSON レポートは `jq` / `grep` で失敗アサーションを抽出する。
- `/docs/feedback/eval_report.md` には **関連スタックトレース／失敗アサーションを 20〜30 行のみ** 貼る。フルログ垂れ流し禁止。
- **stdout をファイルにパイプするな**: Console Ninja 等の IDE 統合がリアルタイムで stdout を消費する。AI 解析用には JSON レポーターの **ファイル出力** を使い、stdout は IDE に渡したまま保持すること。

## 3. 非対話シェルの強制

エージェントループ中の TTY ハングを防ぐため、すべての CLI コマンドは自動承認／非対話フラグで実行する。

- npm: `npm ci --no-audit --no-fund`, `npm install -y`
- Supabase: `supabase ... --yes`, `supabase db reset --yes`
- 汎用: `CI=true`, `-y`, `--yes`, `--force`（対応コマンドのみ）
- **禁止フラグ:** `git rebase -i`, `git add -i`, その他プロンプト駆動モード一切

## 4. 自律圧縮（グローバル §4.4 を上書き）

本パイプラインは **`/compact` 要求や続行確認のために停止しない**。グローバル §4.3 のループ上限 (3) のみが、人間介入のトリガーである。

Step 3 終了時の手順:

1. 「何を試したか／なぜ失敗したか／何を変えたか」の圧縮済みスナップショットを `/docs/progress.md` に書き込む。
2. 生ログ・中間ドラフト・失敗トレースの一切を能動的に作業記憶から落とす。
3. `progress.md` のスナップショットだけを根拠に、即座に Step 4 へ進む。
