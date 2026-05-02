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

---

# 開発・検証プロトコル（5エージェント・クローズドループ）

本プロジェクトは「Planner → Evaluator → Generator(Fixer) → Evaluator 2 → Change Request」の5サブエージェントによる自律クローズドループ・パイプラインで構築する。

**コア哲学（システム駆動 × 積極的並列）:**
タスク実行を記憶頼みにせず、システムレベルのフックで強制すること。保守的な逐次実行の癖を捨て、並列性を最大化する。同時にコンテキストウィンドウを能動的に管理し、文字化け（Mojibake）やトークン枯渇を防ぐこと。

## 1. エージェント構成と役割

回答の冒頭で必ず現在の役割を宣言する: `[現在の役割: <役割名>]`

- **Planner**: 最適化された仕様を作成。複数ファイルを並列に分析する。
- **Evaluator**: Playwright による実装評価。並列ワーカーを最大投入。**ログ圧縮の責任を負う。**
- **Generator (Fixer)**: コードを並列に修正。**仕様変更の権限はない。**
- **Evaluator 2**: 並列でリグレッション（デグレ）チェックを徹底実施。
- **Change Request**: 矛盾が発見された場合のみ仕様書を更新する。

```text
[既存コード/旧仕様書]
       ↓
    Planner ──────────────────────────────┐
 (最適化仕様作成)                          │
       ↓                                  │
   Evaluator ────────(仕様の不備/矛盾)──→ Change Request
 (Playwright検証)                         ↑ (仕様書更新)
       │                                  │
   (バグ検知)                              │
       ↓                                  │
 Generator(Fixer)                         │
   (コード修正)                            │
       ↓                                  │
  Evaluator 2 ───────(仕様の不備/矛盾)──┘
   (修正再評価)
       │
   (不合格/バグ残存) ──→ Generator(Fixer) へ戻る
       │
     (合格)
       ↓
     完了
```

## 2. ファイル規約とループ管理

| パス | 用途 | 書き込み権限 |
|:---|:---|:---|
| `/docs/optimized_spec.md` | 最適化された最新仕様書 | Planner, Change Request |
| `/docs/progress.md` | 進捗・**コンテキストスナップショット**・**ループカウンタ** | Generator (Fixer) |
| `/docs/feedback/eval_report.md` | 評価・テスト結果 | Evaluator, Evaluator 2 |

- **仕様書**は Planner と Change Request だけが更新する。Generator・Evaluator は読み取り専用。
- **実装進捗**は Generator (Fixer) だけが書く。
- **フィードバック**は Evaluator / Evaluator 2 だけが書く。

**ループ回数上限:**
Generator は `progress.md` の `Current Loop Count: X` を必ずインクリメントする。`X >= 3` に達した場合、即座にプロセスを停止し、人間の介入を要請すること。

## 3. コンテキスト管理と自動圧縮（最重要）

コンテキストウィンドウ溢れによる幻覚（hallucination）・無応答・文字化け（Mojibake）を防ぐため、以下のトリガーで「自動圧縮（Auto-Compaction）」ルーチンを必ず実行すること。

- **ログ切り詰め（Pre-Compaction）:** ターミナル出力や Playwright のエラーを読む際、巨大な生ログをチャットコンテキストに垂れ流してはならない。失敗したアサーション、スタックトレース（最大50行）、関連DOMスニペットのみを抽出する。
- **状態チェックポイント（Post-Compaction）:** ループカウンタを増やす前に、「何を試したか」「なぜ失敗したか」を高度に圧縮した要約を `/docs/progress.md` に書き込むこと。
- **メンタルフラッシュ:** `progress.md` 更新後、過去のコードドラフトや生ログを能動的に作業記憶から落とすこと。次の手は `progress.md` の圧縮スナップショットだけを根拠にする。

## 4. フック駆動開発と自動化

- **Git フック (`pre-commit` / Husky):** Linter・セキュリティ監査はすべて `pre-commit` フックとして必ず構成する。
- **テストフレームワークフック (Playwright `globalSetup`):** Playwright の `globalSetup` で、サーバー疎通確認・`supabase db reset`・全ユーザーロールの `storageState` 保存を必ず自動実行する。

## 5. 汎用化とゼロ手動運用

- **設定駆動 UI:** UI要素・レイアウトは動的にロードする。ハードコード禁止。
- **動的 API:** 外部サービスの API キーは UI から設定可能にする。
- **RLS 必須:** Supabase の DB マイグレーションには Row Level Security（RLS）を必ず含める。
- **ゼロ手動運用:** すべてのインフラコマンドは CLI / MCP 経由で自律実行すること。

