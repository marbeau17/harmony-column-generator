# Optimized Spec — P5: Zero-Generation V1（テーマ/ペルソナベース記事ゼロ生成 + ハルシネーション検証）

**Author:** Planner（クローズドループ・パイプライン 第 6 サイクル、20 名専門家ブレスト統合版）
**Date:** 2026-04-30
**Scope:** 新機能「テーマ/ペルソナベースの記事ゼロ生成 + ハルシネーション検証」の Spec を 20 名専門家の合意ベースで起草。本サイクルは spec 起草と Planner 合意までを完了とし、実装は次サイクル以降。
**前サイクル:** P4 完了（commit 6e1437e）、Publish Control V2 全本番稼働中

---

## 1. 背景と目的

### 1.1 動機
- 既存の記事生成は **source_articles（由起子さん 1499 アメブロ記事）に依存**する翻案型
- 新しいテーマ・ペルソナ組合せでも、ソース記事の在庫に縛られて柔軟性が低い
- ハルシネーション（事実捏造・偽引用・スピ断定・論理矛盾）の検証が**現状ゼロ**

### 1.2 ゴール
1. **テーマ + ペルソナ + キーワード + intent** からソース記事に依存せず記事を生成
2. ハルシネーション 4 分類（factual / attribution / spiritual / logical）を**生成パイプラインに組込**
3. 既存資産（Stage1-3 プロンプト・由起子 FB 14 項目・CTA generator・QualityCheck・画像生成・Publish Control V2）を**最大限再利用**
4. 由起子トーンの一貫性を embedding ベースで担保

### 1.3 非ゴール
- ソース依存型（既存）の置換ではない（並列モードとして共存）
- 生成済 59 記事への遡及適用ではない（新規記事のみ）
- スピ断定の許容拡大ではない（既存禁止規約は維持）

---

## 2. 既存リソースと再利用方針

| カテゴリ | 既存資産 | ゼロ生成での扱い |
|---|---|---|
| Gemini クライアント | `src/lib/ai/gemini-client.ts` (callGemini, generateJson, retry) | **完全再利用** |
| Stage1 outline プロンプト | `src/lib/ai/prompts/stage1-outline.ts` | ゼロ生成版 `stage1-zero-outline.ts` を新設（差分: source_article 不要、由起子語彙辞書 30 語を system に固定埋込） |
| Stage2 writing | `src/lib/ai/prompts/stage2-writing.ts` (短短長リズム + 14 項目 + few-shot 5 例) | **完全再利用**、ただし few-shot を動的選定（embedding 近傍） |
| Stage2 quality check | `stage2-qualitycheck.ts` (医療/宗教/不安煽/EEAT) | **完全再利用** + ハルシネーション層を追加 |
| Stage3 HTML 化 | 既存テンプレ + ToC + CTA 配置 | **完全再利用** |
| 画像生成（Banana Pro） | `image-prompt.ts` + テーマモチーフ Map | **完全再利用** + ペルソナ別ビジュアル拡張 |
| CTA generator | `src/lib/content/cta-generator.ts` | **完全再利用** |
| Publish Control V2 | visibility API + dashboard + Slack 通知 + dangling 自動回復 | **完全再利用** |
| バリデーション | `src/lib/validators/article.ts` (Zod) | **拡張**: zero-generation 用入力スキーマ追加 |
| DB | articles + source_articles + personas + themes + generation_logs + article_revisions | **拡張**: 新列 + 4 新規テーブル |

---

## 3. アーキテクチャ全体

### 3.1 パイプライン（8 LLM 呼出、並列化で実時間 35s）

