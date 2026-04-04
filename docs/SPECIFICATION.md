# Harmony Spiritual Column Auto-Generator
## 統合仕様書 v1.0

**プロジェクト名:** harmony-column-generator  
**作成日:** 2026-04-03  
**作成者:** 20名エージェントチーム（ノリオライター4名、ブログエキスパート3名、SEOエキスパート4名、UI/UXエンジニア3名、スピリチュアルカウンセラー2名、ディレクター4名）

---

## 目次

1. [プロジェクト概要](#1-プロジェクト概要)
2. [技術スタック](#2-技術スタック)
3. [apolloONEBlog流用マップ](#3-apollooneblog流用マップ)
4. [システムアーキテクチャ](#4-システムアーキテクチャ)
5. [AI記事生成パイプライン](#5-ai記事生成パイプライン)
6. [コンテンツ戦略](#6-コンテンツ戦略)
7. [ペルソナ設計](#7-ペルソナ設計)
8. [SEO/AIO対策](#8-seoaio対策)
9. [CTA設計](#9-cta設計)
10. [画像生成設計](#10-画像生成設計)
11. [データベース設計](#11-データベース設計)
12. [API設計](#12-api設計)
13. [管理画面UI設計](#13-管理画面ui設計)
14. [公開ページ設計](#14-公開ページ設計)
15. [プロンプト設計書](#15-プロンプト設計書)
16. [スピリチュアルコンテンツガイドライン](#16-スピリチュアルコンテンツガイドライン)
17. [テクニカルSEO](#17-テクニカルseo)
18. [運用・分析設計](#18-運用分析設計)
19. [セキュリティ・品質保証](#19-セキュリティ品質保証)
20. [開発フェーズ計画](#20-開発フェーズ計画)

---

## 1. プロジェクト概要

### 1.1 ビジョン

スピリチュアルカウンセラー小林由起子さんの1,499件のアメブロ過去記事を資産として最大活用し、**視点を変換したオリジナルコラム**を自動生成する。AIO/SEO最適化により検索流入を最大化し、予約サイト（https://harmony-booking.web.app/）へのコンバージョンを促進する。

### 1.2 核心コンセプト

```
過去記事(1,499件) → AI視点変換 → SEO/AIO最適化コラム → 予約コンバージョン
```

- **オーバーライト**: 過去記事を元にしつつ、視点・切り口を完全変更
- **AIO/SEO**: Google AI Overview採用を狙った構造化コンテンツ
- **CTA 3回配置**: 各記事に https://harmony-booking.web.app/ への誘導を3箇所
- **画像3枚**: Banana Pro（Gemini画像生成）で記事に馴染む画像を自動生成
- **記事文字数**: 約2,000文字（設定で変更可能）

### 1.3 成功指標（KPI）

| KPI | 目標値 | 測定方法 |
|-----|--------|---------|
| 月間コラム生成数 | 20-30本 | システムダッシュボード |
| オーガニック流入 | 前月比 +15% | GA4 |
| CTA クリック率 | 3%以上 | UTMパラメータ追跡 |
| 予約コンバージョン率 | 0.5%以上 | harmony-booking.web.app 側測定 |
| AIO 採用率 | 10%以上（対象KW） | Search Console + 手動確認 |
| 平均滞在時間 | 2分以上 | GA4 |

### 1.4 スコープ

**MVP（Phase 1）:**
- 過去記事CSVインポート
- AI記事生成パイプライン（アウトライン→本文→校正）
- 管理画面（記事一覧・編集・プレビュー）
- CTA 3回自動配置
- 画像プロンプト自動生成

**Phase 2:**
- SEO/AIOスコアリング自動化
- 画像自動生成（Banana Pro連携）
- コンテンツカレンダー自動生成
- GA4連携ダッシュボード

**Phase 3:**
- 自動公開スケジューリング
- パフォーマンスベースの自動改善提案
- A/Bテスト機能

---

## 2. 技術スタック

### 2.1 確定技術スタック

| レイヤー | 技術 | apolloONEBlogからの変更 |
|---------|------|----------------------|
| **フレームワーク** | Next.js 14 (App Router) | そのまま流用 |
| **言語** | TypeScript 5.5+ | そのまま流用 |
| **UI** | React 18 + TailwindCSS 3.4 + TipTap | そのまま流用 |
| **データベース** | **Supabase（PostgreSQL）** | Prisma → Supabase Client に変更 |
| **認証** | **Supabase Auth** | NextAuth.js → Supabase Auth に変更 |
| **AI（テキスト）** | **Gemini Pro 3.1** | gemini-3-pro-preview → gemini-pro-3.1 |
| **AI（画像）** | **Banana Pro（Gemini画像生成）** | そのまま流用（モデル名変更） |
| **ストレージ** | **Supabase Storage** | Vercel Blob → Supabase Storage |
| **ホスティング** | **Vercel** | そのまま流用 |
| **検証** | Zod | そのまま流用 |
| **HTMLパース** | Cheerio | そのまま流用 |
| **テスト** | Vitest + Playwright | そのまま流用 |

### 2.2 変更理由

- **Supabase**: PostgreSQL + Auth + Storage が統合されており、Prisma + NextAuth + Vercel Blob の3つを1サービスに集約できる
- **Gemini Pro 3.1**: 最新モデルによる高品質生成
- **FTP不要**: Vercelでの直接デプロイに統一（harmony-mc.comとの連携はAPIまたはiframe）

---

## 3. apolloONEBlog流用マップ

### 3.1 そのまま流用するモジュール

| モジュール | ファイル | 流用度 |
|-----------|---------|--------|
| **Gemini APIクライアント** | `src/lib/ai/gemini-client.ts` (541行) | 95%流用（モデル名変更のみ） |
| **プロンプトチェーン** | `src/lib/ai/prompt-chain.ts` (475行) | 80%流用（プロンプト内容変更） |
| **HTML生成エンジン** | `src/lib/generators/html-generator.ts` (527行) | 70%流用（テンプレート変更） |
| **関連記事エンジン** | `src/lib/generators/related-articles.ts` (193行) | 90%流用（car model→spiritual terms） |
| **ハブページ管理** | `src/lib/generators/hub-updater.ts` (154行) | 85%流用 |
| **HTMLパーサー** | `src/lib/html/parser.ts` (189行) | 95%流用 |
| **テンプレートエンジン** | `src/lib/html/template-engine.ts` (94行) | 90%流用 |
| **バリデーター** | `src/lib/validators/*.ts` | 70%流用（スキーマ変更） |
| **ロガー** | `src/lib/logger.ts` | 100%流用 |
| **TipTapエディタ** | `src/components/editor/TipTapEditor.tsx` | 95%流用 |
| **HTMLエディタ** | `src/components/editor/HtmlEditor.tsx` | 95%流用 |
| **プレビューペイン** | `src/components/editor/PreviewPane.tsx` | 80%流用 |
| **ステータスバッジ** | `src/components/common/StatusBadge.tsx` | 70%流用（ステータス名変更） |
| **テーマプロバイダー** | `src/components/providers/ThemeProvider.tsx` | 100%流用 |
| **型定義** | `src/types/ai.ts` (193行) | 80%流用 |

### 3.2 大幅カスタマイズするモジュール

| モジュール | 変更内容 |
|-----------|---------|
| **プロンプトテンプレート** (`src/lib/ai/prompts/*`) | 中古車→スピリチュアルに全面書き換え |
| **HTMLテンプレート** (`templates/article-v21.html`) | カラー・構成・CTA全面変更 |
| **CSS** (`templates/css/article-v21.css`) | #b22222→#b39578、スピリチュアル世界観 |
| **記事ステータス管理** (`src/lib/db/articles.ts`) | Supabase対応＋ステータス簡略化 |
| **レイアウト** (`src/components/layout/*`) | ブランドカラー・ナビ変更 |
| **管理画面ページ** (`src/app/(admin)/*`, `src/app/(tenant)/*`) | スピリチュアル向けUI |

### 3.3 不要・削除するモジュール

| モジュール | 理由 |
|-----------|------|
| `src/lib/ftp/*` | Vercelデプロイに統一、FTP不要 |
| `src/lib/encryption.ts` | FTPパスワード暗号化不要（Supabase管理） |
| `src/lib/csv/shopinfo-parser.ts` | 店舗情報不要 |
| `src/lib/auth/*` (NextAuth) | Supabase Auth に置換 |
| マルチテナント機能 | シングルテナント運用 |
| サブスクリプション管理 | 不要 |

### 3.4 新規開発モジュール

| モジュール | 目的 |
|-----------|------|
| **過去記事解析エンジン** | 1,499件CSV→テーマ抽出・分類 |
| **視点変換エンジン** | 元記事→新コラムへの変換ロジック |
| **CTA自動配置エンジン** | 3箇所のCTA最適配置 |
| **画像プロンプト生成** | Banana Pro用プロンプト自動生成 |
| **SEO/AIOスコアリング** | 自動品質スコア算出 |
| **Supabase連携層** | Auth + DB + Storage統合 |
| **構造化データ生成** | JSON-LD（Article, FAQ, Person等） |

---

## 4. システムアーキテクチャ

### 4.1 全体構成図

```
┌─────────────────────────────────────────────────────┐
│                    Vercel (hnd1)                      │
│  ┌───────────────────────────────────────────────┐   │
│  │          Next.js 14 App Router                 │   │
│  │  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │   │
│  │  │ 管理画面  │  │ 公開ページ │  │  API Routes  │ │   │
│  │  │ (Admin)  │  │ (Column) │  │  /api/*     │ │   │
│  │  └──────────┘  └──────────┘  └─────────────┘ │   │
│  └───────────────────────────────────────────────┘   │
└────────────────────┬──────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
┌──────────────┐ ┌────────┐ ┌──────────────────┐
│   Supabase   │ │ Gemini │ │  External Sites  │
│ ┌──────────┐ │ │Pro 3.1 │ │                  │
│ │PostgreSQL│ │ │        │ │ harmony-mc.com   │
│ │  Auth    │ │ │Banana  │ │ harmony-booking  │
│ │ Storage  │ │ │ Pro    │ │   .web.app       │
│ └──────────┘ │ └────────┘ └──────────────────┘
└──────────────┘
```

### 4.2 データフロー

```
[過去記事CSV 1,499件]
        │
        ▼
[CSVインポート] → [Supabase: source_articles テーブル]
        │
        ▼
[テーマ抽出・分類] → [テーマ/キーワードDB]
        │
        ▼
[ペルソナ・テーマ・KW選択]（管理画面 or 自動）
        │
        ▼
[Stage 1: アウトライン生成] ← Gemini Pro 3.1
        │  出力: タイトル, メタ, H2/H3構成, CTA位置, 画像位置
        ▼
[Stage 2: 本文生成（3ステップチェーン）] ← Gemini Pro 3.1
        │  Step A: 執筆（2,000文字、CTA3箇所、画像PH3箇所）
        │  Step B: 校正（文法、トーン、スピリチュアル用語）
        │  Step C: 品質チェック（倫理、医療境界、E-E-A-T）
        ▼
[Stage 3: 画像プロンプト生成] → Banana Pro用プロンプト×3
        │
        ▼
[人間レビュー・編集]（管理画面: TipTapエディタ）
        │
        ▼
[SEO/AIOスコアチェック]
        │
        ▼
[公開] → Vercel SSG → harmony-mc.com 連携
```

---

## 5. AI記事生成パイプライン

### 5.1 パイプライン概要（apolloONEBlog 3段階方式を流用）

| ステージ | 目的 | Gemini設定 | apolloONEBlogからの変更 |
|---------|------|-----------|----------------------|
| **Stage 1** | アウトライン生成 | temp:0.8, tokens:8192 | プロンプト全面変更、文字数2000字 |
| **Stage 2A** | 本文執筆 | temp:0.7, tokens:8192 | プロンプト全面変更、CTA3箇所 |
| **Stage 2B** | 校正 | temp:0.3, tokens:8192 | チェック項目変更（スピリチュアル用語） |
| **Stage 2C** | 品質チェック | temp:0.2, tokens:8192 | 倫理チェック追加 |
| **Stage 3** | 画像プロンプト | temp:0.7, tokens:4096 | 新規追加 |

### 5.2 Gemini API統合仕様（gemini-client.ts 流用）

```typescript
// apolloONEBlogのgemini-client.tsをベースに変更
const DEFAULT_CONFIG = {
  model: 'gemini-pro-3.1',           // 変更: gemini-3-pro-preview → gemini-pro-3.1
  imageModel: 'banana-pro',           // 変更: gemini-3-pro-image-preview → banana-pro
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192,              // 変更: 12288 → 8192（2000字記事のため）
  timeoutMs: 120000,
  maxRetries: 1,
};
```

**流用するAPI関数:**
- `callGemini()` - ベースAPI呼び出し（リトライ、タイムアウト対応）
- `generateText()` - テキスト生成
- `generateJson<T>()` - JSON生成（切り詰めJSON修復機能付き）
- `generateWithHistory()` - 会話履歴付き生成（校正・品質チェック用）
- `generateImage()` - Banana Pro画像生成
- `estimateTokens()` - トークン推定（日本語1.5文字/token）

### 5.3 プロンプトチェーン（prompt-chain.ts 流用）

apolloONEBlogの `executeStage2Chain()` をそのまま流用し、以下を変更:
- プロンプトテンプレートの内容（→ スピリチュアル向け）
- CTA文言とリンク先（→ https://harmony-booking.web.app/）
- 画像プレースホルダ数（→ 3枚固定）
- 文字数制限（→ 2,000文字）
- Chart.js関連の削除（不要）

**フォールバック戦略（そのまま流用）:**
1. Step A（執筆）失敗 → チェーン中断、ステータスロールバック
2. Step B（校正）失敗 → スキップ、元テキストで続行
3. Step C（品質チェック）失敗 → スキップ、校正結果で続行

### 5.4 過去記事解析エンジン（新規開発）

```typescript
interface SourceArticleAnalysis {
  id: string;
  originalTitle: string;
  themes: string[];           // 抽出テーマ（3-5個）
  keywords: string[];         // 抽出キーワード
  emotionalTone: string;      // 感情トーン（希望、癒し、学び、共感等）
  targetLifeStage: string;    // 対象ライフステージ
  spiritualConcepts: string[];// スピリチュアル概念
  perspectiveType: string;    // 元記事の視点タイプ
  suggestedTransforms: PerspectiveTransform[];  // 推奨視点変換
}
```

### 5.5 視点変換エンジン（新規開発）

| 変換パターン | 説明 | 例 |
|-------------|------|-----|
| **体験談→教訓型** | 個人エピソード → 普遍的な気づき | 「私のカウンセリング体験」→「人生の転機で大切な3つのこと」 |
| **個人→普遍** | 1人の話 → 誰もが共感できる話 | 「Aさんの離婚」→「人生の選択に迷ったとき」 |
| **概念→実践** | スピリチュアル概念 → 日常に使える方法 | 「カルマの法則」→「今日からできるカルマの浄化法」 |
| **事例→ワーク** | カウンセリング事例 → 読者参加型 | 「霊視で見えた前世」→「自分の前世を感じる瞑想ワーク」 |
| **過去→現代** | 過去の学び → 現代課題への応用 | 「古代の智慧」→「AI時代に必要なスピリチュアル的視点」 |
| **深掘り→入門** | 専門的内容 → 初心者向け解説 | 「エネルギーワーク詳細」→「はじめてのエネルギーワーク」 |

---

## 6. コンテンツ戦略

### 6.1 テーマ分類体系

**大カテゴリ（7種）:**

| カテゴリ | サブカテゴリ例 | エネルギーメソッド |
|---------|--------------|----------------|
| **魂と使命** | 魂の旅、前世、人生の目的、使命 | 光 |
| **人間関係** | パートナーシップ、親子、離婚、結婚 | 水 |
| **グリーフケア** | ペットロス、死別、スピリチュアルメッセージ | 地 |
| **自己成長** | 自己否定、自信、直感力、潜在意識 | 火 |
| **癒しと浄化** | チャクラ、エネルギーワーク、瞑想 | 風 |
| **日常の気づき** | シンクロニシティ、感謝、マインドフルネス | 空 |
| **スピリチュアル入門** | 基礎知識、FAQ、よくある誤解 | 光 |

### 6.2 コンテンツクラスター戦略

**ピラーページ（7本）:**
1. スピリチュアルカウンセリングとは
2. 霊視・前世カウンセリングの世界
3. 人間関係の悩みをスピリチュアルに解く
4. グリーフケアとスピリチュアル
5. エネルギーワーク入門
6. 自分を知る・直感力を磨く
7. 日常に活かすスピリチュアル

各ピラーから5-15本のクラスター記事を展開。

### 6.3 記事構成テンプレート（約2,000文字）

```
[画像1: ヒーロー画像] ← Banana Pro生成
[CTA①: 導入後] ← 認知フェーズ

## 導入（200-300文字）
- 読者の悩み・疑問に共感
- 記事で得られる気づきの予告

## 本論セクション1（400-500文字）
- 核心メッセージ

[画像2: 本文挿入画像] ← Banana Pro生成

## 本論セクション2（400-500文字）
- 具体例・ワーク

[CTA②: 中盤] ← 共感フェーズ

## まとめ・メッセージ（300-400文字）
- 読者への励まし
- 実践のヒント

[画像3: まとめ画像] ← Banana Pro生成
[CTA③: 末尾] ← 行動フェーズ

[FAQ（構造化データ付き）]（200-300文字）
```

### 6.4 ライティングスタイルガイド

| 要素 | ルール |
|------|--------|
| **文体** | です・ます調、柔らかく温かい語り口 |
| **一文の長さ** | 最大60文字（可読性重視） |
| **段落** | 2-3文で1段落、適度な改行 |
| **漢字比率** | 30%以下（読みやすさ） |
| **専門用語** | 初出時は必ず簡潔な説明を付記 |
| **断定表現** | 「〜かもしれません」「〜と言われています」（柔らかい表現） |
| **禁止表現** | 不安を煽る表現、医療断定、宗教の優劣比較 |

---

## 7. ペルソナ設計

### 7.1 ターゲットペルソナ（7種）

#### ペルソナ1: 「はじめてのスピリチュアル」美咲（32歳）
- **属性**: 会社員、独身、都市部在住
- **知識レベル**: 初心者（ヨガ・パワースポットは好き）
- **悩み**: 漠然とした不安、将来への迷い
- **検索例**: 「スピリチュアル 意味」「直感 鍛え方」
- **CTA反応ポイント**: 「あなたの悩みに寄り添います」系

#### ペルソナ2: 「転機のとき」恵子（45歳）
- **属性**: パート、既婚・子あり、夫との関係に悩み
- **知識レベル**: 中級（本は数冊読んだ）
- **悩み**: 離婚を考えている、自分の人生の方向性
- **検索例**: 「人生の転機 スピリチュアル」「離婚 魂の選択」
- **CTA反応ポイント**: 「一人で抱えないでください」系

#### ペルソナ3: 「癒しを求めて」由美（55歳）
- **属性**: 主婦、夫と死別 or ペットロス
- **知識レベル**: 中級
- **悩み**: 大切な存在を亡くした悲しみ
- **検索例**: 「亡くなった人 メッセージ」「ペットロス スピリチュアル」
- **CTA反応ポイント**: 「あの人からのメッセージを受け取りませんか」系

#### ペルソナ4: 「スピリチュアルを深めたい」真理子（38歳）
- **属性**: フリーランス、スピリチュアル実践者
- **知識レベル**: 上級
- **悩み**: もっと深い気づきを得たい、能力開花
- **検索例**: 「前世 カルマ 解消」「チャクラ 開く方法」
- **CTA反応ポイント**: 「プロのカウンセリングで次のステージへ」系

#### ペルソナ5: 「子育てに悩む」さくら（35歳）
- **属性**: 専業主婦、子育て中、不妊経験あり
- **知識レベル**: 初〜中級
- **悩み**: 子育ての不安、不妊、子どもの個性
- **検索例**: 「不妊 スピリチュアル 意味」「子育て 魂の約束」
- **CTA反応ポイント**: 「お子様との魂の絆を紐解きます」系

#### ペルソナ6: 「心の病と向き合う」あかり（28歳）
- **属性**: 会社員、うつ・不安障害の経験
- **知識レベル**: 初心者
- **悩み**: 心の病からの回復、自己肯定感
- **検索例**: 「スピリチュアル 自己肯定感」「心が軽くなる 方法」
- **CTA反応ポイント**: 「心の重荷を軽くするお手伝い」系（※医療との境界に注意）

#### ペルソナ7: 「シニアの生き方」和子（65歳）
- **属性**: 退職後、孫あり、人生の総括期
- **知識レベル**: 中級（信仰心あり）
- **悩み**: 残りの人生の意味、死生観
- **検索例**: 「人生の意味 スピリチュアル」「死後の世界」
- **CTA反応ポイント**: 「これまでの人生を、魂の視点で振り返る」系

### 7.2 ペルソナ×テーママトリクス

| テーマ＼ペルソナ | 美咲 | 恵子 | 由美 | 真理子 | さくら | あかり | 和子 |
|--------------|------|------|------|--------|--------|--------|------|
| 魂と使命 | ○ | ◎ | ○ | ◎ | ○ | △ | ◎ |
| 人間関係 | ◎ | ◎ | ○ | ○ | ◎ | ◎ | ○ |
| グリーフケア | △ | ○ | ◎ | ○ | △ | △ | ◎ |
| 自己成長 | ◎ | ◎ | ○ | ◎ | ○ | ◎ | ○ |
| 癒しと浄化 | ○ | ○ | ◎ | ◎ | ○ | ◎ | ○ |
| 日常の気づき | ◎ | ○ | ○ | ○ | ◎ | ◎ | ◎ |
| 入門 | ◎ | ○ | △ | △ | ○ | ◎ | △ |

◎=最適, ○=適合, △=部分適合

---

## 8. SEO/AIO対策

### 8.1 オンページSEO仕様

#### メタタイトル自動生成ルール
- 文字数: 28-35文字
- 形式: `{メインKW}｜{サブ情報}【{ブランド}】`
- 例: `前世カルマの意味と解消法｜魂の視点で解説【Harmony MC】`

#### メタディスクリプション自動生成ルール
- 文字数: 80-120文字
- 形式: `{読者の悩み共感}。{記事の提供価値}。{CTA示唆}`
- 例: `人生で繰り返すパターンに悩んでいませんか？前世カルマの視点から、その意味と解消法をスピリチュアルカウンセラーが解説します。`

#### H構造ルール
```
H1: 記事タイトル（1個のみ、KW含む）
  H2: セクション見出し（3-4個、KWまたは関連語含む）
    H3: サブセクション（必要に応じて1-2個/H2）
```

### 8.2 AIO（AI Overview）最適化

#### AIO採用を狙うコンテンツ構造

1. **簡潔回答ブロック（導入直後）**
```html
<div class="quick-answer" itemscope itemtype="https://schema.org/Answer">
  <p itemprop="text">
    {キーワード}とは、{30-50文字の簡潔な定義}。
    {1文で核心メッセージ}。
  </p>
</div>
```

2. **FAQ構造化（記事末）**
```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "前世カルマとは何ですか？",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "前世カルマとは..."
      }
    }
  ]
}
```

3. **リスト・ステップ構造**
- 「〜の3つの方法」「〜するための5ステップ」形式を積極活用
- `HowTo` スキーマで構造化

### 8.3 E-E-A-T強化

#### Experience（経験）
- 1,499件のカウンセリング実績を記事内で言及
- 「これまで○○名以上の方をカウンセリングしてきた経験から」

#### Expertise（専門性）
- 著者プロフィールを全記事にリンク
- Person スキーマで資格・実績を構造化

#### Authoritativeness（権威性）
```json
{
  "@type": "Person",
  "name": "小林由起子",
  "jobTitle": "スピリチュアルカウンセラー",
  "url": "https://harmony-mc.com/profile",
  "sameAs": ["https://ameblo.jp/..."]
}
```

#### Trustworthiness（信頼性）
- 免責事項を全記事に自動付記
- 「医療アドバイスではありません」の明記
- 出典・参考情報の記載

### 8.4 構造化データ一覧

| スキーマ | 対象ページ | 用途 |
|---------|-----------|------|
| `Article` | 全コラム記事 | 記事情報の構造化 |
| `FAQPage` | FAQ付き記事 | AIO採用率向上 |
| `BreadcrumbList` | 全ページ | ナビゲーション |
| `Person` | 著者情報 | E-E-A-T強化 |
| `HowTo` | 実践系記事 | リッチスニペット |
| `WebSite` | トップページ | サイト情報 |

---

## 9. CTA設計

### 9.1 CTA 3回配置ルール（必須要件）

**誘導先:** https://harmony-booking.web.app/

| CTA | 配置位置 | 役割 | UTMパラメータ |
|-----|---------|------|--------------|
| **CTA①** | 導入セクション後 | 認知・興味喚起 | `utm_content=cta1_intro` |
| **CTA②** | 本論中盤後 | 共感・検討促進 | `utm_content=cta2_mid` |
| **CTA③** | まとめセクション内 | 行動喚起 | `utm_content=cta3_end` |

### 9.2 CTA HTMLコンポーネント

```html
<div class="harmony-cta" data-cta-position="{position}">
  <div class="harmony-cta-inner">
    <p class="harmony-cta-catch">{キャッチコピー}</p>
    <p class="harmony-cta-sub">{サブテキスト}</p>
    <a href="https://harmony-booking.web.app/?utm_source=column&utm_medium=cta&utm_campaign={slug}&utm_content={position}"
       class="harmony-cta-btn" target="_blank" rel="noopener">
      カウンセリングを予約する
    </a>
  </div>
</div>
```

### 9.3 CTA文言テンプレート（テーマ別）

#### 魂と使命系
- CTA①: 「あなたの魂が本当に望んでいることを知りたいと思いませんか？」
- CTA②: 「一人で抱え込まず、魂の声を一緒に聴いてみましょう」
- CTA③: 「あなたの使命を、プロの霊視カウンセリングで紐解きます」

#### 人間関係系
- CTA①: 「大切な人との関係に悩んでいるなら、新しい視点が見つかるかもしれません」
- CTA②: 「その悩み、スピリチュアルな視点から解きほぐすことができます」
- CTA③: 「人間関係のお悩み、カウンセリングで一歩前に進みませんか？」

#### グリーフケア系
- CTA①: 「大切な方からのメッセージを、受け取ってみませんか？」
- CTA②: 「悲しみの中にある愛のメッセージを、一緒に読み解きましょう」
- CTA③: 「あの人は今も、あなたのそばにいます。カウンセリングでつながりませんか？」

#### 自己成長系
- CTA①: 「本当の自分を知ることが、変化の第一歩です」
- CTA②: 「あなたの中に眠る力を、一緒に見つけていきましょう」
- CTA③: 「今の自分を超えたいなら、カウンセリングが道しるべになります」

### 9.4 CTAデザイン仕様

```css
.harmony-cta {
  margin: 2rem 0;
  padding: 1.5rem;
  background: linear-gradient(135deg, #f5ebe0, #faf3ed);
  border: 1px solid #d4a574;
  border-radius: 12px;
  text-align: center;
}
.harmony-cta-catch {
  font-size: 1.1rem;
  font-weight: 600;
  color: #53352b;
  margin-bottom: 0.5rem;
}
.harmony-cta-sub {
  font-size: 0.9rem;
  color: #8b6f5e;
  margin-bottom: 1rem;
}
.harmony-cta-btn {
  display: inline-block;
  padding: 0.8rem 2rem;
  background: #b39578;
  color: #fff;
  border-radius: 25px;
  text-decoration: none;
  font-weight: 600;
  transition: all 0.3s;
}
.harmony-cta-btn:hover {
  background: #53352b;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(83, 53, 43, 0.3);
}
```

---

## 10. 画像生成設計

### 10.1 3枚構成

| 画像 | 役割 | サイズ | スタイル |
|------|------|--------|---------|
| **画像1（ヒーロー）** | 記事テーマの象徴 | 1200x630px（OGP兼用） | 幻想的・光・宇宙的 |
| **画像2（本文挿入）** | 核心メッセージの視覚化 | 800x450px | 柔らかい水彩画風・自然 |
| **画像3（まとめ）** | 読後の余韻・希望 | 800x450px | 温かい光・癒し |

### 10.2 Banana Proプロンプト自動生成

#### プロンプトテンプレート構造

```
{スタイル指定}, {メインモチーフ}, {色彩指定}, {雰囲気}, {品質指定}
```

#### テーマ別プロンプトマッピング

| テーマ | モチーフ例 |
|--------|----------|
| 魂と使命 | 宇宙、星、光の道、魂の球体 |
| 人間関係 | 手をつなぐシルエット、糸、橋 |
| グリーフケア | 蝶、虹、柔らかな光、花が咲く |
| 自己成長 | 種から芽、蓮の花、朝日 |
| 癒しと浄化 | クリスタル、水、滝、森 |
| 日常の気づき | 四季の風景、空、夕焼け |
| 入門 | 扉、道、光のトンネル |

#### プロンプト例

**グリーフケア記事の場合:**
- 画像1: `Ethereal spiritual art, a gentle butterfly made of golden light ascending toward a soft purple sky, warm earth tones #b39578 and #53352b accents, peaceful atmosphere, high quality digital painting, no text`
- 画像2: `Soft watercolor illustration, a single white flower blooming in gentle morning light, translucent petals, pastel colors with warm brown undertones, serene and hopeful mood, no text`
- 画像3: `Warm spiritual illustration, two glowing orbs of light connected by a golden thread across a starry sky, symbolizing eternal connection, soft warm palette, healing atmosphere, no text`

#### ネガティブプロンプト（共通）
```
text, letters, words, watermark, signature, scary, dark, horror, gore, 
religious symbols, specific religious figures, realistic human faces,
low quality, blurry, distorted
```

#### スタイル固定パラメータ
- カラーパレット: 常に `#b39578`（ウォームブラウン）、`#53352b`（ダークブラウン）を含む
- 雰囲気: 温かい、穏やか、希望、スピリチュアル
- 品質: high quality, detailed, professional

---

## 11. データベース設計

### 11.1 Supabaseテーブル設計

#### source_articles（元記事 - 新規）
```sql
CREATE TABLE source_articles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  original_url TEXT,
  original_date TIMESTAMP,
  themes TEXT[] DEFAULT '{}',
  keywords TEXT[] DEFAULT '{}',
  emotional_tone TEXT,
  spiritual_concepts TEXT[] DEFAULT '{}',
  is_processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### articles（生成記事 - apolloONEBlogベース）
```sql
CREATE TABLE articles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  -- 元記事参照（新規）
  source_article_id UUID REFERENCES source_articles(id),
  perspective_type TEXT,           -- 視点変換タイプ
  
  -- apolloONEBlogから流用（フィールド名同一）
  article_number SERIAL,
  status TEXT DEFAULT 'draft',     -- draft→outline→body→review→editing→published
  seo_filename TEXT,
  title TEXT,
  meta_description TEXT,
  stage1_outline JSONB,
  stage1_image_prompts JSONB,
  stage2_body_html TEXT,
  stage3_final_html TEXT,
  published_html TEXT,
  
  -- スピリチュアル固有（新規）
  persona TEXT,                    -- ターゲットペルソナ
  theme_category TEXT,             -- テーマカテゴリ
  keywords TEXT[] DEFAULT '{}',
  target_word_count INTEGER DEFAULT 2000,  -- 設定可能な文字数
  seo_score JSONB,                -- SEOスコア
  aio_score JSONB,                -- AIOスコア
  
  -- 画像
  image_prompts JSONB,            -- Banana Pro用プロンプト3つ
  image_files JSONB DEFAULT '[]',
  
  -- CTA
  cta_texts JSONB,                -- 3つのCTA文言
  
  -- 構造化データ
  structured_data JSONB,          -- JSON-LD
  faq_data JSONB,                 -- FAQ構造化データ
  
  -- メタ
  published_url TEXT,
  published_at TIMESTAMP,
  ai_generation_log TEXT,
  related_articles JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### personas（ペルソナマスタ - 新規）
```sql
CREATE TABLE personas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,              -- ペルソナ名
  age_range TEXT,
  description TEXT,
  search_patterns TEXT[] DEFAULT '{}',
  tone_guide TEXT,
  cta_approach TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### themes（テーママスタ - 新規）
```sql
CREATE TABLE themes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  parent_id UUID REFERENCES themes(id),
  energy_method TEXT,             -- 光/地/水/火/空/風
  description TEXT,
  pillar_article_id UUID REFERENCES articles(id),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### generation_logs（AI生成ログ - apolloONEBlogベース）
```sql
CREATE TABLE generation_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  article_id UUID REFERENCES articles(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  step TEXT,
  model TEXT,
  temperature REAL,
  token_usage JSONB,
  duration_ms INTEGER,
  success BOOLEAN DEFAULT TRUE,
  error_message TEXT,
  raw_output TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### settings（システム設定 - 新規）
```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 初期データ
INSERT INTO settings VALUES
  ('target_word_count', '2000', '記事の目標文字数'),
  ('max_articles_per_day', '10', '1日あたりの最大生成数'),
  ('gemini_model', '"gemini-pro-3.1"', 'Gemini モデル名'),
  ('default_persona', '"美咲"', 'デフォルトペルソナ'),
  ('cta_url', '"https://harmony-booking.web.app/"', 'CTA誘導先URL');
```

---

## 12. API設計

### 12.1 エンドポイント一覧（apolloONEBlogベース + 拡張）

#### 記事管理（流用）
| Method | Endpoint | 説明 | 元API |
|--------|----------|------|-------|
| GET | `/api/articles` | 記事一覧 | 流用 |
| POST | `/api/articles` | 記事作成 | 流用 |
| GET | `/api/articles/[id]` | 記事詳細 | 流用 |
| PUT | `/api/articles/[id]` | 記事更新 | 流用 |
| DELETE | `/api/articles/[id]` | 記事アーカイブ | 流用 |
| POST | `/api/articles/[id]/transition` | ステータス遷移 | 流用 |
| GET | `/api/articles/[id]/revisions` | リビジョン履歴 | 流用 |

#### AI生成（流用 + カスタム）
| Method | Endpoint | 説明 | 変更点 |
|--------|----------|------|--------|
| POST | `/api/ai/generate-outline` | アウトライン生成 | プロンプト変更 |
| POST | `/api/ai/generate-body` | 本文生成 | プロンプト変更 |
| POST | `/api/ai/proofread` | 校正 | チェック項目変更 |
| POST | `/api/ai/quality-check` | 品質チェック | 新規（倫理チェック） |
| POST | `/api/ai/test-connection` | API接続テスト | 流用 |

#### 新規API
| Method | Endpoint | 説明 |
|--------|----------|------|
| POST | `/api/source-articles/import` | CSVインポート |
| GET | `/api/source-articles` | 元記事一覧 |
| POST | `/api/source-articles/analyze` | テーマ自動抽出 |
| POST | `/api/ai/generate-image-prompts` | 画像プロンプト生成 |
| POST | `/api/ai/generate-cta` | CTA文言生成 |
| GET | `/api/seo/score/[id]` | SEO/AIOスコア |
| GET | `/api/settings` | システム設定取得 |
| PUT | `/api/settings` | システム設定更新 |
| GET | `/api/personas` | ペルソナ一覧 |
| GET | `/api/themes` | テーマ一覧 |

---

## 13. 管理画面UI設計

### 13.1 画面フロー

```
[ログイン] → [ダッシュボード]
                │
                ├── [元記事管理] → CSVインポート / 一覧 / テーマ分析
                │
                ├── [コラム生成ウィザード]
                │     Step1: テーマ・ペルソナ・KW選択
                │     Step2: アウトライン確認・編集
                │     Step3: 本文プレビュー・編集
                │     Step4: 画像プロンプト確認
                │     Step5: SEO/AIOチェック
                │     Step6: 公開
                │
                ├── [コラム一覧] → フィルタ / 検索 / ステータス管理
                │
                └── [設定] → 文字数 / API / ペルソナ / テーマ
```

### 13.2 デザインシステム

#### カラーパレット（既存サイト調和）

| 用途 | カラー | コード |
|------|--------|--------|
| プライマリ | ウォームブラウン | `#b39578` |
| ダーク | ディープブラウン | `#53352b` |
| アクセント | ゴールド | `#d4a574` |
| 背景 | クリームベージュ | `#faf3ed` |
| 薄い背景 | ソフトベージュ | `#f5ebe0` |
| テキスト | ダークグレー | `#333333` |
| サクセス | ソフトグリーン | `#7eb88a` |
| ワーニング | アンバー | `#e8a838` |
| エラー | ソフトレッド | `#d35f5f` |

#### タイポグラフィ
- 本文: Noto Sans JP, 16px, line-height: 1.8
- 見出し: Noto Sans JP, Bold
- 管理画面: Noto Sans JP, 14px

---

## 14. 公開ページ設計

### 14.1 コラム記事ページ（HTML生成 - html-generator.ts 流用）

apolloONEBlogの `generateArticleHtml()` をベースに以下を変更:
- カラースキーム: `#b22222` → `#b39578`
- CTAセクション: 予約ボタン → harmony-booking.web.app リンク
- Chart.js関連: 削除
- ストア情報カード: → カウンセラープロフィールカードに変更
- 画像: 3枚配置（ヒーロー/本文/まとめ）
- 構造化データ: Article + FAQPage + Person JSON-LD

### 14.2 コラム一覧ページ（hub-updater.ts 流用）

apolloONEBlogの `insertCardIntoHub()` をベースに:
- カードデザインをスピリチュアル風に変更
- カテゴリフィルター追加
- ページネーション

---

## 15. プロンプト設計書

### 15.1 アウトライン生成プロンプト

```
あなたはスピリチュアル分野のSEOコンテンツストラテジストです。

## 入力情報
- 元記事タイトル: {{source_title}}
- 元記事内容（要約）: {{source_summary}}
- ターゲットペルソナ: {{persona}}
- テーマカテゴリ: {{theme}}
- ターゲットキーワード: {{keyword}}
- 視点変換タイプ: {{perspective_type}}
- 目標文字数: {{target_word_count}}文字

## 出力要件（JSON）
以下のJSON形式で出力してください:
{
  "seo_filename": "英語ケバブケース、20文字以内",
  "title_proposal": "28-35文字、キーワードを含む",
  "meta_description": "80-120文字",
  "quick_answer": "AIO用簡潔回答（50文字以内）",
  "headings": [
    {
      "level": "h2",
      "text": "見出しテキスト",
      "estimated_chars": 500,
      "cta_after": false,
      "image_position": null
    }
  ],
  "faq": [
    {"question": "質問", "answer": "30-50文字の回答"}
  ],
  "image_prompts": [
    {
      "position": "hero|body|summary",
      "prompt": "Banana Pro用英語プロンプト",
      "alt_text": "日本語alt属性"
    }
  ],
  "cta_positions": ["after_intro", "after_section_2", "in_summary"],
  "cta_texts": {
    "cta1": {"catch": "...", "sub": "..."},
    "cta2": {"catch": "...", "sub": "..."},
    "cta3": {"catch": "...", "sub": "..."}
  }
}

## ルール
- 元記事の内容を踏まえつつ、{{perspective_type}}の視点で完全に新しい切り口にする
- H2は3-4個、各H2の下にH3は0-2個
- 目標文字数{{target_word_count}}字を±20%の範囲で構成する
- CTA（https://harmony-booking.web.app/）を3箇所に配置
- 画像プロンプトは3つ（hero/body/summary）
- FAQ（よくある質問）を2-3個含める
- AIO（AI Overview）採用を意識した簡潔回答ブロックを含める
- 医療アドバイスや宗教的断定を含めない
```

### 15.2 本文生成プロンプト（Step A: 執筆）

```
あなたはスピリチュアルカウンセラーの専属ライターです。
温かく、共感的で、読者に寄り添う文章を書きます。

## 入力
- 承認済みアウトライン: {{outline_json}}
- 元記事内容: {{source_content}}
- ペルソナ: {{persona}}
- トーンガイド: です・ます調、柔らかく温かい語り口

## 出力要件
- HTML形式で出力（h2, h3, p, ul, ol, strong, em のみ使用）
- 目標文字数: {{target_word_count}}文字（±20%）
- CTA配置: 以下のHTMLを指定位置に正確に配置
  {{cta_html_1}} {{cta_html_2}} {{cta_html_3}}
- 画像プレースホルダ: 以下を指定位置に正確に配置
  <!--IMAGE:hero:{filename1}-->
  <!--IMAGE:body:{filename2}-->
  <!--IMAGE:summary:{filename3}-->
- 導入直後にAIO用簡潔回答ブロックを配置:
  <div class="quick-answer">{{quick_answer}}</div>

## ライティングルール
- 一文は最大60文字
- 段落は2-3文
- キーワード「{{keyword}}」を冒頭段落＋本文中3-5回自然に使用
- 専門用語には初出時に簡潔な説明を付記
- 断定を避け「〜と言われています」「〜かもしれません」等の表現
- 不安を煽る表現、医療断定、宗教の優劣比較は禁止
- 読者への問いかけを適宜含める
```

### 15.3 校正プロンプト（Step B）

apolloONEBlogの `stage2-proofreading.ts` を流用し、チェック項目を変更:

1. 誤字脱字・漢字ミス
2. 文法・助詞の適切性
3. です・ます調の一貫性
4. スピリチュアル用語の正確性（カルマ/業、チャクラ、前世等）
5. 読みやすさ（一文60文字以内、段落2-3文）
6. HTMLタグの整合性
7. CTA・画像プレースホルダの保持確認

### 15.4 品質チェックプロンプト（Step C）

1. 医療アドバイスとの境界確認
2. 宗教的偏りの確認
3. 不安を煽る表現の検出
4. 差別的表現の検出
5. E-E-A-Tシグナルの確認
6. CTA文言の適切性確認

---

## 16. スピリチュアルコンテンツガイドライン

### 16.1 取り扱いテーマ分類

#### 自由に扱えるテーマ
- 直感力・第六感
- 瞑想・マインドフルネス
- エネルギーワーク（基本）
- シンクロニシティ
- 感謝・ポジティブ思考
- 自然との調和
- 自己成長・自己受容

#### 注意が必要なテーマ
- グリーフケア（→ 医療・心理カウンセリングとの境界を明記）
- 前世・カルマ（→ 証明不可能であることを認めつつ扱う）
- 霊的体験（→ 個人の体験として紹介、一般化しない）
- 不妊・病気（→ 「医療に代わるものではありません」を必ず付記）

#### 避けるべきテーマ
- 特定宗教の優劣比較
- 霊感商法的な煽り
- 医療否定・治療の代替としてのスピリチュアル
- 政治的主張

### 16.2 表現ルール

| ルール | OK例 | NG例 |
|--------|------|------|
| 断定しない | 「〜と言われています」 | 「〜です（断定）」 |
| 選択肢を示す | 「ひとつの視点として」 | 「これが真実です」 |
| 科学と共存 | 「科学では解明されていない領域」 | 「科学は間違い」 |
| 医療尊重 | 「医療と併せて」 | 「病院に行かなくても」 |
| 自己責任 | 「ご自身で感じてみてください」 | 「必ず効果があります」 |

### 16.3 免責事項（全記事末尾に自動付記）

```
※本コラムはスピリチュアルな視点からの情報提供であり、
医療・法律・心理療法の代替となるものではありません。
心身の不調を感じている場合は、専門の医療機関にご相談ください。
```

---

## 17. テクニカルSEO

### 17.1 サイトマップ自動生成
- Next.js `app/sitemap.ts` で自動生成
- 全コラム記事を含む
- 更新時にビルドで再生成

### 17.2 URL設計
- コラム記事: `/column/{english-slug}`
- カテゴリ: `/category/{slug}`
- 英語スラッグ採用（SNSシェア時の可読性）

### 17.3 パフォーマンス目標
- LCP < 2.5s, INP < 200ms, CLS < 0.1
- SSGで全コラムを静的生成
- 画像: WebP/AVIF自動変換、lazy loading
- Vercel Edge Network CDN活用

### 17.4 OGP・Twitter Card
- `generateMetadata` で記事ごとに動的生成
- OGP画像: 画像1（ヒーロー）をそのまま使用（1200x630px）

---

## 18. 運用・分析設計

### 18.1 運用フロー

**週次サイクル:**
1. 月曜: テーマ・ペルソナ選定（自動提案→承認）
2. 火-木: AI生成→レビュー→修正（5-8本/週）
3. 金曜: SEOチェック→画像確認→公開

### 18.2 GA4追跡

| イベント | パラメータ | 目的 |
|---------|-----------|------|
| `page_view` | `page_path`, `article_category` | PV・カテゴリ別分析 |
| `cta_click` | `cta_position`, `article_slug` | CTA効果測定 |
| `scroll_depth` | `percent_scrolled` | 読了率 |
| `external_link` | `link_url` | 予約サイト遷移 |

### 18.3 UTMパラメータ設計

```
https://harmony-booking.web.app/
  ?utm_source=column
  &utm_medium=cta
  &utm_campaign={article-slug}
  &utm_content=cta{1|2|3}_{position}
```

---

## 19. セキュリティ・品質保証

### 19.1 認証（Supabase Auth）
- メール/パスワード認証
- Row Level Security (RLS) でデータアクセス制御
- API Routes でのセッション検証

### 19.2 APIキー管理
- Gemini APIキー: Vercel環境変数
- Supabase: 環境変数（`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`）

### 19.3 テスト戦略
- ユニットテスト（Vitest）: AI生成パイプライン、視点変換、CTA配置
- 統合テスト: Gemini API連携、Supabase操作
- E2Eテスト（Playwright）: 記事生成ウィザード、公開フロー
- コンテンツ品質テスト: 禁止表現チェック、文字数チェック

### 19.4 CI/CD（apolloONEBlog ci.yml 流用）
- GitHub Actions: lint → test → build → E2E
- mainブランチpushでVercel自動デプロイ

---

## 20. 開発フェーズ計画

### Phase 1: MVP（コア機能）

| タスク | 流用元 | 新規/流用 |
|--------|--------|----------|
| プロジェクトセットアップ（Next.js + Supabase） | package.json, tsconfig等 | 流用 |
| Supabase DB設計・マイグレーション | Prisma schema → Supabase | カスタム |
| Supabase Auth設定 | NextAuth → Supabase Auth | カスタム |
| CSVインポート機能 | blog-material-parser.ts | 流用+カスタム |
| Gemini APIクライアント | gemini-client.ts | 流用 |
| アウトライン生成 | generate-outline/route.ts | 流用+プロンプト変更 |
| 本文生成（3ステップ） | prompt-chain.ts | 流用+プロンプト変更 |
| CTA自動配置 | - | 新規 |
| 管理画面（記事一覧・編集） | (tenant)/dashboard/* | 流用+カスタム |
| TipTapエディタ統合 | TipTapEditor.tsx | 流用 |
| HTMLプレビュー | PreviewPane.tsx | 流用+カスタム |

### Phase 2: SEO/画像

| タスク | 流用元 | 新規/流用 |
|--------|--------|----------|
| SEO/AIOスコアリング | - | 新規 |
| 構造化データ自動生成 | - | 新規 |
| Banana Pro画像生成連携 | generate-image/route.ts | 流用+カスタム |
| 画像プロンプト自動生成 | - | 新規 |
| コンテンツカレンダー | - | 新規 |
| GA4連携ダッシュボード | - | 新規 |

### Phase 3: 自動化・最適化

| タスク | 流用元 | 新規/流用 |
|--------|--------|----------|
| 自動公開スケジューリング | - | 新規 |
| パフォーマンス分析 | - | 新規 |
| A/Bテスト（CTA） | - | 新規 |
| 自動改善提案 | - | 新規 |

---

## 付録A: 環境変数一覧

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Gemini AI
GEMINI_API_KEY=AIzaSyDvcXq10iW82L0bjoAPqvLOSpc3-RA-rko
GEMINI_MODEL=gemini-pro-3.1
GEMINI_IMAGE_MODEL=banana-pro

# NextAuth（Supabase Authに移行後は不要）
NEXTAUTH_SECRET=xxx
NEXTAUTH_URL=http://localhost:3000

# Vercel
VERCEL_URL=xxx

# Analytics
NEXT_PUBLIC_GA_ID=G-XXXXXXX

# Logging
LOG_LEVEL=DEBUG
```

## 付録B: ディレクトリ構成（計画）

```
harmony-column-generator/
├── src/
│   ├── app/
│   │   ├── (admin)/              # 管理画面
│   │   │   ├── dashboard/
│   │   │   ├── articles/
│   │   │   ├── source-articles/
│   │   │   └── settings/
│   │   ├── column/               # 公開コラムページ
│   │   │   ├── [slug]/
│   │   │   └── page.tsx
│   │   ├── api/                  # API Routes
│   │   │   ├── articles/
│   │   │   ├── ai/
│   │   │   ├── source-articles/
│   │   │   ├── seo/
│   │   │   └── settings/
│   │   ├── login/
│   │   ├── layout.tsx
│   │   ├── sitemap.ts
│   │   └── robots.ts
│   ├── lib/
│   │   ├── ai/                   # AI生成パイプライン（流用）
│   │   │   ├── gemini-client.ts
│   │   │   ├── prompt-chain.ts
│   │   │   └── prompts/
│   │   ├── supabase/             # Supabase連携（新規）
│   │   │   ├── client.ts
│   │   │   ├── server.ts
│   │   │   └── middleware.ts
│   │   ├── db/                   # データアクセス層（流用+カスタム）
│   │   ├── generators/           # HTML生成（流用）
│   │   ├── html/                 # HTMLパース（流用）
│   │   ├── validators/           # バリデーション（流用+カスタム）
│   │   ├── seo/                  # SEO/AIOスコアリング（新規）
│   │   ├── content/              # コンテンツ分析（新規）
│   │   │   ├── source-analyzer.ts
│   │   │   ├── perspective-transform.ts
│   │   │   └── cta-generator.ts
│   │   └── logger.ts             # ロガー（流用）
│   ├── components/               # UIコンポーネント（流用+カスタム）
│   │   ├── editor/
│   │   ├── layout/
│   │   ├── common/
│   │   └── providers/
│   ├── hooks/                    # カスタムフック（流用+カスタム）
│   └── types/                    # 型定義（流用+カスタム）
├── templates/                    # HTMLテンプレート（流用+カスタム）
├── docs/                         # ドキュメント
├── test/                         # テスト（流用構造）
├── ameblo_articles.csv           # 元記事データ
├── package.json
├── vercel.json
├── next.config.js
├── tailwind.config.js
└── tsconfig.json
```

---

*本仕様書は20名のエキスパートエージェントの知見を統合して作成されました。*
*apolloONEBlog（marbeau17/apolloONEBlog）のコードを最大限流用する設計です。*