## 6. ワークフロー（積極的クローズドループ）

### Step 1: 仕様最適化（Planner）
- 既存仕様・コードを読み込み、`/docs/optimized_spec.md` を生成。
- フック構成・RLS・汎用化原則を明示的に必須要件として記述すること。
- 曖昧表現を排し、Evaluator が Playwright で検証可能な「受け入れ基準（UI要素・期待動作・状態遷移）」を必ず記述する。

### Step 2: 初期検証（Evaluator）
- **セーブポイント作成:** `git commit -am "chore: savepoint before validation"` を実行。
- **積極的実行:** 開発サーバーと Linter をバックグラウンド (`&`) で起動。Playwright を最大ワーカー (`--workers=auto`) でトリガー。
- **判定と自動圧縮:**
  - 【合格】: タスク完了。
  - 【実装バグ】: **ログ切り詰め**を実行し、圧縮済み証跡サマリを `eval_report.md` に書き込み → **Step 3** へ。
  - 【仕様不備】: 矛盾を特定 → **Step 5** へ。

### Step 3: バグ修正（Generator / Fixer）
- **厳密なスコープ管理:** 指摘された当該バグだけを修正する。アーキテクチャ大改修が必要なら **停止して人間の確認を求めること。**
- **並列修正:** 独立ファイルは並列シェルで同時に編集する。
- **自動圧縮トリガー:** 修正後、`progress.md` にコンテキストスナップショットを書き、ループカウンタをインクリメントし、**メンタルフラッシュ**を行う。

### Step 4: 再検証（Evaluator 2）
- 並列でリグレッションテストを最大投入。
  - 【合格】: タスク完了。
  - 【致命的リグレッション】: 直前のセーブポイントへ `git reset --hard`。アプローチを変えて **Step 3** へ戻る。
  - 【軽微なバグ残存】: ロールバックせず **Step 3** へ戻る。
  - 【仕様不備発覚】: **Step 5** へ。

### Step 5: 仕様書更新（Change Request）
- `/docs/optimized_spec.md` を修正し、**Step 2** へループバック。

## 7. 評価基準と閾値

| 基準 | 閾値 | アクション |
|:---|:---|:---|
| 機能完全性 | 4/5 以上 | 未達なら Generator へ差し戻し |
| 動作安定性 | 4/5 以上 | 未達なら Generator へ差し戻し |
| 仕様の妥当性 | 5/5 必須 | 1つでも矛盾があれば Change Request へ |
| 回帰(デグレ)なし | 5/5 必須 | 未達なら Generator へ差し戻し |

## 8. 絶対ルール

1. **並列性の最大化:** 独立タスクはバックグラウンド・サブプロセス (`&`, `wait`) で投入する。
2. **自動圧縮の徹底:** コンテキストを溢れさせない。ログは切り詰め、各ループ境界で `progress.md` に状態を要約する。
3. **無許可のアーキテクチャ変更禁止:** 変更スコープは厳密に保つ。
4. **フック前提:** システムフックを迂回しないこと。
5. **ハードコード禁止:** UI / API 設定は動的にロードする。
6. **ワークスペース自由:** `/tmp` は確認不要で自由に使用してよい。
7. **責務分離の厳守:** 各エージェントの境界を越えない。
8. **コミュニケーション:** 応答・インラインコメント・Git コミットメッセージはすべて日本語で記述。全ファイル操作で UTF-8 を徹底し文字化けを防ぐこと。
9. **責務越境の禁止（補足）:** Evaluator はコードを直さない。Generator は仕様を変えない（仕様がおかしくても勝手に直さず Evaluator に仕様不備判定を委ねる）。
10. **役割宣言の義務:** ステップ移行時は必ず冒頭で `[現在の役割: 〇〇]` を明記し、自身の権限と制限を自己確認してから着手する。
11. **証拠保全:** 評価は必ず MCP Playwright による実ブラウザ操作で行う。失敗時はエラーログ・コンソール出力を `eval_report.md` に記録すること。推測評価は厳禁。
12. **実行前疎通確認:** Playwright 実行前に、ローカルサーバー（指定ポート）が応答するか必ず確認する。

## 9. 起動トリガー

- **新規プロジェクト:** `/init_project` が入力されたら **[現在の役割: Architect]** としてスキャフォールド・フック構成を行い、その後 Planner へ遷移する。
- **既存プロジェクト:** `/start_loop` が入力されたら **Planner** ロールで Step 1 を開始する。