```
[ユーザ入力: theme + persona + keyword[] + intent + target_length]
    ↓
[Stage1: Zero Outline]                    → 1 呼出（temperature 0.5）
    JSON: { lead_summary, narrative_arc, h2_chapters[], opening_hook, closing_style, citation_highlights }
    ↓
[RAG Retrieval: source_chunks top-5]      → 0 LLM（pgvector cosine）
    ↓
[Stage2: Writing] (前段 RAG = 文体 DNA + 事実根拠)  → 1 呼出（temperature 0.7）
    HTML body
    ↓
[並列実行 Promise.all]
  ├─ [Proofreading]                       → 1 呼出（temperature 0.5）
  ├─ [QualityCheck (既存)]                 → 1 呼出（temperature 0.4）
  ├─ [Claim Extraction]                   → 1 呼出（temperature 0.1）
  └─ [Hallucination 4 タイプ並列]
        ├─ factual (RAG 照合)              → 1 呼出（temperature 0.1）
        ├─ attribution (URL/人名 検証)     → 1 呼出（temperature 0.1）
        ├─ spiritual (NG 辞書 + LLM)       → 1 呼出（temperature 0.1）
        └─ logical (文ペア LLM 判定)       → 1 呼出（temperature 0.1）
    ↓
[Tone Scoring（ローカル計算）]              → 0 LLM
    ↓
[Stage3: HTML 化（既存）]                  → 0 LLM
    ↓
[Image Generation: hero/body/summary]     → 3 Banana Pro 呼出（並列）
    ↓
[公開ゲート判定 (4 段)]
    template_valid + quality_check.passed + reviewed_at + hallucination_critical=0
    ↓
[articles テーブルに保存 + claims/cta_variants 紐付け]
```

### 3.2 主要数値目標（Expert 18 パフォーマンス）
- レイテンシ: P50 75s / P95 90s / バッチ 10 記事 5 分
- コスト: 1 記事 ~$0.09（cache hit 後）/ 月次 $9（100 記事）
- prompt cache TTL 1h、入力トークン課金 25% に削減

---

## 4. データモデル（Expert 16 統合）

### 4.1 articles 列追加

```sql
ALTER TABLE articles
  ADD COLUMN generation_mode TEXT CHECK (generation_mode IN ('zero','source')) DEFAULT 'source',
  ADD COLUMN intent TEXT CHECK (intent IN ('info','empathy','solve','introspect')),
  ADD COLUMN lead_summary TEXT,                            -- AI Overview / OG description 用 100-150 字
  ADD COLUMN citation_highlights JSONB DEFAULT '[]'::jsonb, -- 80-120 字 × 3
  ADD COLUMN narrative_arc JSONB,                           -- {opening_hook, awareness, wavering, acceptance, action, closing_style}
  ADD COLUMN emotion_curve JSONB,                           -- [-2,-1,+1,+2] 4 点
  ADD COLUMN hallucination_score FLOAT,                     -- 0.0-1.0
  ADD COLUMN yukiko_tone_score FLOAT,                       -- 0.0-1.0
  ADD COLUMN readability_score FLOAT;                       -- 0-100
```

### 4.2 新規テーブル

```sql
-- pgvector 拡張
CREATE EXTENSION IF NOT EXISTS vector;

-- ソース記事 chunk + embedding
CREATE TABLE source_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_article_id UUID NOT NULL REFERENCES source_articles(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding vector(768),                          -- text-embedding-004 (Gemini)
  themes TEXT[] DEFAULT '{}',
  emotional_tone TEXT,
  spiritual_concepts TEXT[] DEFAULT '{}',
  content_hash TEXT,                              -- 差分再 embed 判定
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_source_chunks_embedding ON source_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists=100);
CREATE INDEX idx_source_chunks_themes ON source_chunks USING GIN (themes);

-- 記事 claim 単位のハルシネーション結果
CREATE TABLE article_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  sentence_idx INT NOT NULL,
  claim_text TEXT NOT NULL,
  claim_type TEXT CHECK (claim_type IN ('factual','attribution','spiritual','logical','experience','general')),
  risk TEXT CHECK (risk IN ('low','medium','high','critical')),
  source_chunk_id UUID REFERENCES source_chunks(id),
  similarity_score FLOAT,
  evidence JSONB,
  validated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(article_id, sentence_idx, claim_type)
);
CREATE INDEX idx_claims_article_risk ON article_claims(article_id, risk);

-- 由起子文体 centroid（embedding 平均）
CREATE TABLE yukiko_style_centroid (
  id SERIAL PRIMARY KEY,
  version TEXT NOT NULL,
  embedding vector(768) NOT NULL,
  ngram_hash JSONB NOT NULL,
  sample_size INT,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT FALSE
);

-- CTA AB バリアント
CREATE TABLE cta_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  position SMALLINT CHECK (position IN (1,2,3)),
  persona_id UUID REFERENCES personas(id),
  stage TEXT CHECK (stage IN ('empathy','transition','action')),
  copy_text TEXT NOT NULL,
  micro_copy TEXT,
  variant_label TEXT,
  utm_content TEXT,
  impressions INT DEFAULT 0,
  clicks INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_cta_variants_article_pos ON cta_variants(article_id, position);
```

