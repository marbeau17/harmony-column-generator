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
- Primary: #b39578 (ウォームブラウン)
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
