# AIコンテンツプランナー 機能仕様書

**作成日**: 2026-04-03
**バージョン**: 1.0
**ステータス**: Draft
**レビュアー**: 20人エキスパートチーム合議

---

## 目次

1. [機能概要とユーザーフロー](#1-機能概要とユーザーフロー)
2. [AIプラン生成プロンプト設計](#2-aiプラン生成プロンプト設計)
3. [キーワードリサーチロジック](#3-キーワードリサーチロジック)
4. [元記事選択アルゴリズム](#4-元記事選択アルゴリズム)
5. [SEOスコア最適化戦略](#5-seoスコア最適化戦略)
6. [自動生成キュー設計](#6-自動生成キュー設計)
7. [API設計](#7-api設計)
8. [データベース設計](#8-データベース設計)
9. [管理画面UI設計](#9-管理画面ui設計)
10. [実装ファイルリスト](#10-実装ファイルリスト)

---

## 1. 機能概要とユーザーフロー

### 1.1 機能の目的

AIがSEOスコア100点に近づく最適なコラム記事プランを自動提案し、承認後に一括自動生成する。これにより、キーワード選定からコンテンツ生成までの手動作業を大幅に削減し、SEO品質を均一に担保する。

### 1.2 ユーザーフロー全体像

```
[ステップ1] プラン生成リクエスト
  ユーザーが「AIプラン生成」ボタンを押下
  -> 生成件数（5/10件）を選択
  -> オプション: テーマ絞り込み、除外キーワード指定
    |
    v
[ステップ2] AIキーワードリサーチ
  Gemini API がスピリチュアル系の有望キーワードを提案
  -> 検索ボリューム推定、競合度評価
  -> 既存記事との重複チェック
    |
    v
[ステップ3] AIプラン生成
  各キーワードに対して最適な組み合わせを決定:
  - テーマカテゴリ（7種）
  - ペルソナ（7種）
  - 視点変換タイプ（6種）
  - 元記事（1-3件、未使用優先）
  - SEOスコア予測値
  - 提案理由
    |
    v
[ステップ4] プランレビュー画面
  カード形式でプラン一覧を表示
  各プランに対して:
  - 承認 (Approve)
  - 却下 (Reject)
  - 修正 (Edit) -> テーマ/ペルソナ/キーワード等を個別変更可能
    |
    v
[ステップ5] 生成キュー投入
  承認済みプランが生成キューに追加
  優先度順に自動処理開始:
  [5a] Stage1: アウトライン生成 (Gemini)
  [5b] Stage2: 本文生成チェーン (Writing -> Proofreading -> QualityCheck)
  [5c] Stage3: 画像プロンプト生成 -> 画像生成 (Banana Pro)
  [5d] SEO/AIOスコア算出
    |
    v
[ステップ6] 進捗モニタリング
  リアルタイム進捗表示（ポーリング/SSE）
  完了通知、エラー時の再試行ボタン
    |
    v
[ステップ7] レビュー & 公開
  生成完了記事の最終レビュー -> 既存の記事編集フローへ
```

### 1.3 既存フローとの統合ポイント

- プランから生成された記事は既存の `articles` テーブルに格納される
- 記事ステータスは既存の `draft -> outline_pending -> outline_approved -> body_generating -> body_review -> editing -> published` フローに準拠
- 既存の `Stage1Input` / `Stage2Input` 型をそのまま活用
- SEO/AIOスコア算出は既存の `score-calculator.ts` を使用
- CTA配置は既存の `cta-generator.ts` を使用

---

## 2. AIプラン生成プロンプト設計

### 2.1 キーワードリサーチプロンプト（全文）

```typescript
// src/lib/ai/prompts/planner-keyword-research.ts

export function buildKeywordResearchSystemPrompt(): string {
  return `あなたはスピリチュアル・ヒーリング分野に特化したSEOキーワードリサーチの専門家です。

## あなたの役割
日本語の検索市場において、スピリチュアルカウンセリングサイトへの自然検索流入を
最大化するための有望なキーワードを発見・提案すること。

## 対象サイト
- スピリチュアルカウンセラー小林由起子の公式コラムサイト
- CTA先: https://harmony-booking.web.app/ （カウンセリング予約）
- 既存テーマ: 魂の使命、人間関係、グリーフケア、自己成長、ヒーリング、日常の気づき、スピリチュアル入門

## キーワード選定基準
1. 月間検索ボリューム推定100以上（ロングテール含む）
2. 検索意図が「情報収集」または「悩み解決」であること
3. カウンセリング予約へのコンバージョンが見込めること
4. 医療・宗教の断定を避けられるテーマであること
5. 既存記事と重複しないこと

## 出力ルール
- レスポンスは JSON のみ（前後の説明文不要）
- 各キーワードに検索ボリューム推定値、難易度、検索意図を付与`;
}

export function buildKeywordResearchUserPrompt(
  count: number,
  existingKeywords: string[],
  themeFilter?: string,
  excludeKeywords?: string[],
): string {
  return `以下の条件でSEOキーワードを${count}件提案してください。

## 条件
${themeFilter ? `- テーマ絞り込み: ${themeFilter}` : '- テーマ: 全テーマ対象'}
${excludeKeywords?.length ? `- 除外キーワード: ${excludeKeywords.join(', ')}` : ''}

## 既存記事で使用済みのキーワード（重複回避）
${existingKeywords.length > 0 ? existingKeywords.map(k => `- ${k}`).join('\n') : '- なし'}

## 出力 JSON スキーマ
\`\`\`json
{
  "keywords": [
    {
      "keyword": "メインキーワード（2-5語の複合キーワード推奨）",
      "search_volume_estimate": "月間推定検索ボリューム（数値）",
      "difficulty": "low | medium | high",
      "search_intent": "informational | navigational | transactional",
      "related_queries": ["関連検索ワード1", "関連検索ワード2"],
      "suggested_theme": "soul_mission | relationships | grief_care | self_growth | healing | daily_awareness | spiritual_intro",
      "conversion_potential": "low | medium | high",
      "reasoning": "このキーワードを推奨する理由（50文字以内）"
    }
  ]
}
\`\`\`

## キーワード提案の方向性
- 「○○ スピリチュアル 意味」系のhow-to/what-is型
- 「○○ 浄化 方法」系の実践型
- 「○○ できない 辛い」系の悩み解決型
- 「○○ 前兆 サイン」系の関心喚起型
- 季節・イベント関連（満月、春分、年末年始の振り返り等）

上記のバランスを考慮し、多様なキーワードを提案してください。`;
}
```

### 2.2 プラン生成プロンプト（全文）

```typescript
// src/lib/ai/prompts/planner-plan-generation.ts

export function buildPlanGenerationSystemPrompt(): string {
  return `あなたはスピリチュアルコンテンツの戦略プランナーです。
SEOスコア100点を達成するための最適なコラム記事プランを設計します。

## あなたの役割
与えられたキーワードに対して、以下の全要素を最適に組み合わせた記事プランを提案すること:
- テーマカテゴリ（7種）
- ターゲットペルソナ（7種）
- 視点変換タイプ（6種）
- 参照元記事（1-3件）

## テーマカテゴリ一覧
| ID | 名称 | 説明 |
|---|---|---|
| soul_mission | 魂の使命 | 魂の目的、ライトワーカー、使命の発見 |
| relationships | 人間関係 | ツインレイ、ソウルメイト、恋愛、親子 |
| grief_care | グリーフケア | 死別、喪失感、ペットロス、供養 |
| self_growth | 自己成長 | 自己実現、変容、マインドセット |
| healing | ヒーリング | 癒し、チャクラ、エネルギーワーク、瞑想 |
| daily_awareness | 日常の気づき | 暮らしの知恵、習慣、ストレス管理 |
| spiritual_intro | スピリチュアル入門 | 初心者向け解説、基礎知識、Q&A |

## ペルソナ一覧
| ID | 名称 | 特徴 |
|---|---|---|
| spiritual_beginner | スピリチュアル初心者 | 興味はあるが知識が少ない。やさしい説明を求める |
| self_growth_seeker | 自己成長追求者 | 積極的に学びたい。実践的な内容を好む |
| grief_sufferer | 喪失体験者 | 大切な人を失い、心の支えを求めている |
| meditation_practitioner | 瞑想実践者 | 既に瞑想を行い、より深い理解を求める |
| energy_worker | エネルギーワーカー | ヒーリングに関心があり、専門的な知識も持つ |
| life_purpose_seeker | 人生の目的探求者 | 自分の使命や天職を見つけたい |
| holistic_health_seeker | ホリスティック健康志向 | 心身の総合的な健康に関心がある |

## 視点変換タイプ一覧
| ID | 変換 | 最適なケース |
|---|---|---|
| experience_to_lesson | 体験談 → 教訓 | 元記事が個人的体験談の場合 |
| personal_to_universal | 個人 → 普遍 | 特定の相談事例がある場合 |
| concept_to_practice | 概念 → 実践 | 理論的な説明が中心の場合 |
| case_to_work | 事例 → ワーク | カウンセリング事例がある場合 |
| past_to_modern | 過去 → 現代 | 伝統的な知恵を扱う場合 |
| deep_to_intro | 深掘り → 入門 | 専門的な内容を初心者向けにする場合 |

## SEOスコア100点のための必須条件
1. タイトル（15点）: 28-35文字、キーワード前方配置
2. メタディスクリプション（15点）: 80-120文字、キーワード含有、行動喚起
3. 見出し構造（15点）: H2を3-7個、H3で階層化、見出しにキーワード
4. キーワード最適化（15点）: 密度0.5-2.5%、冒頭200文字と末尾に配置
5. コンテンツ品質（15点）: 3000文字以上、リスト・テーブル・画像・強調
6. リンク構造（10点）: 内部リンク3件以上、関連記事リンク
7. 構造化データ（10点）: Article + FAQ + BreadcrumbList JSON-LD
8. 技術的SEO（5点）: スラッグ60文字以内、公開URL設定

## 出力ルール
- レスポンスは JSON のみ
- 各プランに SEOスコア予測値（breakdown含む）を付与
- 各プランに提案理由を100文字以内で記載
- 元記事は ID で参照（呼び出し側で候補リストを渡す）`;
}

export function buildPlanGenerationUserPrompt(
  keywords: KeywordResearchResult[],
  sourceArticleCandidates: SourceArticleSummary[],
  existingArticleKeywords: string[],
): string {
  return `以下のキーワードそれぞれに対して、最適な記事プランを生成してください。

## 提案対象キーワード
${keywords.map((k, i) => `${i + 1}. "${k.keyword}" (推定検索Vol: ${k.search_volume_estimate}, 推奨テーマ: ${k.suggested_theme})`).join('\n')}

## 利用可能な元記事候補（未使用のもの）
${sourceArticleCandidates.map(a => `- ID: ${a.id} | テーマ: ${a.themes.join(',')} | タイトル: ${a.title} | 概念: ${a.spiritual_concepts.join(',')}`).join('\n')}

## 既存記事のキーワード（重複回避）
${existingArticleKeywords.map(k => `- ${k}`).join('\n')}

## 出力 JSON スキーマ
\`\`\`json
{
  "plans": [
    {
      "keyword": "提案対象のメインキーワード",
      "theme": "テーマカテゴリID",
      "persona": "ペルソナID",
      "perspective_type": "視点変換タイプID",
      "source_article_ids": ["元記事ID1", "元記事ID2"],
      "title_draft": "タイトル案（28-35文字、キーワード前方配置）",
      "meta_description_draft": "メタディスクリプション案（80-120文字）",
      "target_word_count": 3000,
      "seo_score_prediction": {
        "total": 92,
        "breakdown": {
          "title": 15,
          "meta": 14,
          "headings": 14,
          "keywords": 13,
          "content": 13,
          "links": 8,
          "structured_data": 10,
          "technical": 5
        }
      },
      "reasoning": "このプランの提案理由（100文字以内）",
      "priority": "high | medium | low",
      "estimated_generation_time_sec": 180
    }
  ]
}
\`\`\`

## プラン設計の方針
1. テーマとキーワードの整合性を最優先
2. ペルソナはキーワードの検索意図から推定
3. 視点変換タイプは元記事の内容特性から最適なものを選択
4. 元記事は1-3件、テーマとキーワードに最も関連性の高いものを選択
5. 目標文字数は3,000文字（SEOコンテンツ品質スコア最大化のため）
6. 各プランのSEOスコア予測は、全項目の採点根拠を考慮して現実的に算出

上記に基づき、各キーワードに対する最適プランをJSON形式で出力してください。`;
}
```

### 2.3 プロンプト設計のポイント（AIエンジニア見解）

| 項目 | 設計判断 | 理由 |
|---|---|---|
| temperature | キーワードリサーチ: 0.8 / プラン生成: 0.5 | リサーチは創造性、プランは整合性を重視 |
| maxOutputTokens | 8192 | 10件プランのJSON出力に十分な容量 |
| responseAsJson | true | 構造化出力を強制しパースエラーを低減 |
| リトライ | 1回 | JSONパースエラー時に1回再試行 |
| モデル | gemini-pro-latest | テキスト生成の品質と速度のバランス |

---

## 3. キーワードリサーチロジック

### 3.1 リサーチフロー

```
[入力]
  - 生成件数: 5 or 10
  - テーマフィルタ（任意）
  - 除外キーワード（任意）
      |
      v
[ステップ1] 既存キーワード収集
  articles テーブルから全 keyword を取得
  -> 重複防止リスト作成
      |
      v
[ステップ2] Gemini API キーワード提案
  buildKeywordResearchUserPrompt で API 呼び出し
  -> JSON パース & バリデーション
      |
      v
[ステップ3] 重複排除フィルタ
  - 既存記事キーワードとの完全一致チェック
  - 部分一致チェック（80%以上の類似度）
  - 同一バッチ内の重複除去
      |
      v
[ステップ4] スコアリング & ソート
  以下の基準で優先度スコアを算出:
  - 検索ボリューム推定値 x 0.35
  - コンバージョンポテンシャル x 0.30
  - 競合難易度（低いほど高得点） x 0.20
  - テーマカバレッジ（未カバーテーマを優先） x 0.15
      |
      v
[出力]
  スコア順にソートされたキーワードリスト
```

### 3.2 検索ボリューム推定の注意事項

Gemini APIは正確な検索ボリュームデータを持たないため、以下の戦略を採用:

1. **推定値として扱う**: UIに「推定」ラベルを明示
2. **相対的な優先度に活用**: 絶対値ではなく、キーワード間の相対比較に使用
3. **将来的な拡張ポイント**: Google Ads Keyword Planner API や Search Console API との統合を想定し、`keyword_metrics` テーブルに実データを保存できる設計とする

### 3.3 テーマカバレッジバランシング

```typescript
function calculateThemeCoverageScore(
  suggestedTheme: string,
  existingArticles: { theme: string }[],
): number {
  const themeCounts: Record<string, number> = {};
  for (const a of existingArticles) {
    themeCounts[a.theme] = (themeCounts[a.theme] ?? 0) + 1;
  }
  const totalArticles = existingArticles.length || 1;
  const themeRatio = (themeCounts[suggestedTheme] ?? 0) / totalArticles;

  // カバー率が低いテーマほど高スコア（最大1.0）
  return Math.max(0, 1.0 - themeRatio * 5);
}
```

---

## 4. 元記事選択アルゴリズム

### 4.1 選択戦略の全体像

1,441件の元記事（`source_articles`）から、各プランに最適な1-3件を自動選択する。

### 4.2 選択アルゴリズム

```
入力: keyword, theme, perspective_type
      |
      v
[フィルタ1] 未使用優先
  is_processed = false の記事を優先
  全て使用済みの場合は使用回数が少ない記事を選択
      |
      v
[フィルタ2] テーママッチング
  source_articles.themes 配列に theme が含まれる記事を抽出
  該当なしの場合: キーワード部分一致（title, content）にフォールバック
      |
      v
[フィルタ3] キーワード関連性スコアリング
  各候補に以下のスコアを付与:
  - タイトルにキーワード含有: +10
  - 本文にキーワード含有: +5 x 出現回数（最大+25）
  - spiritual_concepts にキーワード関連概念: +8
  - emotional_tone がペルソナと適合: +5
      |
      v
[フィルタ4] 視点変換適合性
  perspective_type との相性スコア:
  - experience_to_lesson: emotional_tone が reflective/nurturing なら +10
  - concept_to_practice: spiritual_concepts が3つ以上なら +10
  - deep_to_intro: word_count が 1000 以上なら +10
  - case_to_work: content に「相談」「クライアント」含有なら +10
  - personal_to_universal: emotional_tone が compassionate なら +10
  - past_to_modern: content に「昔」「伝統」「古来」含有なら +10
      |
      v
[フィルタ5] 多様性確保
  同一テーマの元記事が偏らないように:
  - 1つのプランに同テーマの元記事は最大2件
  - 同一バッチ内で同じ元記事は最大2回まで使用
      |
      v
[出力] スコア上位 1-3 件を選択
  - スコア1位: メイン参照記事（必須）
  - スコア2位以降: 補助参照記事（スコア閾値以上の場合のみ）
```

### 4.3 使用済み記事の再利用ポリシー

```typescript
interface SourceArticleUsagePolicy {
  // 未使用記事が存在する限り未使用を優先
  preferUnused: true;
  // 全記事使用後は使用回数が少ない順に再利用
  reuseByLeastUsed: true;
  // 同一元記事を異なる視点変換タイプで再利用する場合のみ許可
  requireDifferentPerspective: true;
  // 最大再利用回数（同一元記事）
  maxReuseCount: 3;
}
```

### 4.4 実装: 元記事候補取得クエリ

```sql
-- 未使用 + テーママッチする元記事を最大50件取得
SELECT
  sa.id,
  sa.title,
  sa.themes,
  sa.keywords,
  sa.spiritual_concepts,
  sa.emotional_tone,
  sa.word_count,
  COUNT(a.id) AS usage_count,
  ARRAY_AGG(DISTINCT a.perspective_type) FILTER (WHERE a.id IS NOT NULL) AS used_perspectives
FROM source_articles sa
LEFT JOIN articles a ON a.source_article_id = sa.id
WHERE sa.themes @> ARRAY[:theme]::text[]
   OR sa.title ILIKE '%' || :keyword || '%'
   OR sa.content ILIKE '%' || :keyword || '%'
GROUP BY sa.id
ORDER BY
  CASE WHEN COUNT(a.id) = 0 THEN 0 ELSE 1 END,  -- 未使用優先
  COUNT(a.id) ASC,                                 -- 使用回数少ない順
  sa.word_count DESC                               -- 長い記事優先
LIMIT 50;
```

---

## 5. SEOスコア最適化戦略

### 5.1 100点達成のためのチェックリスト

既存の `score-calculator.ts` の採点基準に基づき、各項目で満点を取るための具体的ルールを定義する。

#### タイトル最適化（15点満点）

| 点数 | 条件 | プランナーでの対策 |
|---|---|---|
| 3点 | タイトルが存在する | 必ずタイトル案を生成 |
| 4点 | 25-40文字 | プロンプトで「28-35文字」を指示 |
| 5点 | キーワードを含む | プロンプトで「キーワード含有必須」を指示 |
| 3点 | キーワードが先頭15文字以内 | プロンプトで「キーワード前方配置」を指示 |

#### メタディスクリプション（15点満点）

| 点数 | 条件 | プランナーでの対策 |
|---|---|---|
| 3点 | 存在する | 必ずメタディスクリプション案を生成 |
| 5点 | 80-120文字 | プロンプトで文字数範囲を指示 |
| 5点 | キーワードを含む | プロンプトで「キーワード含有必須」を指示 |
| 2点 | 行動喚起の言葉 | 「解説」「方法」「お伝え」等を含めるよう指示 |

#### 見出し構造（15点満点）

| 点数 | 条件 | プランナーでの対策 |
|---|---|---|
| 4点 | H2が存在する | Stage1アウトラインで H2 を必須化 |
| 3点 | H2が3-7個 | プロンプトで「H2は3-4個」を指示 |
| 3点 | H3が存在する | プロンプトで「各H2にH3を1-3個」を指示 |
| 3点 | 見出しにキーワード | プロンプトで「H2の少なくとも2つにキーワード含有」を指示 |
| 2点 | キーワード入りH2が複数 | 上記で担保 |

#### キーワード最適化（15点満点）

| 点数 | 条件 | プランナーでの対策 |
|---|---|---|
| 3点 | キーワード出現 | Stage2 Writingプロンプトで自然な含有を指示 |
| 5点 | 密度0.5-2.5% | 目標文字数3,000文字 x 密度1.5% = 約15回出現を指示 |
| 4点 | 冒頭200文字以内に出現 | Writingプロンプトで「冒頭にキーワードを含める」を指示 |
| 3点 | 末尾にも出現 | Writingプロンプトで「まとめにキーワードを含める」を指示 |

#### コンテンツ品質（15点満点）

| 点数 | 条件 | プランナーでの対策 |
|---|---|---|
| 5点 | 3,000文字以上 | `target_word_count: 3000` に設定 |
| 3点 | 段落5つ以上 | Writingプロンプトで段落構成を指示 |
| 2点 | リスト要素使用 | プロンプトで「箇条書きを含める」を指示 |
| 1点 | テーブル使用 | プロンプトで「比較表を1つ以上含める」を指示 |
| 2点 | 画像の存在 | 画像3枚（hero/body/summary）を自動生成 |
| 2点 | 強調テキスト | Writingプロンプトで「重要箇所をstrong/emで強調」を指示 |

#### リンク構造（10点満点）

| 点数 | 条件 | プランナーでの対策 |
|---|---|---|
| 4点 | 内部リンク存在 | 関連記事リンクを自動挿入 |
| 2点 | 内部リンク3件以上 | 既存公開記事から関連3件を自動選択 |
| 2点 | 外部リンク | 参考リンク1件を任意挿入 |
| 2点 | 関連記事ラベル | 「関連コラム」「こちらもおすすめ」を付与 |

#### 構造化データ（10点満点）

| 点数 | 条件 | プランナーでの対策 |
|---|---|---|
| 5点 | structured_data 存在 | 生成パイプラインで Article JSON-LD を自動付与 |
| 3点 | FAQ データ存在 | Stage1 で FAQ 2-3件を必ず生成 |
| 2点 | FAQ 3件以上 | プロンプトで「FAQ 3件」を指示 |

#### 技術的SEO（5点満点）

| 点数 | 条件 | プランナーでの対策 |
|---|---|---|
| 2点 | スラッグ設定 | Stage1 で seo_filename を生成 |
| 1点 | スラッグ60文字以内 | プロンプトで「30文字以内推奨」を指示 |
| 1点 | 公開URL | デプロイ時に自動設定 |
| 1点 | 公開日 | 公開時に自動設定 |

### 5.2 スコア予測と実測のフィードバックループ

```
[プラン生成時] SEOスコア予測値を算出（AI推定）
      |
      v
[記事生成後] 実際のSEOスコアを score-calculator.ts で算出
      |
      v
[差分分析] 予測値と実測値のギャップを記録
      |
      v
[改善提案] generateImprovements() で具体的な改善点を提示
      |
      v
[自動修正（将来）] スコアが閾値以下の項目をAIで自動修正
```

### 5.3 目標スコアレンジ

| レベル | SEOスコア | AIOスコア | 判定 |
|---|---|---|---|
| S | 90-100 | 85-100 | 公開推奨 |
| A | 80-89 | 70-84 | 軽微な修正で公開可 |
| B | 60-79 | 50-69 | 要改善 |
| C | 0-59 | 0-49 | 再生成推奨 |

---

## 6. 自動生成キュー設計

### 6.1 キューの状態遷移

```
[pending]    プラン承認済み、生成待ち
    |
    v
[processing] 生成処理中
    |
    +---> [completed]  全ステージ正常完了
    |
    +---> [failed]     いずれかのステージでエラー
    |         |
    |         v
    |     [retrying]   再試行中（最大2回）
    |         |
    |         +---> [completed]
    |         +---> [permanently_failed]  最大再試行回数超過
    |
    +---> [cancelled]  ユーザーがキャンセル
```

### 6.2 生成パイプライン（1プランあたり）

```
[Step 1] アウトライン生成 (Stage1)
  - 所要時間推定: 15-30秒
  - 入力: keyword, theme, persona, perspective_type, source_articles
  - 出力: stage1_outline (JSON)
  - 使用プロンプト: stage1-outline.ts (既存)
      |
      v
[Step 2] 本文生成チェーン (Stage2)
  - 所要時間推定: 60-120秒
  - Writing (temp 0.7) -> Proofreading (temp 0.3) -> QualityCheck (temp 0.2)
  - 入力: stage1_outline + 記事メタ情報
  - 出力: stage2_body_html
  - 使用: prompt-chain.ts (既存)
      |
      v
[Step 3] 画像プロンプト生成
  - 所要時間推定: 10-20秒
  - 入力: stage1_outline.image_prompts
  - 出力: image_prompts (JSON)
  - 使用: image-prompt.ts (既存)
      |
      v
[Step 4] 画像生成 (Banana Pro)
  - 所要時間推定: 30-90秒 x 3枚 = 90-270秒
  - 入力: image_prompts (3枚分)
  - 出力: image_files (Supabase Storage)
  - 使用: gemini-client.ts generateImage() (既存)
      |
      v
[Step 5] CTA挿入 & HTML最終組み立て
  - 入力: stage2_body_html + image_files + cta_texts
  - 出力: stage3_final_html
  - 使用: cta-generator.ts (既存)
      |
      v
[Step 6] SEO/AIOスコア算出
  - 入力: 完成記事
  - 出力: seo_score, aio_score
  - 使用: score-calculator.ts (既存)
      |
      v
[Step 7] 関連記事リンク挿入
  - 入力: 完成記事のテーマ/キーワード
  - 出力: related_articles + 内部リンク挿入済みHTML
```

### 6.3 バッチ処理戦略（パフォーマンスエンジニア見解）

```typescript
interface QueueProcessingConfig {
  // 同時実行数: Gemini API レートリミット考慮
  concurrency: 1,
  // プラン間のインターバル（秒）: レートリミット回避
  intervalBetweenPlansSec: 5,
  // ステージ間のインターバル（秒）
  intervalBetweenStagesSec: 2,
  // 画像生成の同時実行数
  imageGenerationConcurrency: 1,
  // 1バッチあたりの最大プラン数
  maxPlansPerBatch: 10,
  // 最大リトライ回数
  maxRetries: 2,
  // リトライ間隔（秒）: 指数バックオフ
  retryBaseDelaySec: 30,
  // タイムアウト（プラン全体）
  planTimeoutSec: 600, // 10分
}
```

### 6.4 レートリミット管理（セキュリティエンジニア見解）

```typescript
interface RateLimitConfig {
  // Gemini API: RPM (Requests Per Minute)
  geminiRpm: 15,
  // Gemini API: TPM (Tokens Per Minute)
  geminiTpm: 1_000_000,
  // Gemini Image API: RPM
  geminiImageRpm: 5,
  // 1日あたりの最大生成プラン数
  maxPlansPerDay: 50,
  // 1日あたりの推定API費用上限（USD）
  dailyCostLimitUsd: 10.0,
  // トークン使用量の累積追跡
  trackTokenUsage: true,
}
```

### 6.5 コスト推定

| 処理 | 1プランあたりのトークン数 | 推定コスト (USD) |
|---|---|---|
| キーワードリサーチ | ~2,000 (出力) | ~$0.02 |
| プラン生成 | ~3,000 (出力) | ~$0.03 |
| Stage1 アウトライン | ~2,000 (出力) | ~$0.02 |
| Stage2 Writing | ~4,000 (出力) | ~$0.04 |
| Stage2 Proofreading | ~4,000 (出力) | ~$0.04 |
| Stage2 QualityCheck | ~2,000 (出力) | ~$0.02 |
| 画像生成 x 3 | N/A | ~$0.12 |
| **合計 (1プラン)** | | **~$0.29** |
| **10プランバッチ** | | **~$2.90** |

---

## 7. API設計

### 7.1 エンドポイント一覧

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/api/planner/keyword-research` | AIキーワードリサーチ実行 |
| POST | `/api/planner/generate-plans` | AIプラン生成 |
| GET | `/api/planner/plans` | プラン一覧取得 |
| GET | `/api/planner/plans/:id` | プラン詳細取得 |
| PATCH | `/api/planner/plans/:id` | プラン修正 |
| POST | `/api/planner/plans/:id/approve` | プラン承認 |
| POST | `/api/planner/plans/:id/reject` | プラン却下 |
| POST | `/api/planner/plans/batch-approve` | 複数プラン一括承認 |
| GET | `/api/planner/queue` | 生成キュー一覧 |
| GET | `/api/planner/queue/:id` | キュー項目の進捗詳細 |
| POST | `/api/planner/queue/:id/cancel` | キュー項目キャンセル |
| POST | `/api/planner/queue/:id/retry` | キュー項目再試行 |
| GET | `/api/planner/stats` | プランナー統計情報 |

### 7.2 リクエスト/レスポンス詳細

#### POST `/api/planner/keyword-research`

```typescript
// Request
interface KeywordResearchRequest {
  count: 5 | 10;               // 提案件数
  theme_filter?: ThemeCategory; // テーマ絞り込み（任意）
  exclude_keywords?: string[];  // 除外キーワード（任意）
}

// Response
interface KeywordResearchResponse {
  keywords: {
    keyword: string;
    search_volume_estimate: number;
    difficulty: 'low' | 'medium' | 'high';
    search_intent: 'informational' | 'navigational' | 'transactional';
    related_queries: string[];
    suggested_theme: ThemeCategory;
    conversion_potential: 'low' | 'medium' | 'high';
    reasoning: string;
  }[];
  token_usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  generated_at: string;
}
```

#### POST `/api/planner/generate-plans`

```typescript
// Request
interface GeneratePlansRequest {
  keywords: {
    keyword: string;
    suggested_theme: ThemeCategory;
  }[];
}

// Response
interface GeneratePlansResponse {
  plans: ContentPlan[];
  token_usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  batch_id: string;
  generated_at: string;
}

interface ContentPlan {
  id: string;                          // UUID
  batch_id: string;                    // バッチID
  keyword: string;
  theme: ThemeCategory;
  persona: PersonaType;
  perspective_type: PerspectiveType;
  source_article_ids: string[];        // 参照元記事のID配列
  title_draft: string;
  meta_description_draft: string;
  target_word_count: number;
  seo_score_prediction: {
    total: number;
    breakdown: SeoBreakdown;
  };
  reasoning: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'approved' | 'rejected' | 'modified';
  created_at: string;
}
```

#### PATCH `/api/planner/plans/:id`

```typescript
// Request
interface UpdatePlanRequest {
  keyword?: string;
  theme?: ThemeCategory;
  persona?: PersonaType;
  perspective_type?: PerspectiveType;
  source_article_ids?: string[];
  title_draft?: string;
  meta_description_draft?: string;
  target_word_count?: number;
}

// Response: 更新後の ContentPlan
```

#### POST `/api/planner/plans/:id/approve`

```typescript
// Request: ボディなし

// Response
interface ApprovePlanResponse {
  plan: ContentPlan;               // status = 'approved'
  queue_item: GenerationQueueItem; // 生成キューに追加された項目
}
```

#### POST `/api/planner/plans/batch-approve`

```typescript
// Request
interface BatchApproveRequest {
  plan_ids: string[];
}

// Response
interface BatchApproveResponse {
  approved_count: number;
  queue_items: GenerationQueueItem[];
}
```

#### GET `/api/planner/queue`

```typescript
// Query Parameters
interface QueueListParams {
  status?: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  batch_id?: string;
  limit?: number;  // default: 20
  offset?: number; // default: 0
}

// Response
interface QueueListResponse {
  items: GenerationQueueItem[];
  total: number;
}

interface GenerationQueueItem {
  id: string;
  plan_id: string;
  article_id: string | null;       // 生成開始後に設定
  batch_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  current_step: string | null;     // 'stage1_outline' | 'stage2_writing' | ... | null
  progress_percent: number;        // 0-100
  steps_completed: string[];
  steps_total: string[];
  error_message: string | null;
  retry_count: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  // JOIN: プラン情報
  plan: {
    keyword: string;
    theme: string;
    title_draft: string;
  };
}
```

#### GET `/api/planner/queue/:id`

```typescript
// Response: GenerationQueueItem（上記と同じ、より詳細なステップログを含む）
interface QueueItemDetailResponse extends GenerationQueueItem {
  step_logs: {
    step: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    started_at: string | null;
    completed_at: string | null;
    duration_ms: number | null;
    token_usage: { prompt: number; completion: number; total: number } | null;
    error: string | null;
  }[];
}
```

#### GET `/api/planner/stats`

```typescript
// Response
interface PlannerStatsResponse {
  total_plans_generated: number;
  total_articles_generated: number;
  avg_seo_score: number;
  avg_aio_score: number;
  theme_distribution: Record<string, number>;
  daily_generation_count: number;
  daily_token_usage: number;
  daily_estimated_cost_usd: number;
}
```

---

## 8. データベース設計

### 8.1 新規テーブル

#### `content_plans` テーブル

```sql
-- AIコンテンツプランナーが生成したプラン
CREATE TABLE IF NOT EXISTS content_plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id UUID NOT NULL,                    -- バッチ識別子

  -- プラン内容
  keyword TEXT NOT NULL,
  theme TEXT NOT NULL,
  persona TEXT NOT NULL,
  perspective_type TEXT NOT NULL,
  source_article_ids UUID[] DEFAULT '{}',    -- 参照元記事ID配列
  title_draft TEXT,
  meta_description_draft TEXT,
  target_word_count INTEGER DEFAULT 3000,

  -- SEOスコア予測
  seo_score_prediction JSONB,                -- { total: number, breakdown: {...} }

  -- メタ
  reasoning TEXT,                             -- 提案理由
  priority TEXT DEFAULT 'medium'
    CHECK (priority IN ('high', 'medium', 'low')),
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'modified')),

  -- 生成された記事への参照
  article_id UUID REFERENCES articles(id) ON DELETE SET NULL,

  -- キーワードリサーチ結果
  keyword_research_data JSONB,               -- 検索ボリューム等

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_content_plans_batch ON content_plans(batch_id);
CREATE INDEX IF NOT EXISTS idx_content_plans_status ON content_plans(status);
CREATE INDEX IF NOT EXISTS idx_content_plans_keyword ON content_plans(keyword);
CREATE INDEX IF NOT EXISTS idx_content_plans_created ON content_plans(created_at DESC);
```

#### `generation_queue` テーブル

```sql
-- 自動生成キュー
CREATE TABLE IF NOT EXISTS generation_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES content_plans(id) ON DELETE CASCADE,
  article_id UUID REFERENCES articles(id) ON DELETE SET NULL,
  batch_id UUID NOT NULL,

  -- ステータス
  status TEXT DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'processing', 'completed',
      'failed', 'cancelled', 'retrying', 'permanently_failed'
    )),

  -- 進捗
  current_step TEXT,                         -- 現在処理中のステップ名
  progress_percent INTEGER DEFAULT 0
    CHECK (progress_percent >= 0 AND progress_percent <= 100),
  steps_completed TEXT[] DEFAULT '{}',
  steps_total TEXT[] DEFAULT ARRAY[
    'stage1_outline',
    'stage2_writing',
    'stage2_proofreading',
    'stage2_qualitycheck',
    'image_prompt_generation',
    'image_generation',
    'cta_insertion',
    'seo_scoring'
  ],

  -- エラー管理
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 2,
  last_error_at TIMESTAMPTZ,

  -- 優先度（プラン優先度から継承）
  priority INTEGER DEFAULT 50,              -- 0=最高 100=最低

  -- ステップ別ログ
  step_logs JSONB DEFAULT '[]'::jsonb,

  -- タイミング
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_generation_queue_status ON generation_queue(status);
CREATE INDEX IF NOT EXISTS idx_generation_queue_batch ON generation_queue(batch_id);
CREATE INDEX IF NOT EXISTS idx_generation_queue_priority ON generation_queue(priority, created_at);
CREATE INDEX IF NOT EXISTS idx_generation_queue_plan ON generation_queue(plan_id);
```

#### `keyword_research_results` テーブル（キャッシュ用）

```sql
-- キーワードリサーチ結果のキャッシュ
CREATE TABLE IF NOT EXISTS keyword_research_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword TEXT NOT NULL,
  search_volume_estimate INTEGER,
  difficulty TEXT CHECK (difficulty IN ('low', 'medium', 'high')),
  search_intent TEXT,
  related_queries TEXT[] DEFAULT '{}',
  suggested_theme TEXT,
  conversion_potential TEXT CHECK (conversion_potential IN ('low', 'medium', 'high')),
  reasoning TEXT,
  batch_id UUID,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_keyword_research_keyword ON keyword_research_results(keyword);
CREATE INDEX IF NOT EXISTS idx_keyword_research_expires ON keyword_research_results(expires_at);
```

### 8.2 既存テーブルへの変更

#### `source_articles` テーブルへの追加カラム

```sql
-- 使用回数の追跡（パフォーマンス最適化用のキャッシュカラム）
ALTER TABLE source_articles
  ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0;

-- 使用された視点変換タイプの記録
ALTER TABLE source_articles
  ADD COLUMN IF NOT EXISTS used_perspective_types TEXT[] DEFAULT '{}';
```

#### `articles` テーブルへの追加カラム

```sql
-- コンテンツプランへの逆参照
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES content_plans(id) ON DELETE SET NULL;

-- AIOスコア（既存のseo_scoreに加えて）
-- 注: aio_score カラムは既にスキーマに存在
```

### 8.3 RLS ポリシー

```sql
-- content_plans
ALTER TABLE content_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users have full access" ON content_plans
  FOR ALL USING (auth.role() = 'authenticated');

-- generation_queue
ALTER TABLE generation_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users have full access" ON generation_queue
  FOR ALL USING (auth.role() = 'authenticated');

-- keyword_research_results
ALTER TABLE keyword_research_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users have full access" ON keyword_research_results
  FOR ALL USING (auth.role() = 'authenticated');
```

### 8.4 更新トリガー

```sql
CREATE OR REPLACE TRIGGER content_plans_updated_at
  BEFORE UPDATE ON content_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER generation_queue_updated_at
  BEFORE UPDATE ON generation_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 8.5 ER図（テキスト）

```
content_plans ─────┐
  |                 |
  | 1:1             | N:M (via source_article_ids[])
  v                 v
generation_queue   source_articles
  |
  | 1:1
  v
articles  <──── (既存)
  |
  | N:1
  v
source_articles (既存)
```

---

## 9. 管理画面UI設計

### 9.1 ナビゲーション

既存のダッシュボードサイドバーに「AIプランナー」メニューを追加:

```
Dashboard
├── 記事一覧         (既存)
├── 元記事管理       (既存)
├── AIプランナー     (新規) ★
│   ├── プラン生成
│   ├── プラン一覧
│   └── 生成キュー
└── 設定             (既存)
```

### 9.2 プラン生成画面 ワイヤーフレーム

```
+================================================================+
|  AIコンテンツプランナー                                           |
+================================================================+
|                                                                  |
|  +--------------------------+  +-----------------------------+   |
|  | 生成設定                  |  | キーワードリサーチ結果         |   |
|  |                          |  |                             |   |
|  | 件数: [5件 v]            |  | (リサーチ実行後に表示)        |   |
|  |                          |  |                             |   |
|  | テーマ絞り込み:           |  | [ ] チャクラ 浄化 方法       |   |
|  | [全テーマ v]             |  |     Vol:800 難易度:中         |   |
|  |                          |  |     テーマ:healing           |   |
|  | 除外キーワード:           |  |                             |   |
|  | [                    ]   |  | [x] ツインレイ 特徴 見分け方  |   |
|  |                          |  |     Vol:1200 難易度:高        |   |
|  | [キーワードリサーチ実行]   |  |     テーマ:relationships     |   |
|  |                          |  |                             |   |
|  +--------------------------+  | [ ] グリーフケア 段階 乗り越え |   |
|                                 |     Vol:400 難易度:低         |   |
|                                 |     テーマ:grief_care        |   |
|                                 |                             |   |
|                                 | ...                         |   |
|                                 |                             |   |
|                                 | [選択したキーワードでプラン生成]|   |
|                                 +-----------------------------+   |
|                                                                  |
+==================================================================+
```

### 9.3 プランレビュー画面 ワイヤーフレーム

```
+================================================================+
|  プランレビュー          バッチ: 2026-04-03 #1                    |
|  [全て承認] [全て却下]                                            |
+================================================================+
|                                                                  |
|  +------------------------------------------------------------+ |
|  | プラン #1                         SEO予測: 92/100  [高]     | |
|  |------------------------------------------------------------| |
|  | キーワード: チャクラ 浄化 方法                                 | |
|  | テーマ: healing          ペルソナ: meditation_practitioner   | |
|  | 視点: concept_to_practice                                   | |
|  | 文字数: 3,000                                               | |
|  |                                                            | |
|  | タイトル案:                                                  | |
|  | 「チャクラ浄化の方法とは？初心者でもできる7つの実践ガイド」       | |
|  |                                                            | |
|  | 元記事:                                                      | |
|  |   1. [チャクラについて知ろう] (2019-03-15)                    | |
|  |   2. [エネルギーの浄化法] (2020-08-22)                       | |
|  |                                                            | |
|  | 提案理由:                                                    | |
|  | 「チャクラ浄化」は検索ボリュームが安定し、実践ガイド型の記事が    | |
|  | 少ないため上位表示が見込める。元記事2件の概念解説を実践的な       | |
|  | ワークに変換することで差別化を図る。                             | |
|  |                                                            | |
|  | SEOスコア内訳:                                               | |
|  | タイトル 15 | メタ 14 | 見出し 14 | KW 13 | 品質 13 |       | |
|  | リンク 8  | 構造化 10 | 技術 5                               | |
|  |                                                            | |
|  | [承認]  [修正]  [却下]                                       | |
|  +------------------------------------------------------------+ |
|                                                                  |
|  +------------------------------------------------------------+ |
|  | プラン #2                         SEO予測: 88/100  [中]     | |
|  |------------------------------------------------------------| |
|  | キーワード: ツインレイ 特徴 見分け方                           | |
|  | ...                                                        | |
|  +------------------------------------------------------------+ |
|                                                                  |
+==================================================================+
```

### 9.4 プラン修正モーダル

```
+================================================+
|  プラン修正                               [x]   |
+================================================+
|                                                  |
|  キーワード:                                      |
|  [チャクラ 浄化 方法                          ]   |
|                                                  |
|  テーマ:                                          |
|  [healing                               v]       |
|                                                  |
|  ペルソナ:                                        |
|  [meditation_practitioner               v]       |
|                                                  |
|  視点変換タイプ:                                  |
|  [concept_to_practice                   v]       |
|                                                  |
|  目標文字数:                                      |
|  [3000                                      ]    |
|                                                  |
|  元記事:                                          |
|  [x] チャクラについて知ろう                        |
|  [x] エネルギーの浄化法                            |
|  [ ] 毎朝のヒーリング習慣                          |
|  [元記事を検索...]                                |
|                                                  |
|  タイトル案:                                      |
|  [チャクラ浄化の方法とは？初心者でもできる...    ]  |
|                                                  |
|  [キャンセル]           [変更を保存]              |
+================================================+
```

### 9.5 生成キュー画面 ワイヤーフレーム

```
+================================================================+
|  生成キュー                                                       |
|  処理中: 1件  待機中: 3件  完了: 5件  エラー: 1件                  |
+================================================================+
|                                                                  |
|  +------------------------------------------------------------+ |
|  | [処理中] チャクラ 浄化 方法                                    | |
|  |  ████████████░░░░░░░░  60%                                  | |
|  |  現在: 本文生成 (Writing)                                     | |
|  |  開始: 14:32:05  経過: 45秒                                   | |
|  |  完了ステップ:                                                | |
|  |    [done] アウトライン生成 (12秒)                              | |
|  |    [done] 本文生成 - Writing (30秒)                            | |
|  |    [>>] 本文生成 - Proofreading                               | |
|  |    [ ] 本文生成 - QualityCheck                                | |
|  |    [ ] 画像プロンプト生成                                      | |
|  |    [ ] 画像生成 (3枚)                                         | |
|  |    [ ] CTA挿入 & HTML組み立て                                 | |
|  |    [ ] SEO/AIOスコア算出                                      | |
|  +------------------------------------------------------------+ |
|                                                                  |
|  +------------------------------------------------------------+ |
|  | [待機中] ツインレイ 特徴 見分け方                 優先度: 中   | |
|  |  ░░░░░░░░░░░░░░░░░░░░  0%                                  | |
|  |  予定開始: 14:35:00頃                                        | |
|  |  [キャンセル]                                                 | |
|  +------------------------------------------------------------+ |
|                                                                  |
|  +------------------------------------------------------------+ |
|  | [エラー] 瞑想 初心者 やり方                    再試行: 1/2   | |
|  |  ████████░░░░░░░░░░░░  40%                                  | |
|  |  エラー: Gemini API timeout after 120000ms                    | |
|  |  最終エラー: 14:28:33                                        | |
|  |  [再試行]  [キャンセル]                                       | |
|  +------------------------------------------------------------+ |
|                                                                  |
|  +------------------------------------------------------------+ |
|  | [完了] グリーフケア 段階 乗り越え方              SEO: 94/100  | |
|  |  ████████████████████  100%                                 | |
|  |  完了: 14:25:12  所要: 3分22秒                                | |
|  |  [記事を確認]                                                 | |
|  +------------------------------------------------------------+ |
|                                                                  |
+==================================================================+
```

### 9.6 UI実装のポイント（UXデザイナー見解）

1. **プログレスバー**: CSS transitions で滑らかに更新。5秒間隔でポーリング
2. **承認フロー**: ワンクリック承認、Shift+クリックで範囲選択承認
3. **カード表示**: SEOスコア予測値をカラーバッジで視覚化（S:緑 A:青 B:黄 C:赤）
4. **修正モーダル**: セレクトボックスは既存のテーマ/ペルソナマスタから動的に取得
5. **トースト通知**: 生成完了時にブラウザ通知（Notification API）
6. **エラーハンドリング**: エラー詳細をアコーディオンで展開表示、コピーボタン付き

---

## 10. 実装ファイルリスト

### 10.1 新規ファイル

```
src/
├── app/
│   ├── (dashboard)/dashboard/planner/
│   │   ├── page.tsx                          # プランナートップ（プラン生成画面）
│   │   ├── plans/
│   │   │   └── page.tsx                      # プラン一覧・レビュー画面
│   │   └── queue/
│   │       └── page.tsx                      # 生成キュー画面
│   └── api/planner/
│       ├── keyword-research/
│       │   └── route.ts                      # POST: キーワードリサーチ
│       ├── generate-plans/
│       │   └── route.ts                      # POST: プラン生成
│       ├── plans/
│       │   ├── route.ts                      # GET: プラン一覧
│       │   ├── [id]/
│       │   │   ├── route.ts                  # GET/PATCH: プラン詳細・修正
│       │   │   ├── approve/
│       │   │   │   └── route.ts              # POST: プラン承認
│       │   │   └── reject/
│       │   │       └── route.ts              # POST: プラン却下
│       │   └── batch-approve/
│       │       └── route.ts                  # POST: 一括承認
│       ├── queue/
│       │   ├── route.ts                      # GET: キュー一覧
│       │   ├── [id]/
│       │   │   ├── route.ts                  # GET: キュー詳細
│       │   │   ├── cancel/
│       │   │   │   └── route.ts              # POST: キャンセル
│       │   │   └── retry/
│       │   │       └── route.ts              # POST: 再試行
│       │   └── process/
│       │       └── route.ts                  # POST: キュー処理実行（内部用）
│       └── stats/
│           └── route.ts                      # GET: 統計情報
├── components/planner/
│   ├── KeywordResearchForm.tsx               # キーワードリサーチ設定フォーム
│   ├── KeywordResultList.tsx                 # キーワードリサーチ結果リスト
│   ├── PlanCard.tsx                          # プランカード（レビュー用）
│   ├── PlanEditModal.tsx                     # プラン修正モーダル
│   ├── PlanReviewList.tsx                    # プランレビュー一覧
│   ├── QueueItemCard.tsx                     # キュー項目カード
│   ├── QueueProgressBar.tsx                  # 進捗バー
│   ├── QueueDashboard.tsx                    # キュー管理ダッシュボード
│   ├── SeoScoreBadge.tsx                     # SEOスコアバッジ
│   └── PlannerStats.tsx                      # 統計表示
├── hooks/
│   ├── usePlannerKeywordResearch.ts          # キーワードリサーチ hook
│   ├── usePlannerPlans.ts                    # プラン管理 hook
│   └── usePlannerQueue.ts                    # キュー管理 hook（ポーリング含む）
├── lib/
│   ├── ai/prompts/
│   │   ├── planner-keyword-research.ts       # キーワードリサーチプロンプト
│   │   └── planner-plan-generation.ts        # プラン生成プロンプト
│   ├── planner/
│   │   ├── keyword-researcher.ts             # キーワードリサーチロジック
│   │   ├── plan-generator.ts                 # プラン生成ロジック
│   │   ├── source-article-selector.ts        # 元記事選択アルゴリズム
│   │   ├── queue-processor.ts                # キュー処理エンジン
│   │   ├── rate-limiter.ts                   # レートリミッター
│   │   └── cost-tracker.ts                   # コスト追跡
│   └── db/
│       ├── content-plans.ts                  # content_plans テーブル操作
│       └── generation-queue.ts               # generation_queue テーブル操作
└── types/
    └── planner.ts                            # プランナー関連の型定義
```

### 10.2 変更が必要な既存ファイル

```
src/
├── app/(dashboard)/dashboard/
│   └── layout.tsx or page.tsx                # サイドバーに「AIプランナー」追加
├── lib/ai/prompts/
│   └── stage1-outline.ts                     # target_word_count デフォルトを 3000 に変更する
│                                             # オプションを追加
├── lib/ai/
│   └── prompt-chain.ts                       # キューからの呼び出し対応
│                                             # （onProgress コールバック経由でキュー更新）
├── lib/db/
│   └── source-articles.ts                    # getRandomUnusedSource を拡張
│                                             # -> 使用回数追跡、視点変換タイプフィルタ追加
├── types/
│   └── article.ts                            # plan_id フィールド追加
└── supabase/
    └── schema.sql                            # 新テーブル追加、既存テーブル変更
```

### 10.3 マイグレーションファイル

```
supabase/migrations/
└── 20260403_add_content_planner.sql          # 全テーブル作成 & 変更の統合マイグレーション
```

### 10.4 テスト戦略（テストエンジニア見解）

```
test/
├── lib/planner/
│   ├── keyword-researcher.test.ts            # キーワードリサーチロジック単体テスト
│   ├── plan-generator.test.ts                # プラン生成ロジック単体テスト
│   ├── source-article-selector.test.ts       # 元記事選択アルゴリズム単体テスト
│   ├── queue-processor.test.ts               # キュー処理エンジン単体テスト
│   └── rate-limiter.test.ts                  # レートリミッター単体テスト
├── api/planner/
│   ├── keyword-research.test.ts              # API 統合テスト
│   ├── generate-plans.test.ts                # API 統合テスト
│   ├── plans.test.ts                         # API 統合テスト
│   └── queue.test.ts                         # API 統合テスト
└── components/planner/
    ├── PlanCard.test.tsx                      # コンポーネント単体テスト
    └── QueueProgressBar.test.tsx              # コンポーネント単体テスト
```

テスト方針:
- Gemini API 呼び出しはモック化（`vi.mock('@/lib/ai/gemini-client')`）
- Supabase 操作はテスト用クライアントを使用
- キュー処理は `fake timers` でタイムアウト・リトライをシミュレート
- SEOスコア計算は既存テストスイートに統合

---

## 付録

### A. 実装優先度（プロダクトマネージャー合議）

| フェーズ | 内容 | 推定工数 | 優先度 |
|---|---|---|---|
| Phase 1 | DB設計 + 型定義 + APIスケルトン | 2日 | 最高 |
| Phase 2 | キーワードリサーチ + プラン生成ロジック | 3日 | 最高 |
| Phase 3 | プランレビューUI（一覧・承認・修正） | 3日 | 高 |
| Phase 4 | 生成キュー処理エンジン | 3日 | 高 |
| Phase 5 | キュー管理UI + 進捗表示 | 2日 | 高 |
| Phase 6 | レートリミット + コスト管理 | 1日 | 中 |
| Phase 7 | 統計ダッシュボード | 1日 | 中 |
| Phase 8 | テスト + バグ修正 | 2日 | 高 |
| **合計** | | **17日** | |

### B. リスクと対策（ディレクター最終判断）

| リスク | 影響度 | 対策 |
|---|---|---|
| Gemini API レートリミット超過 | 高 | 同時実行数1、インターバル5秒、日次上限50件 |
| API費用超過 | 中 | 日次コスト上限$10、ダッシュボードで費用表示 |
| SEOスコア予測と実測の乖離 | 中 | フィードバックループで予測精度を改善 |
| 元記事の枯渇（全1,441件使用後） | 低 | 異なる視点変換タイプでの再利用を許可 |
| バッチ処理中のサーバー負荷 | 中 | Vercel の Serverless Function タイムアウト(60s)を考慮し、キュー処理は個別API呼び出しに分割 |
| 不適切コンテンツ生成 | 低 | 既存QualityCheckステップで医療・宗教断定を排除 |

### C. Vercel Serverless 制約への対応

Vercel の Serverless Function は最大60秒（Pro: 300秒）のタイムアウト制約がある。1プランの全ステージ処理（約3-5分）は1リクエストに収まらないため、以下の設計を採用:

1. **ステップ分割実行**: 各ステップを個別のAPI呼び出しとして実行
2. **クライアントサイド オーケストレーション**: フロントエンドがステップ完了を検知し、次のステップのAPIを呼び出す
3. **代替案（将来）**: Vercel Cron Jobs またはSupabase Edge Functions でバックグラウンド実行

```
フロントエンド (orchestrator)
  |-> POST /api/planner/queue/:id/process?step=stage1_outline
  |<- 200 OK (完了)
  |-> POST /api/planner/queue/:id/process?step=stage2_chain
  |<- 200 OK (完了)
  |-> POST /api/planner/queue/:id/process?step=image_generation
  |<- 200 OK (完了)
  |-> POST /api/planner/queue/:id/process?step=finalize
  |<- 200 OK (完了)
```

### D. スピリチュアルコンテンツ適切性ガイドライン（スピリチュアルカウンセラー代理見解）

プラン生成時に以下を遵守:

1. **医療効果の断定禁止**: 「チャクラを浄化すれば病気が治る」等は不可
2. **宗教的断定禁止**: 特定の信仰を推奨・否定しない
3. **不安の過度な煽り禁止**: 「このまま放置すると不幸になる」等は不可
4. **科学的根拠の明示**: 「個人の感想です」「効果には個人差があります」を適切に付記
5. **自己責任の明示**: 免責事項を記事末尾に自動付記（既存の仕様を維持）
6. **グリーフケア配慮**: 死別・喪失テーマは特に慎重なトーンを維持

---

*本仕様書は20人のエキスパートチームによる合議の結果をまとめたものです。実装にあたっては Phase 1 から順次進行し、各フェーズ完了時にレビューを実施してください。*