### 4.3 personas 列追加

```sql
ALTER TABLE personas
  ADD COLUMN preferred_words TEXT[] DEFAULT '{}',
  ADD COLUMN avoided_words TEXT[] DEFAULT '{}',
  ADD COLUMN image_style JSONB,                  -- color_palette, mood, lighting
  ADD COLUMN cta_default_stage TEXT;
```

### 4.4 themes 列追加

```sql
ALTER TABLE themes
  ADD COLUMN visual_mood JSONB;                  -- {motif[], color_hsl_range, lighting}
```

### 4.5 マイグレーション
- ファイル: `supabase/migrations/20260501000000_zero_generation_v1.sql`
- 内容: 上記すべて + RLS（service_role 経由のみ INSERT/UPDATE）
- ロールバック手順を末尾コメントに明記

---

## 5. プロンプト設計（Expert 08 + 01 + 02 + 14 統合）

### 5.1 Stage1 Zero Outline プロンプト構造

```
[system]
あなたはスピリチュアルカウンセラー小林由起子の文体DNAを完全に習得した記事構成設計者である。

【由起子 FB 14 項目】（既存 stage2-writing.ts から抽出して固定）
1. ""禁止 / 2. 抽象表現 NG / 3. 比喩オリジナリティ / 4. 語尾優しく ...

【由起子語彙辞書 30 語】（OK: ふと/そっと/ですね/かもしれません ...）

【NG ワード辞書】
スピ断定: 波動/過去世/前世/霊格/アセンション/ソウルメイト断定/宇宙の采配
疑似科学: 周波数が上がる/エネルギーが整う/チャクラが開く
医療侵食: 治る/効く/予防する/改善する（断定形）
クリシェ: 光の使者/愛の涙/魂の叫び/運命の人/人生は旅/心の窓

[user]
テーマ: {theme.name}
ペルソナ: {persona.name} ({persona.age_range}, {persona.tone_guide})
キーワード: {keywords[]}
intent: {intent}  -- info / empathy / solve / introspect
目標文字数: {target_length}

以下を JSON で出力:
- lead_summary: 100-150 字、AI Overview 引用される結論先出し
- narrative_arc: {opening_hook: {type, text}, awareness, wavering, acceptance, action, closing_style}
- emotion_curve: [-2, -1, +1, +2]
- h2_chapters: 3-7 章、各章 {title, summary, target_chars, arc_phase}
- citation_highlights: 80-120 字 × 3（定義文 / 数値 / 専門家見解）
- faq_items: 3-5 件 (Q & A)
- image_prompts: hero/body/summary 3 枚分
```

### 5.2 Few-shot 動的選定（Expert 08）
- ペルソナ × テーマで embedding 化 → source_chunks から top-5 を選定
- 各ペルソナ最低 1 例混ぜる（ストラタ抽出）

### 5.3 Temperature 戦略
| ステージ | Temperature | 用途 |
|---|---|---|
| Stage1 outline | 0.5 + topP=0.9 | 構成は決定的に |
| Stage2 writing | 0.7 + presencePenalty=0.3 | 創造性、語彙偏重防止 |
| Proofreading | 0.5 | 校正 |
| QualityCheck | 0.4 | 評価 |
| Closing/CTA | 0.4 | 締まり |
| Hallucination 検証 | 0.1 | 事実判定は最決定的 |

