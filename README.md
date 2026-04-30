# Harmony Column Generator

スピリチュアルカウンセラー小林由起子さんのコラム自動生成システム。
アメブロの過去記事をベースに、SEO/AIO最適化されたオリジナルコラムをAIで自動生成し、管理ダッシュボードから編集・公開できます。

## 技術スタック

- **フレームワーク**: Next.js 14 (App Router)
- **データベース**: Supabase (PostgreSQL)
- **AI**: Gemini Pro 3.1
- **スタイリング**: TailwindCSS
- **エディタ**: Tiptap (リッチテキストエディタ)
- **バリデーション**: Zod
- **テスト**: Vitest / Playwright

## セットアップ手順

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.local` を作成し、以下の値を設定してください:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GEMINI_API_KEY=your_gemini_api_key
```

### 3. データベースのセットアップ

Supabaseダッシュボードの SQL Editor で `supabase/schema.sql` を実行するか、Supabase CLI を使用:

```bash
npx supabase db push
```

マイグレーションファイル: `supabase/migrations/20260404000000_initial_schema.sql`

### 4. シードデータの投入（任意）

```bash
npm run db:seed
```

### 5. 開発サーバーの起動

```bash
npm run dev
```

http://localhost:3000 にアクセスしてください。

## CSVインポート

アメブロの過去記事CSVをインポートするには:

```bash
npm run import:csv
# または
tsx scripts/import-csv.ts
```

プロジェクトルートに `ameblo_articles.csv` を配置してから実行してください。

## 主要機能

- **元記事管理**: アメブロ過去記事のCSVインポートと一覧管理
- **コラム自動生成**: Gemini Pro によるアウトライン生成 → 本文生成 → 校正の3段階AI生成パイプライン
- **リッチテキスト編集**: Tiptap エディタによる本文の手動編集・微調整
- **SEO/AIO最適化**: メタディスクリプション、FAQ構造化データ、AIOスコアの自動生成
- **品質チェック**: AI による文章品質・SEOスコアの自動評価
- **ペルソナ管理**: ターゲットペルソナの定義と記事トーンの最適化
- **テーマ管理**: スピリチュアルテーマのマスタ管理
- **記事リビジョン管理**: 編集履歴の自動保存
- **公開記事プレビュー**: `/column/[slug]` での公開記事表示
- **ダッシュボード**: 記事ステータスの一覧管理・ワークフロー

## CTA（予約リンク）

コラム内のCTAボタンは以下のURLに遷移します:

https://harmony-booking.web.app/

## npm scripts

| コマンド | 説明 |
|---|---|
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | プロダクションビルド |
| `npm run lint` | ESLint実行 |
| `npm run type-check` | TypeScript型チェック |
| `npm run test` | Vitestユニットテスト |
| `npm run test:e2e` | Playwright E2Eテスト |
| `npm run import:csv` | CSV記事インポート |
| `npm run db:seed` | シードデータ投入 |
| `npm run db:migrate` | マイグレーション実行 |
| `npm run db:generate` | Supabase型定義生成 |

---

## Publish Control V2

### 概要
記事の公開/非公開を「単一ボタン操作」で完結させる仕組み（commit `dcb596c`〜`6a0cd54` で出荷完了）。
DB↔FTP のドリフト（表示されっぱなし／されないまま）を構造的に防止する。

### 公開/非公開フロー
1. ダッシュボード `/dashboard/articles` で各記事行に表示される **PublishButton** をクリック
2. 状態は内部的に `visibility_state` 列で管理（`idle / deploying / live / live_hub_stale / unpublished / failed` の 6 値）
3. 公開時: DB UPDATE → FTP に記事 HTML アップロード → ハブページ再生成
4. 非公開時: ソフト撤回（noindex メタを含む通知 HTML で上書き、物理削除はしない）
5. ハブ再生成失敗時は `live_hub_stale` 状態に降格し、Slack 通知（設定時）

### 環境変数（必須・任意）

| Key | 必須 | 用途 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | anon キー |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | service role キー |
| `GEMINI_API_KEY` | ✅ | AI 生成用 |
| `FTP_HOST` / `FTP_USER` / `FTP_PASSWORD` / `FTP_REMOTE_PATH` | ✅ | FTP デプロイ |
| `PUBLISH_CONTROL_V2` | ✅ | サーバ側 API 有効化（`on`） |
| `PUBLISH_CONTROL_FTP` | ✅ | FTP 実通信有効化（`on`） |
| `NEXT_PUBLIC_PUBLISH_CONTROL_V2` | 推奨 | クライアント側新 UI 有効化（`on`） |
| `DANGLING_RECOVERY_TOKEN` | ✅ | dangling 自動回復 cron 認証 |
| `SLACK_WEBHOOK_URL` | 任意 | live_hub_stale 通知（未設定時 no-op） |
| `MONKEY_TEST` / `FTP_DRY_RUN` | テスト時のみ | E2E 用、本番は false |

詳細は `.env.local.example` を参照。

### 運用 SQL 集

Supabase ダッシュボード SQL Editor で実行:

