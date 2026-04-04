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