### 5.4 Prompt Cache（Expert 18）
- system prompt（FB 14 + 辞書 + few-shot 共通枠 ≈ 4k tokens）を Gemini Context Cache へ
- TTL 1h、キャッシュキー `prompt_v{version}_yukiko_fb_v14`

---

## 6. ハルシネーション検証層（Expert 11 統合 + 09 RAG 連携）

### 6.1 4 分類

| タイプ | 例 | 検出方法 |
|---|---|---|
| **factual** | 「2018年厚労省調査では73%が…」（出典不明） | 数値/固有名詞抽出 → pgvector で source_chunks 照合 → 無ければ Web 検索 fallback（任意） |
| **attribution** | 「ユング研究者の田中博士は…」（実在しない） | URL/人名抽出 → HEAD リクエスト + 知識ベース照合 |
| **spiritual** | 「波動が上がる」「過去世が見える」 | NG 辞書 Aho-Corasick 高速マッチ + 文脈窓 ±10 字（否定文脈は除外） |
| **logical** | §2「執着を手放せ」⇄ §5「強く願えば叶う」 | 文ペア LLM 二次判定 |

### 6.2 検出パイプライン

1. **Claim 抽出**: 本文を句点単位で分割 → Gemini で `[{sentence_idx, claim_text, claim_type}]` を JSON 出力
2. **タイプ別並列検証** (Promise.all)
3. **再生成ループ**: high 以上の claim → 該当文のみ AI で書換、最大 3 回（Loop Count 制御）

### 6.3 スコアリング

| Risk | Weight | 判定 |
|---|---|---|
| low | 0 | 問題なし |
| medium | 0.3 | 警告のみ |
| high | 0.7 | 再生成推奨 |
| critical | 1.0 | 公開 block |

```
hallucination_score = Σ(risk_weight) / sentence_count

< 0.15  → 自動公開可
0.15-0.35 → 人間レビュー
≥ 0.35  → 差し戻し
critical ≥ 1 → is_hub_visible=false 強制
```

### 6.4 公開ゲート連動（既存 Publish Control V2 と統合）

3 段ゲート（template_valid + quality_check.passed + reviewed_at）に **第 4 ゲート: hallucination_critical = 0** を追加。`/api/articles/[id]/visibility` で publish 試行時に強制チェック。

---

## 7. 由起子トーン担保（Expert 14 + 12 統合）

### 7.1 14 項目スコアリング（重み付け平均、合格 ≥ 0.80）

| 項目 | 重み | 検出 |
|---|---|---|
| 視点変換度 | 0.15 | 翻案でないか LLM 判定 |
| ダブルポスト回避 | 0.10 | 既存 45 記事 embedding 類似度 < 0.85 |
| 抽象度逆スコア | 0.10 | 具体エピソード密度 |
| 深い納得度 | 0.10 | 体感的言い換え有無 |
| 語尾優しさ | 0.10 | 断定語尾比率 < 20% |
| 比喩オリジナリティ | 0.10 | クリシェ辞書非該当 |
| ひらがな化率 | 0.05 | 漢字率 35-45% |
| 短短長リズム | 0.10 | 連続短文→長文の出現頻度 |
| ""非使用 | 0.05 | カギ括弧""ゼロ（**必須通過**） |
| スピ断定回避 | 0.10 | NG 辞書ヒット数（**必須通過**） |
| CTA 自然挿入 | 0.05 | 浮き感なし |
| その他 3 項目 | 残り | （詳細省略） |

### 7.2 文体 centroid

- 既存 45 記事を text-embedding-004 でベクトル化
- `yukiko_style_centroid.embedding` に格納（is_active=true は最新 1 件）
- 新記事との cosine similarity を計算
  - **≥ 0.85** 合格 / **0.80-0.85** 警告 / **< 0.80** 再生成