```sql
-- 1. 現在の公開記事数（is_hub_visible=true）
SELECT COUNT(*) FROM articles WHERE is_hub_visible = true;

-- 2. visibility_state 分布
SELECT visibility_state, COUNT(*) FROM articles GROUP BY visibility_state;

-- 3. 直近 24h の公開イベント
SELECT action, hub_deploy_status, COUNT(*) FROM publish_events
WHERE created_at > now() - interval '24 hours' GROUP BY 1, 2;

-- 4. 失敗イベント直近 10 件
SELECT id, article_id, action, hub_deploy_error, actor_email, created_at
FROM publish_events
WHERE hub_deploy_status = 'failed'
ORDER BY created_at DESC LIMIT 10;

-- 5. dangling deploying 検出（自動回復前の手動確認用）
SELECT id, slug, visibility_updated_at FROM articles
WHERE visibility_state = 'deploying'
  AND visibility_updated_at < now() - interval '60 seconds';
```

### 監視 URL

- `/dashboard/publish-events` — publish_events 観察ダッシュボード（24h/7d/30d レンジ、失敗率、失敗イベント直近 10 件）
- GitHub Actions — `Dangling Recovery` ワークフロー（5 分間隔で自動実行）

### 自動回復・通知

- **dangling-deploying 自動回復**: GitHub Actions cron が 5 分間隔で `/api/dangling-recovery` を呼出。`visibility_state='deploying'` のまま 60 秒経過した記事を `failed` に遷移
- **Slack 通知**: hub rebuild 失敗時に `live_hub_stale` 状態へ降格 → `SLACK_WEBHOOK_URL` 設定時のみ通知

### ロールバック

```sql
-- RLS ポリシーを旧仕様（status='published' ベース）に戻す
DROP POLICY IF EXISTS "Published articles are public" ON articles;
CREATE POLICY "Published articles are public" ON articles
  FOR SELECT USING (status = 'published');
```

詳細手順は `supabase/migrations/20260425000000_publish_control_v2_rls_switch.sql` 末尾コメント参照。

---

## ドキュメント

- 仕様書: `docs/specs/publish-control/SPEC.md`
- 最新サイクルの作業仕様: `docs/optimized_spec.md`
- 実装進捗: `docs/progress.md`
- 評価レポート: `docs/feedback/eval_report.md`

---

## Zero-Generation V1（テーマ/ペルソナベース記事ゼロ生成）

### 概要
ソース記事に依存せず、テーマ + ペルソナ + キーワード + intent から記事を AI で生成。
**ハルシネーション 4 検証**（factual / attribution / spiritual / logical）と
**由起子トーン scoring**（14 項目 + 文体 centroid）が公開ゲートに連動。

### 生成方式の選択
- `/dashboard/articles/new-choice` — 既存ソース vs ゼロ生成 の 2 カードから選択
- 既存ソースから: `/dashboard/articles/new`
- ゼロ生成: `/dashboard/articles/new-from-scratch`

### パイプライン（8 LLM 呼出、並列化で実時間 ~35s）
1. Stage1 outline (テーマ/ペルソナ/intent → JSON)
2. RAG retrieve (1499 source 記事から top-5 grounding)
3. Stage2 writing (文体 DNA + grounding → HTML)
4. 並列検証:
   - claim 抽出 → 4 タイプハルシネーション検証
   - 由起子トーン scoring + centroid 類似度
5. 画像プロンプト生成 (3 枚、ペルソナ別ビジュアル)
6. CTA Variants 生成 (3 バリアント、utm_content)
7. articles INSERT + claims/cta_variants/article_revisions

### 公開ゲート（4 段階）
1. template_valid
2. quality_check.passed
3. reviewed_at IS NOT NULL
4. **hallucination critical = 0**（新追加）

### API
- `POST /api/articles/zero-generate-full` — 完全パイプライン実行
- `POST /api/articles/[id]/hallucination-check` — 再検証
- `POST /api/articles/[id]/regenerate-segment` — 文/章/全体の再生成

### 環境変数（追加分）
| Key | 必須 | 用途 |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | embedding (text-embedding-004) + 生成 |
| `GEMINI_VISION_MODEL` | 任意 | 画像 Vision 検査（default: gemini-2.5-flash） |

### 運用 SQL（追加）
```sql
-- 1. ゼロ生成記事数
SELECT count(*) FROM articles WHERE generation_mode='zero';

-- 2. ハルシネーション critical 残存記事
SELECT a.id, a.title, count(c.id) AS criticals
FROM articles a
LEFT JOIN article_claims c ON c.article_id=a.id AND c.risk='critical'
GROUP BY a.id, a.title HAVING count(c.id) > 0;

-- 3. トーン低い記事
SELECT id, title, yukiko_tone_score FROM articles
WHERE yukiko_tone_score < 0.80 ORDER BY yukiko_tone_score ASC LIMIT 10;
```

### 監視 URL
- `/dashboard/publish-events` — ハルシネ/トーン概況含む
- `/dashboard/articles` — 一覧にスコア列

### 仕様書
`docs/optimized_spec.md`（20 名専門家 spec、701 行）