- 月次で再計算（ドリフト防止）

### 7.3 クリシェ検出

- AI 頻出陳腐表現辞書 80 語（「人生は旅」「心の窓」「愛のエネルギー」「自分を愛する」「本当の自分」 等）
- 2,000 字中 **3 件以上で警告 / 5 件以上で block**
- 4-gram 重複: 既存 45 記事と 4-gram 一致率 > 5% は機械的コピー疑いで block

---

## 8. SEO/LLMO/構造化データ（Expert 06 + 07 + 10 統合）

### 8.1 SEO（Expert 06）
- **キーワード 3 段階**: 主 KW（title/H1/meta冒頭/URL slug 必須） / LSI 5-8 語（密度 1-2%） / ロングテール（FAQ Q）
- **タイトル 28-35 字**: 数字型/疑問型/共感型を感情ステージで自動選択
- **見出し階層**: H1=主クエリ、H2=サブクエリ 4-6 本、H3=具体例、階層スキップ禁止
- **内部リンク**: 関連 2-3 記事を pgvector top-3 から MMR で多様化、ハブ /column/ への動線も 1 件確保
- **EEAT**: Article schema + Author Person + datePublished/Modified + 監修者プロフィール枠を全記事末尾に挿入

### 8.2 LLMO（Expert 07）
- **citation_highlights[3]**: 80-120 字、定義文/数値/専門家見解の各 1 文ずつ
- **回答型構造**: 冒頭「この記事で答える 3 つの問い」セクション必須
- **lead_summary 100-150 字**: 結論先出し、AI Overview 拾い対策
- **citation-friendly 定義文**: 1 記事 3 文以上（スピ断定除く）

### 8.3 構造化データ（Expert 10）
- **Article schema**: headline / author (Person 由起子) / datePublished / dateModified / image / publisher / about / audience.audienceType / wordCount / inLanguage:ja
- **FAQPage schema**: 3-5 件、本文と JSON-LD 整合性チェック必須
- **Person schema**: 由起子 jobTitle/knownFor/sameAs/yearsOfExperience/hasCredential、`additionalType: "SpiritualCounselor"` + custom `spiritualConcepts`
- **BreadcrumbList**: home → /column/ → category → article
- **HowTo schema**: 手順記事のみ自動付与（誤適用禁止）
- **CI 検証**: Schema.org validator + Google Rich Results Test を CI で自動

---

## 9. CTA 戦略（Expert 04 + 15 統合）

### 9.1 配置 3 ポイント
| 位置 | 感情ステージ | 文言型 | 例 |
|---|---|---|---|
| 1 (序盤 30%、共感ピーク後) | empathy | ソフト誘導 | 「ひとりで抱え込まなくて大丈夫。まずは話してみませんか」 |
| 2 (中盤 55%、転換点直後) | transition | 中強度 | 「あなたの心が軽くなる時間を、30分だけ用意しました」 |
| 3 (結末 85-100%) | action | 決意の後押し | 「次の一歩は、由起子と一緒に踏み出せます」 |

### 9.2 マイクロコピー
- 「初回 30 分無料 / オンライン対応」
- 「予約後すぐキャンセル可・キャンセル料なし」
- 「LINEで気軽にご相談から」
- 「秘密厳守」

### 9.3 utm_content 計測
形式: `utm_source=column&utm_medium=cta&utm_campaign={article_slug}&utm_content={position}-{persona}-{variant}`
30 日ごと CVR 集計、下位 30% を自動ローテーション。

---

## 10. 画像生成（Expert 19）

### 10.1 ペルソナ別ビジュアル
| ペルソナ | パレット |
|---|---|
| 30 代主婦 | soft pastel, warm beige, natural light, dreamy bokeh |
| 40 代キャリア | clean minimal, muted earth tones, modern interior |
| 50 代以上 | serene, deep amber, golden hour, mature elegance |

### 10.2 画像ハルシネーション検査
- 生成直後に Gemini Vision で `{has_text, has_logo, anatomy_ok, score}` を取得
- score < 70 で自動再生成（最大 2 回）

### 10.3 テーマ整合性
- `themes.visual_mood` (例: グリーフケア → `melancholic, gentle, dawn light`) を定義
- Vision で 0-1 整合性スコア、< 0.6 は再生成

### 10.4 品質チェック
- hero ≥ 1600x900、body/summary ≥ 1080x1080、aspect ratio ±2%
- WebP quality=82、サイズ上限 hero 250KB / 他 180KB

---

## 11. UI/UX（Expert 20 + 04 + 03 統合）

### 11.1 新画面 `/dashboard/articles/new-from-scratch`
- 2 カラム（左 60% フォーム / 右 40% ライブプレビュー）
- 入力順: テーマ → ペルソナ → キーワード（最大 8 個） → intent (Radio Card) → 文字数
- intent 4 タイプ: info / empathy / solve / introspect

### 11.2 プログレス UI
- 横 Stepper: stage1 → stage2 → hallucination → 完成
- 経過秒/推定残り秒、現在 stage 脈動アニメ
- バックグラウンド実行 + 完了時トースト+ベル通知

### 11.3 ハルシネーション結果ペイン
- スコアバッジ（critical 赤 / high 橙 / medium 黄 / low 灰）
- 該当文を背景色ハイライト、サイドの Claim List クリックでスクロール
- 各 claim カード: 「根拠 URL」「修正案」「却下/採用」

### 11.4 再生成 UI（粒度切替）
- 文単位 / 章単位 / 全体
- Diff ビュー（左旧 / 右新）で確認後採用、`article_revisions` 自動保存

### 11.5 公開判断ダッシュボード `/dashboard/publish-events` 拡張
- 一覧列: タイトル / hallucination_score / yukiko_tone_score / quality_check.passed / reviewed_at / 公開状態
- 閾値色分け（緑 ≥ 80 / 黄 ≥ 60 / 赤 < 60）
- フィルタ: 「公開可」「要レビュー」「critical 残」
- 一括公開は critical=0 のみ許可

---

## 12. API 設計

### 12.1 `POST /api/articles/zero-generate`
**Request:**
```json
{
  "theme_id": "uuid",
  "persona_id": "uuid",
  "keywords": ["string"],
  "intent": "info|empathy|solve|introspect",
  "target_length": 2000
}
```

**Response (sync mode):**
```json
{
  "article_id": "uuid",
  "status": "completed",
  "hallucination_score": 0.08,
  "yukiko_tone_score": 0.87,
  "readability_score": 78,
  "quality_check": { "passed": true, ... },
  "duration_ms": 78000
}
```

**Response (async mode, 推奨):**
```json
{ "job_id": "uuid", "status": "queued" }
```
→ SSE で進捗ストリーム `GET /api/articles/zero-generate/{job_id}/progress`

### 12.2 `POST /api/articles/[id]/hallucination-check`
記事 ID 指定で再検証。既存 article_claims を上書き。

### 12.3 `POST /api/articles/[id]/regenerate-segment`
**Request:** `{ scope: "sentence|chapter|full", target_idx?: number }`

---

## 13. テスト戦略（Expert 17）

### 13.1 単体テスト
- `hallucination-classifier.test.ts`: claim × source 4 分類 fixture 12 件、境界値
- `readability-score.test.ts`: 文長/漢字率/受動態率の重み付け
- `tone-scoring.test.ts`: ペルソナ毎の語尾/比喩/一人称分布、5 ペルソナ × 3 サンプル
- `claim-extractor.test.ts`: 抽出 recall ≥ 0.9（golden set 30 文）
- `embedding-mock.test.ts`: vi.mock で固定ベクトル、retrieval 順序保証
- 既存 87 件は無改修

### 13.2 E2E（ZG-1〜ZG-5）
- **ZG-1**: テーマ + ペルソナ選択 → 生成 → preview に hero/body/summary + CTA×3 描画
- **ZG-2**: critical hallucination 注入 → PublishButton disabled、tooltip 表示
- **ZG-3**: 再生成ループ最大 3 回、`article_revisions` に履歴 INSERT、4 件超で最古削除
- **ZG-4**: ペルソナ A/B 切替で tone-scoring 差分 > 0.25
- **ZG-5**: 50 記事連続生成耐久、メモリリーク無、p95 < 90s

### 13.3 mock 戦略
- Gemini API: `vi.mock('@/lib/ai/gemini')` で fixture JSON 返却
- Retrieval: `test/e2e/fixtures/retrieval-*.json` 固定 top-5
- FTP: `FTP_DRY_RUN=1`
- Banana Pro: 1x1 PNG base64 stub

### 13.4 shadow seed
- `test/e2e/fixtures/zero-generation.sql`: source_articles 100、personas 5、themes 8
- prefix `zg_` で既存 monkey-fixtures と分離

### 13.5 CI
- `.github/workflows/e2e.yml` に job `e2e-zero-generation` 追加（`--grep @zg`）
- ZG-5 耐久は main/develop push 時のみ（PR では skip）

---

## 14. 安全性ガード

- 既存規約継承（Publish Control V2 / FTP no-delete / article_revisions 履歴 / 記事本文 write 禁止 等）
- ハルシネーション critical で is_hub_visible=false 強制
- 再生成ループ最大 3 回（Loop Count 監視）
- すべての新エンドポイントは authenticated user 必須（`/api/articles/zero-generate` 含む）
- Slack 通知（既存）に hallucination_critical 検出時を追加
- 本番マイグレ適用は spec 完了後の別判断（shadow 検証必須）

---

## 15. 受け入れ基準（AC-P5-N）

### 機能
- **AC-P5-1**: `POST /api/articles/zero-generate` がテーマ + ペルソナ + キーワード + intent から記事を生成
- **AC-P5-2**: 生成記事は articles テーブルに `generation_mode='zero'` で保存
- **AC-P5-3**: hallucination_score / yukiko_tone_score / readability_score が articles に記録
- **AC-P5-4**: article_claims に 4 タイプ × 文単位の claim が記録
- **AC-P5-5**: critical claim ≥ 1 のとき PublishButton が disabled

### プロンプト/品質
- **AC-P5-6**: 既存 stage2-writing.ts プロンプトをゼロ生成でも再利用、few-shot は動的選定
- **AC-P5-7**: 由起子トーンスコア ≥ 0.80 で公開可
- **AC-P5-8**: ""禁止 / スピ断定回避は必須通過（個別 block）
- **AC-P5-9**: クリシェ 5 件以上で block

### SEO/LLMO
- **AC-P5-10**: lead_summary 100-150 字、citation_highlights 3 件
- **AC-P5-11**: タイトル 28-35 字、meta_description 120 字
- **AC-P5-12**: Article + FAQPage + Person + BreadcrumbList JSON-LD 出力

### UI
- **AC-P5-13**: `/dashboard/articles/new-from-scratch` ページが存在、テーマ/ペルソナ/キーワード/intent 入力可
- **AC-P5-14**: プログレス Stepper が stage1→stage2→hallucination→完成 を表示
- **AC-P5-15**: ハルシネーション結果ペインで claim を文ハイライト

### 検証
- **AC-P5-16**: 単体テスト追加分（〜10 件）含む全件 PASS
- **AC-P5-17**: 型チェック exit=0、ビルド PASS
- **AC-P5-18**: E2E ZG-1〜ZG-4 PASS（ZG-5 は CI のみ）
- **AC-P5-19**: 既存 E2E（monkey + hub-rebuild + dangling）回帰なし

### パフォーマンス
- **AC-P5-20**: 1 記事生成 P95 < 90s
- **AC-P5-21**: バッチ 10 記事 < 5 分
- **AC-P5-22**: 月次コスト < $15（100 記事）

---

## 16. 実装ロードマップ（次サイクル以降）

| サイクル | スコープ | 推定 |
|---|---|---|
| **P5-1** | DB マイグレ + RAG 基盤（pgvector + source_chunks 1499 記事 embed） | 1-2 セッション |
| **P5-2** | Stage1 zero outline プロンプト + API `/api/articles/zero-generate` | 1 セッション |
| **P5-3** | ハルシネーション検証層（4 タイプ並列 + claim 抽出 + scoring） | 2 セッション |
| **P5-4** | 由起子トーン scoring + centroid 計算 | 1 セッション |
| **P5-5** | UI（新画面 + プログレス + ハルシネーション結果ペイン） | 1-2 セッション |
| **P5-6** | テスト（単体 + E2E ZG-1〜5） | 1 セッション |
| **P5-7** | パフォーマンス最適化（cache + 並列化） | 0.5 セッション |
| **P5-8** | 本番デプロイ + スモーク | 0.5 セッション |

合計推定: **8-10 セッション**

---

## 17. クローズドループ判定（本サイクル）

| 条件 | アクション |
|---|---|
| 20 名のブレストが揃い、Planner が統合 spec を起草 | **本サイクル完了**（spec 起草フェーズ）|
| ユーザが spec を承認 | 次サイクル P5-1（DB マイグレ）へ |
| spec への修正要望 | Change Request → spec 再起草 |

---

## 18. 完了定義（本サイクル）

- 20 名専門家のブレスト完了 ✅
- 統合 spec が `docs/optimized_spec.md` に書き出される ✅
- ユーザに spec を提示し、実装着手判断を仰ぐ ⏳

---

## 19. 専門家寄稿サマリ（参考）

| # | 役割 | 主要寄稿 |
|---|---|---|
| 01 | スピリチュアルカウンセラー | 4 拍構造、許可/禁止表現、ゼロ生成必須 5 FB 項目、テーマ別問いかけテンプレ |
| 02 | シニア小説家 | 冒頭フック 3 種、起承転結マップ、emotion_curve、結びの余韻設計 |
| 03 | 編集ディレクター | 章立て 3 パターン、見出し階層、CTA 配置、ペルソナ別ペーシング |
| 04 | ブログエキスパート | 可読性数値、視覚要素、CTA コンバージョン、モバイル最適化、滞在時間 |
| 05 | ペルソナ設計者 | persona × theme matrix、intent 4 タイプ、語彙辞書、A/B テスト |
| 06 | SEO | KW 3 段階、タイトル/メタ最適化、見出し階層、内部リンク、EEAT |
| 07 | LLMO | citation_highlights、回答型、lead_summary、citation-friendly text |
| 08 | プロンプトエンジニア | ゼロ生成プロンプト構造、temperature、few-shot 動的選定、CoT、cache |
| 09 | RAG | embedding、retrieval、grounding、ハルシネーション軽減、コスト試算 |
| 10 | 構造化データ | Article/FAQ/Person/Breadcrumb/HowTo |
| 11 | ハルシネーション監査官 | 4 分類、検出パイプライン、scoring、article_claims schema |
| 12 | QA / 可読性 | 可読性スコア、構造、CTA、由起子トーン 14 項目、threshold |
| 13 | コンプライアンス | 薬機法、景表法、個情、著作権、免責 |
| 14 | ブランドガーディアン | NG/OK 辞書、文体 centroid、クリシェ検出 |
| 15 | コピーライター | CTA バリエーション、感情ロジック、マイクロコピー、utm_content |
| 16 | DB アーキテクト | 4 新規テーブル、articles 列追加、マイグレファイル |
| 17 | テストエンジニア | 単体 5 件、E2E ZG-1〜5、mock、shadow seed、CI |
| 18 | パフォーマンス | 8 呼出、並列化、cache、レイテンシ、コスト |
| 19 | 画像ディレクター | ゼロ生成プロンプト、ペルソナビジュアル、Vision 検査、品質 |
| 20 | UX/IA | 生成画面、プログレス、ハルシネーション結果、再生成、ダッシュボード |

---

**End of Spec**
