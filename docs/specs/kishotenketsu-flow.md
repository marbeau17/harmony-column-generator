# 起承転結ナラティブ検証フロー仕様書

**Spec ID**: kishotenketsu-flow
**Author**: Planner (Claude Opus 4.7) + 5 並列 Spec Agents
**Status**: Draft (要 Evaluator レビュー)
**Created**: 2026-05-09
**Phases**: P5-99 〜 P5-103

---

## §1 目的

由起子さんのコラムは「深い納得」を読者に届けるため、**視点転換 (転)** を必須とする (memory: `feedback_yukiko.md`)。現状の Stage1 outline は `narrative_arc` (awareness/wavering/acceptance/action) を出力するが、起承転結という明示的な 4 段構造に縛られず、AI が「だらだらと続く」記事を生成するリスクがある。

本仕様は:

1. Stage1 で `kishotenketsu` (起・承・転・結) を必須出力させる
2. UI で 4 段プランをユーザー (由起子さん) がレビュー → 承認 → Stage2 に渡す前段ゲートを設ける
3. Stage2 prompt に承認済 kishotenketsu を inject し、AI に必須遵守させる
4. 公開時 quality_check で起承転結が本文に反映されているかを post-validate する

## §2 スコープ

- **対象**: `generation_mode='zero'` のみ
- **対象外**: `generation_mode='source'` (旧アメブロ書換) は本仕様の影響を受けない
- **後方互換**: 既存記事は `kishotenketsu IS NULL` のまま読み書き可。Stage2 prompt は値が無ければ既存 path にフォールバック
- **Feature flag**: `NEXT_PUBLIC_KISHOTENKETSU_ENABLED` で全体 ON/OFF 切替可能 (settings UI/env 駆動、ハードコード禁止)

---

## §3 データ構造

### 3.1 `kishotenketsu` zod schema 追加

`src/lib/ai/prompts/stage1-zero-outline.ts` に additive で追加 (既存 `narrative_arc` は **残置** — backward compat)。

```ts
const kishotenketsuPhaseSchema = z
  .string()
  .min(50, '各 phase は 50 字以上')
  .max(150, '各 phase は 150 字以内');

const kishotenketsuSchema = z.object({
  ki:    kishotenketsuPhaseSchema, // 起: テーマ提示・読者の現在地の言語化
  sho:   kishotenketsuPhaseSchema, // 承: 起の深掘り・読者の感情への寄り添い
  ten:   kishotenketsuPhaseSchema, // 転: 視点転換 (Yukiko signature)。承と逆方向の気づきを必須
  ketsu: kishotenketsuPhaseSchema, // 結: 転を踏まえた受容と小さな行動提案
  // 転 が承と同方向で「深掘り」になっていないかの自己診断
  ten_perspective_shift: z.string().min(20).max(120),
});

// zeroOutlineOutputSchema 追記 (additive)
export const zeroOutlineOutputSchema = z.object({
  lead_summary: z.string().min(1),
  narrative_arc: narrativeArcSchema,           // 既存・残置
  kishotenketsu: kishotenketsuSchema,          // 新規・必須
  emotion_curve: z.array(z.number()).min(1),
  h2_chapters: z.array(h2ChapterSchema).min(1),
  citation_highlights: z.array(z.string()).min(1),
  faq_items: z.array(faqItemSchema).min(1),
  image_prompts: z.array(imagePromptSchema).min(1),
  meta_description: z.string().min(50).max(200),
});
```

### 3.2 H2 マッピングルール

`h2_chapters[i]` に新規 `kishotenketsu_phase: 'ki'|'sho'|'ten'|'ketsu'` をオプショナル追加。Stage1 prompt 内で以下のマッピング規則を明記する。

| H2 数 | マッピング |
|:---:|:---|
| 3 | H2-1: 起+承 / H2-2: **転** (必須独立) / H2-3: 結 |
| 4 | H2-1: 起 / H2-2: 承 / H2-3: **転** / H2-4: 結 (1:1 対応・推奨形) |
| 5+ | H2-1: 起 / H2-2..N-2: 承 (複数可) / H2-N-1: **転** (1 章独立必須) / H2-N: 結 |

**不変条件**: 転は必ず単一の H2 として独立させる (起・承・結との合体禁止)。理由: 視点転換が他 phase に薄まると由起子さん FB 14-5「深い納得」が崩壊する。

---

## §4 Stage1 Prompt 拡張

### 4.1 system prompt 追記文 (literal Japanese, paste-ready)

既存「## ナラティブ・アーク」セクション**直後**に挿入:

```
## 起承転結 (kishotenketsu — 必須出力・narrative_arc と並列で生成)

由起子さんのコラムは日本古来の「起承転結」に従って物語を描きます。
narrative_arc が感情曲線 (内的動き) を表すのに対し、kishotenketsu は
「論の骨格」(読者の視点がどう動くか) を表します。両方とも必ず生成してください。

1. 起 (ki) 50〜150字: テーマを優しく差し出し、読者の現在地を言語化する
   例: 「最近、〇〇と感じることはありませんか？」のような問いかけで始める
2. 承 (sho) 50〜150字: 起をさらに深掘り、読者の感情に寄り添う
   例: 「その感覚は、実は多くの人が抱えているものなんです」
3. 転 (ten) 50〜150字: **視点転換 — 由起子さん署名の核**
   - 承で示した方向と **異なる視点** を「でも実は」「けれど」で提示する
   - 必須条件: 起・承の延長線上ではない、180度ではなくとも90度以上の角度の気づき
   - 禁止: 承の言い換え・深掘りに留まる「平行展開」
4. 結 (ketsu) 50〜150字: 転を受け入れた先の希望と、今日からできる小さな一歩
   - 「〜してみてくださいね」で締める

加えて ten_perspective_shift (20〜120字) に「承から転への視点の角度がどう変わったか」
を簡潔に自己説明してください。

## 起承転結 と H2 のマッピング規則
- H2 = 3 章: H2-1 (起+承) / H2-2 (転) / H2-3 (結)
- H2 = 4 章: H2-1 (起) / H2-2 (承) / H2-3 (転) / H2-4 (結)
- H2 = 5 章以上: H2-1 (起) / 中間 (承複数可) / 末尾-1 (転・必須独立) / 末尾 (結)
- **転は必ず単一の H2 として独立させること**
- h2_chapters[i] に kishotenketsu_phase: 'ki'|'sho'|'ten'|'ketsu' を付与する

## 絶対禁止 (kishotenketsu)
- 転 (ten) を承 (sho) の言い換え・深掘り・平行展開にすること
- 転 を結論や行動提案にすること (それは結 ketsu の役割)
- 各 phase が 50 字未満 / 150 字超になること
- ten_perspective_shift を空文字 / 「視点を転換」等の抽象一般論で済ませること
```

### 4.2 user prompt 追記文

既存「## 設計指針」リスト末尾に追加:

```
8. **kishotenketsu (ki / sho / ten / ketsu) を必ず出力する**。各 50〜150 字。
   ten は承と異なる視点角度を持つこと。ten_perspective_shift で角度差を自己説明する
9. h2_chapters[i] に kishotenketsu_phase ('ki'|'sho'|'ten'|'ketsu') を付与し、
   §4.1 の H2 マッピング規則 (3/4/5+ 章別) に従う。転は必ず 1 章独立させる
```

### 4.3 検証ポイント (Evaluator)

1. **schema 通過**: Stage1 outline 生成後、`kishotenketsu.{ki,sho,ten,ketsu}` 全て 50〜150 字 (`safeParse` 成功)
2. **転の独立性**: `h2_chapters` のうち `kishotenketsu_phase === 'ten'` の章が **ちょうど 1 つ** 存在
3. **H2 マッピング整合**: 章数 3/4/5+ それぞれで規則どおりに ki / sho / ten / ketsu の出現順が単調昇順
4. **転の視点転換性**: `ten` テキストの先頭 20 字が `sho` と異なり、`ten` 内に「でも」「けれど」「実は」「一方で」「ところが」のいずれかが含まれる
5. **ten_perspective_shift 実体**: 20 字以上で抽象 boilerplate のみで終わっていない
6. **後方互換**: `narrative_arc` も従来どおり生成され、Stage2 prompt の `arcText` 構築が壊れない

---

## §5 Stage2 Prompt 拡張 — kishotenketsu 注入

### 5.1 user prompt 追記文 (literal, paste-ready)

`buildZeroWritingUserPrompt` の「## ナラティブ・アーク」直後、「## 感情曲線」の前に以下のブロックを挿入する。`outline.kishotenketsu` が非空かつ `kishotenketsu_approved_at IS NOT NULL` のときのみ出力する。

```
## 起承転結構造 (必須遵守・由起子さんが承認した物語設計)

これは由起子さん本人が承認した「物語の四段構成」です。
**4 段それぞれを 1 つの H2 章に対応付けて執筆してください。**
順序の入れ替え・段の省略・段の融合は禁止です。

- 起 (導入・読者の現実への共感): ${approved.ki}
  → 対応 H2: ${h2_chapters[0].title} (kishotenketsu_phase: ki)
- 承 (深掘り・読者がうすうす感じていることの言語化): ${approved.sho}
  → 対応 H2: ${h2_chapters[1].title} (kishotenketsu_phase: sho)
- 転 (視点の転換・由起子さんの核心的気づき): ${approved.ten}
  → 対応 H2: ${h2_chapters[2].title} (kishotenketsu_phase: ten)
- 結 (受容と祈り・行動への小さな招待): ${approved.ketsu}
  → 対応 H2: ${h2_chapters[3].title} (kishotenketsu_phase: ketsu)

### 転 (ten) の書き方 (最重要)
「転」は本記事のオリジナリティを担う最重要セクションです。承までで積み上げた
読者の理解に対して、**異なる視点を導入する**こと。「実は」「けれど」「視点を変えると」
「もう一段奥には」といった転換語で必ず開始し、承の延長にならないようにしてください。

禁止: 承で述べた内容を言い換えるだけの転
推奨: 承の前提そのものを問い直す転

### 結 (ketsu) の書き方
結は「転で得た新しい視点」を読者の日常に降ろす段です。転の繰り返しではなく、
転を踏まえた**行動提案と祈り**で閉じてください。
「〜してみてくださいね」「〜しますように」を必ず含めること。
```

### 5.2 Stage1 → Stage2 受け渡し

- `run-completion.ts` 無変更。`outline = article.stage1_outline` 経由で `outline.kishotenketsu` がそのまま `buildZeroWritingUserPrompt` に渡る。ファイル変更は `stage2-zero-writing.ts` のみ。
- `kishotenketsu IS NULL` または `kishotenketsu_approved_at IS NULL` の場合: 5.1 ブロック全体を出力しない (旧 path 互換)。`logger.warn('ai', 'kishotenketsu.absent', { article_id })` で観測。
- H2 章数が 4 と異なる場合: 「対応 H2:」マッピング行を出力せず、4 段のテキストのみ提示する。

### 5.3 失敗モード予防

- 「転が承と区別不能」: prompt に「**異なる視点を導入する**」「承の前提そのものを問い直す」を明記。few-shot で禁止例 / 推奨例ペア提示
- 承と結の融合: 結に「行動提案 + 祈り」を必須化 (「〜してみてくださいね」「〜しますように」)
- AI が起承転結ブロック無視: prompt 改修だけでは検出不可 → §8 quality_check で post-validate

### 5.4 検証ポイント (Evaluator)

1. テストフィクスチャで `buildZeroWritingUserPrompt` を呼び、出力に「起承転結構造」「対応 H2:」が含まれる (unit test)
2. `kishotenketsu = null` フィクスチャでは 5.1 ブロックが **1 文字も出力されない** (後方互換ガード)
3. Playwright E2E: 起承転結 UI で 4 段承認 → zero-generate-full 実行 → 生成記事の H2-3 冒頭文に「けれど」「実は」「視点を変えると」のいずれかが含まれる
4. ログ: `kishotenketsu.absent` warn が 24h ゼロ件 (承認 UI が機能している証跡)
5. リグレッション: `kishotenketsu` 未設定の旧 fixture で生成 HTML が変更前後 diff ゼロ

---

## §6 UI 起承転結レビュー画面

### 6.1 配置位置

**対象ファイル**: `src/app/(dashboard)/dashboard/articles/[id]/outline/page.tsx`

挿入位置: 既存「見出し構成」セクション (line 397〜419) と「CTA / 画像配置」 (line 421〜) の **間** に新規 `<section>` を 1 ブロック追加。

**API 拡張 / 新設**:
- 既存 `PUT /api/articles/[id]` を拡張 (`kishotenketsu` jsonb / `kishotenketsu_approved_at` timestamptz を受理)
- 新規 `POST /api/ai/generate-kishotenketsu` (Stage1 outline → 4 幕ドラフト生成、retry 用)
- Stage2 起動 (`POST /api/ai/generate-body`) に **`kishotenketsu_approved_at IS NOT NULL` 必須の 412 Precondition Failed ガード**追加

### 6.2 画面構成 (ASCII mockup)

```
┌─ 起承転結ナラティブ (Stage2 前の最終確認) ─────────────────┐
│ [未承認] / [承認済 ✓ 2026-05-09 14:32]                    │
│                                                            │
│ 起 [______________________________________]   (XX/150)    │
│   読者の入口。共感から始める。                              │
│                                                            │
│ 承 [______________________________________]   (XX/150)    │
│   テーマを深める。例示・体験。                              │
│                                                            │
│ 転 [______________________________________]   (XX/150)    │
│   ← ここで「視点転換」を入れます (由起子さん signature)     │
│                                                            │
│ 結 [______________________________________]   (XX/150)    │
│   優しい余韻で締める。CTA への橋渡し。                      │
│                                                            │
│ [← Stage1 を再実行]  [編集を一時保存]  [✓ 承認して本文生成] │
└────────────────────────────────────────────────────────────┘
```

各 phase は `<textarea rows={3}>`、`dark:` クラス対応必須。転 phase のみ `border-l-4 border-gold` で視覚強調。

### 6.3 状態遷移

| 前提 | バッジ | Stage2 ボタン |
|:---|:---|:---|
| `kishotenketsu` IS NULL | 「未生成」 (slate) | disabled (先に「起承転結を生成」必要) |
| `kishotenketsu` 有り & `approved_at` IS NULL | 「未承認」 (amber) | **disabled** |
| `approved_at` IS NOT NULL & textarea 編集なし | 「承認済」 (sage) | **enabled** |

**自動 invalidate**: 任意 phase の textarea `onChange` で `setApprovedAt(null)` → 「承認済」→「未保存の編集あり」 → Stage2 ボタン即時 disable

**Stage1 再実行**: `POST /api/ai/generate-outline` 後、サーバ側で `kishotenketsu = NULL, kishotenketsu_approved_at = NULL` を同時クリア (整合性保証)

**承認フロー**:
1. PUT `/api/articles/[id]` body: `{ kishotenketsu, kishotenketsu_approved_at: new Date().toISOString() }`
2. POST `/api/ai/generate-body` (412 ガードを通過) → `router.push(.../review)`

### 6.4 検証ポイント (Playwright)

1. **承認前ガード**: `kishotenketsu_approved_at IS NULL` で「承認して本文生成」ボタンが `aria-disabled="true"`。直接 `POST /api/ai/generate-body` を叩くと 412
2. **編集 invalidation**: 承認後 `textarea[name="ten"]` 入力で即「承認済」→「未保存」へ、Stage2 disable
3. **文字数カウンター**: `data-testid="kishotenketsu-counter-{ki|sho|ten|ketsu}"` が 50 未満で red、50–150 で sage、150 超で red
4. **転 hint**: 転カードに「視点転換」「由起子さん signature」テキストが DOM 存在
5. **Stage1 再実行クリア**: 承認済状態で再実行 → DB の `kishotenketsu_approved_at = NULL` + UI 「未承認」遷移
6. **承認 → Stage2 一気通貫**: 承認ボタン → PUT → POST → review 画面遷移が 1 フロー (network log)
7. **ダークモード**: `prefers-color-scheme: dark` で全カード/ボタンが WCAG AA (≥ 4.5:1)
8. **UTF-8**: 「起」「承」「転」「結」がページ HTML に正しく出力 (Mojibake 禁止)

---

## §7 DB Migration + RLS

### 7.1 Migration SQL

ファイル: `supabase/migrations/20260509000000_add_kishotenketsu.sql`

```sql
-- ============================================================================
-- 20260509000000_add_kishotenketsu.sql
-- 目的 (P5-99): articles に「起承転結」構造化データと承認メタデータを追加。
--
-- 設計方針:
--   - additive ALTER のみ。既存列・既存データには触れない。
--   - すべて IF NOT EXISTS で再実行耐性 (G1 hardening 規約準拠)。
--   - kishotenketsu は { ki, sho, ten, ketsu } の 4 文字列を保持する JSONB。
--   - reviewed_at と独立した承認軸として kishotenketsu_approved_at/_by を設置。
-- ============================================================================

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS kishotenketsu JSONB;

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS kishotenketsu_approved_at TIMESTAMPTZ;

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS kishotenketsu_approved_by UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- 形状検証: object かつ ki/sho/ten/ketsu すべて string であること
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'articles_kishotenketsu_shape_chk'
  ) THEN
    ALTER TABLE articles
      ADD CONSTRAINT articles_kishotenketsu_shape_chk
      CHECK (
        kishotenketsu IS NULL
        OR (
          jsonb_typeof(kishotenketsu) = 'object'
          AND jsonb_typeof(kishotenketsu->'ki')    = 'string'
          AND jsonb_typeof(kishotenketsu->'sho')   = 'string'
          AND jsonb_typeof(kishotenketsu->'ten')   = 'string'
          AND jsonb_typeof(kishotenketsu->'ketsu') = 'string'
        )
      );
  END IF;
END $$;

-- 承認済み記事の検索用 partial index
CREATE INDEX IF NOT EXISTS idx_articles_kishotenketsu_approved_at
  ON articles (kishotenketsu_approved_at)
  WHERE kishotenketsu_approved_at IS NOT NULL;

COMMENT ON COLUMN articles.kishotenketsu IS
  'P5-99: 起承転結 4 段の本文プラン。{ki, sho, ten, ketsu: string} JSONB。';
COMMENT ON COLUMN articles.kishotenketsu_approved_at IS
  'P5-99: 起承転結プラン承認時刻。NULL=未承認。';
COMMENT ON COLUMN articles.kishotenketsu_approved_by IS
  'P5-99: 承認者の auth.users.id。';
```

### 7.2 RLS

- 既存 articles RLS でカバー: `ADD COLUMN` で追加した列は既存ポリシー保護下に自動的に入る (Postgres RLS は行単位評価)
- 新規ポリシー不要: 起承転結データは記事の付随属性であり、認可境界が既存 (記事を読める者は起承転結も読める / 編集できる者は編集できる) と完全一致

### 7.3 Rollback

```sql
ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_kishotenketsu_shape_chk;
DROP INDEX IF EXISTS idx_articles_kishotenketsu_approved_at;
ALTER TABLE articles DROP COLUMN IF EXISTS kishotenketsu_approved_by;
ALTER TABLE articles DROP COLUMN IF EXISTS kishotenketsu_approved_at;
ALTER TABLE articles DROP COLUMN IF EXISTS kishotenketsu;
```

---

## §8 quality_check kishotenketsu_check

### 8.1 check item 定義

`src/lib/content/quality-checklist.ts` の既存 `CheckItem` フォーマットに準拠。Gemini 呼び出しは `@/lib/ai/gemini-client` の `generateJson<T>()` を使用。

```ts
import { generateJson } from '@/lib/ai/gemini-client';
import { logger } from '@/lib/logger';

interface KishotenketsuCheckResult {
  ki_identifiable: boolean;
  sho_identifiable: boolean;
  ten_identifiable: boolean;
  ketsu_identifiable: boolean;
  ten_pivot_explicit: boolean;
  missing: Array<'ki' | 'sho' | 'ten' | 'ketsu'>;
  reason: string;
}

async function checkKishotenketsuArc(article: Article): Promise<CheckItem[]> {
  if (!article.kishotenketsu) {
    return [{
      id: 'kishotenketsu_arc',
      category: '構成',
      label: '起承転結が認識できるか',
      status: 'warn',
      severity: 'warning',
      detail: '起承転結プラン未生成のため判定スキップ',
    }];
  }

  const plan = article.kishotenketsu as { ki: string; sho: string; ten: string; ketsu: string };
  const stripped = stripHtml(article.body_html ?? '');

  if (stripped.length < 800) {
    return [{
      id: 'kishotenketsu_arc',
      category: '構成',
      label: '起承転結が認識できるか',
      status: 'fail',
      severity: 'warning',
      detail: '本文が短すぎて 4 段構成を判定不能',
    }];
  }

  try {
    const { data } = await generateJson<KishotenketsuCheckResult>(
      KISHOTENKETSU_SYSTEM_PROMPT,
      buildKishotenketsuUserPrompt(plan, stripped),
      { temperature: 0.1, maxOutputTokens: 512 },
    );

    const tenOk = data.ten_identifiable && data.ten_pivot_explicit;
    const allOk = data.ki_identifiable && data.sho_identifiable && tenOk && data.ketsu_identifiable;
    const missing = [
      ...(data.missing ?? []),
      ...(!data.ten_pivot_explicit && data.ten_identifiable ? ['ten(視点転換が不明瞭)'] : []),
    ];

    return [{
      id: 'kishotenketsu_arc',
      category: '構成',
      label: '起承転結が認識できるか',
      status: allOk ? 'pass' : 'fail',
      severity: 'warning',  // false positive リスクのため warning 固定
      detail: allOk ? undefined : `不足: ${missing.join('、')} / ${data.reason}`,
    }];
  } catch (e) {
    logger.warn('quality', 'kishotenketsu_arc.gemini_failed', { error: String(e) });
    return [{
      id: 'kishotenketsu_arc',
      category: '構成',
      label: '起承転結が認識できるか',
      status: 'warn',
      severity: 'warning',
      detail: 'AI 判定エラー (handled, 公開はブロックしない)',
    }];
  }
}
```

### 8.2 Gemini 判定プロンプト

```ts
const KISHOTENKETSU_SYSTEM_PROMPT =
  'あなたは日本語記事の構成解析器です。与えられた本文と起承転結プランを照合し、' +
  '4 段の各段が本文中で識別可能か、特に「転」での視点転換が明示されているかを厳密に判定し、' +
  'JSON のみを返します。説明や前置きは禁止です。';

function buildKishotenketsuUserPrompt(
  plan: { ki: string; sho: string; ten: string; ketsu: string },
  body: string,
): string {
  return [
    '# 起承転結プラン',
    `- 起: ${plan.ki}`,
    `- 承: ${plan.sho}`,
    `- 転: ${plan.ten}`,
    `- 結: ${plan.ketsu}`,
    '',
    '# 本文 (HTML タグ除去済み)',
    body.slice(0, 8000),
    '',
    '# 判定ルール',
    '1. 各段の趣旨が本文の異なるブロックに対応しているか (identifiable)',
    '2. 「転」では視点・立場・時間軸のいずれかが明示的に転換されているか (ten_pivot_explicit)',
    '   単なる話題の追加は転換とみなさない',
    '3. 不足している段を `missing` 配列に列挙する (ki/sho/ten/ketsu)',
    '',
    '# 出力スキーマ',
    '{',
    '  "ki_identifiable": boolean,',
    '  "sho_identifiable": boolean,',
    '  "ten_identifiable": boolean,',
    '  "ten_pivot_explicit": boolean,',
    '  "ketsu_identifiable": boolean,',
    '  "missing": ["ki" | "sho" | "ten" | "ketsu"],',
    '  "reason": "60 文字以内の判定理由"',
    '}',
  ].join('\n');
}
```

### 8.3 補助チェック: H2 alignment (cheerio)

`kishotenketsu_phase_alignment` を補助 check として追加 (severity: warning):

```ts
function checkKishotenketsuPhaseAlignment(article: Article): CheckItem[] {
  if (!article.kishotenketsu || !article.body_html) return [];
  const $ = cheerio.load(article.body_html);
  const h2s = $('h2').toArray().map(el => $(el).text().trim());
  const plan = article.kishotenketsu as { ki: string; sho: string; ten: string; ketsu: string };
  const phases: Array<['ki'|'sho'|'ten'|'ketsu', string]> = [
    ['ki', plan.ki], ['sho', plan.sho], ['ten', plan.ten], ['ketsu', plan.ketsu],
  ];
  const unaligned = phases.filter(([, summary]) => {
    const tokens = summary.split(/[、。\s]/).filter(t => t.length >= 2).slice(0, 3);
    return !h2s.some(h => tokens.some(t => h.includes(t)));
  });
  return [{
    id: 'kishotenketsu_phase_alignment',
    category: '構成',
    label: '各 H2 が起承転結プランと対応しているか',
    status: unaligned.length === 0 ? 'pass' : 'warn',
    severity: 'warning',
    detail: unaligned.length > 0 ? `H2 と非整合: ${unaligned.map(([k]) => k).join('、')}` : undefined,
  }];
}
```

### 8.4 設計上の注意

1. **severity = warning 固定**: AI 構成判定は false positive 30% 前提 (memory: Systemic Antipatterns ⑤)。公開ブロックしない安全側設計
2. **async API**: `runQualityChecklist` は同期、本 check は async → `runQualityChecklistAsync` を新設して呼ぶ。既存同期 API 互換維持
3. **AI 失敗時**: try/catch 内で `status: 'warn'` を返し silent done パターン回避
4. **本文短小**: 800 字未満は Gemini 呼ばず即 fail (既存 `checkContentLength` MIN=800 と整合、API 課金抑制)
5. **CHECK 制約**: migration 適用後、不正 INSERT が REJECT されることを SQL で確認

---

## §9 受け入れ基準 (Playwright 検証可能)

| # | GIVEN | WHEN | THEN |
|---|---|---|---|
| 1 | テーマ「孤独の意味」で zero-mode 生成を起動 | Stage1 が完了 | DB `articles.kishotenketsu` JSONB に 4 段が保存され、UI に 4 ブロックが各 50–150 字でレンダリングされる |
| 2 | Stage1 が kishotenketsu を生成済 | レビュー画面で「承認」ボタン押下 | `kishotenketsu_approved_at` が ISO8601 で書込み、ボタンが「承認済」disabled に切替 |
| 3 | kishotenketsu 未承認 | Stage2「本文生成」を押下 | 「起承転結の承認が必要」エラー表示、API は 412、`articles.status` 不変 |
| 4 | kishotenketsu 承認済 | Stage2 を実行 | 生成本文に「転」段の core_message が含まれる、本文長 ≥ 1800 字、CTA 2 箇所、placeholder 0 件 |
| 5 | 承認済 kishotenketsu の「承」を編集して保存 | inline editor で textarea 編集 → 自動 PATCH | `article_revisions` rev_no +1 で INSERT、`approved_at` は NULL に戻る (再承認必須) |
| 6 | quality_check 起動 (Stage2 完了後) | runQualityChecklistAsync 実行 | `kishotenketsu_arc` が PASS、4 段の語彙が本文に最低 1 回出現 |
| 7 | feature flag `NEXT_PUBLIC_KISHOTENKETSU_ENABLED=false` | zero 生成画面を開く | UI セクションが DOM に出現せず、Stage1 schema からも該当フィールド省略 |
| 8 | 既存 zero 記事 (`kishotenketsu IS NULL`) | レビュー画面を開く | 「未生成」バナー + 「いまから生成」ボタン (バックフィル trigger) |
| 9 | バックフィル script を `--apply` 無しで実行 | dry-run | 対象 22 件の差分プレビュー stdout 出力、DB は変更なし |
| 10 | RLS 有効、未認証で PATCH | `/api/articles/[id]` を直接叩く | 401、DB ログに `permission denied for table articles` |

---

## §10 実装フェーズ (P5-99 〜 P5-103)

### P5-99 Stage1 schema + prompt 拡張
- **依存**: なし
- **成果物**:
  - `src/lib/ai/prompts/stage1-zero-outline.ts`: `zeroOutlineOutputSchema` に `kishotenketsu` + `h2_chapters[].kishotenketsu_phase` 追加、§4 の system/user prompt 追記
  - `src/lib/schemas/kishotenketsu.ts`: 共通 schema (新規)
  - `test/unit/kishotenketsu-schema.test.ts`: schema 検証 + 転独立性テスト
- **規模**: ~80 行 (prompt 30 / schema 30 / test 20)
- **リスク**: 低 — 既存出力に追記のみ、prompt token +120 程度

### P5-100 DB migration + UI レビュー section
- **依存**: P5-99
- **成果物**:
  - `supabase/migrations/20260509000000_add_kishotenketsu.sql` (§7)
  - `src/components/articles/KishotenketsuReview.tsx` (4 ブロック表示 + inline edit + approve)
  - `src/app/api/articles/[id]/route.ts` 拡張 (PATCH で kishotenketsu 受理)
  - `src/app/api/ai/generate-kishotenketsu/route.ts` 新設 (4 段 retry 用)
  - `src/app/api/ai/generate-body/route.ts` に 412 ガード追加
  - Playwright e2e (`test/e2e/kishotenketsu-review.spec.ts`)
- **規模**: ~280 行 (migration 40 / UI 120 / API 60 / e2e 60)
- **リスク**: 中 — RLS policy の漏れ、`article_revisions` 連動

### P5-101 Stage2 prompt 注入 + run-completion 経路接続
- **依存**: P5-99, P5-100
- **成果物**:
  - `src/lib/ai/prompts/stage2-zero-writing.ts` に §5 の追記
  - `src/lib/zero-gen/run-completion.ts` で `approved_at` ガード (未承認なら 412)
  - Stage2 出力 post-validate に core_message 含有チェック
- **規模**: ~120 行
- **リスク**: 中 — prompt token +400、Stage2 失敗率変動を監視 (memory: P5-69 silent done 防止と並列確認)

### P5-102 quality_check kishotenketsu_arc 追加
- **依存**: P5-101
- **成果物**:
  - `src/lib/content/quality-checklist.ts` に `checkKishotenketsuArc` 追加 (§8)
  - `runQualityChecklistAsync` 新設 (既存同期 API 互換維持)
  - レビュー画面の品質バッジに新項目追加
  - 閾値は `NEXT_PUBLIC_KISHOTENKETSU_COVERAGE_MIN` で config 駆動
- **規模**: ~90 行
- **リスク**: 低 — 既存 quality registry pattern 踏襲

### P5-103 (オプショナル) 既存 22 件バックフィル
- **依存**: P5-99 〜 P5-102 全完了 + ユーザー判断
- **成果物**:
  - `tmp/backfill/kishotenketsu.ts` (dry-run / `--apply` / `--ids=...`)
  - Gemini で本文から 4 段を逆生成、`article_revisions` に履歴 INSERT してから UPDATE (memory: HTML History Rule 遵守)
- **規模**: ~150 行
- **リスク**: 中 — 22 件 × Gemini ~$1.5 想定。ユーザー承認後のみ `--apply`

---

## §11 ロールアウト戦略

- **Feature flag**: `NEXT_PUBLIC_KISHOTENKETSU_ENABLED` (env / Settings UI 両駆動、ハードコード禁止)
- **展開順序**:
  1. **dev**: ローカル `.env.local` で `true`、3 件試験生成、Playwright 全 PASS 確認
  2. **staging**: Vercel preview で `true`、由起子さんレビュー 5 件、品質 4/5 以上を eval_report.md 確認
  3. **production**: Vercel prod で `true`、最初の 24h は新規生成のみ (バックフィル無し)、Sentry / Slack 監視
- **フォールバック**: `kishotenketsu IS NULL` の旧記事は既存 prompt path 使用 (`if (article.kishotenketsu_approved_at) { useNewPrompt() } else { useLegacyPrompt() }`)
- **Kill switch**: 障害時は flag を `false` に切替えるだけで即時旧フロー復帰、DB カラムは残置

---

## §12 既存データ移行

- **対象**: 既存 zero-mode 記事 22 件 (`generation_mode='zero' AND kishotenketsu IS NULL`)
- **対象外**: source-mode 60 件 (本仕様の対象外)
- **バックフィル script**: `tmp/backfill/kishotenketsu.ts`
  - 入力: `--ids=a,b,c` (省略時は全 22 件)、`--dry-run` (デフォルト) / `--apply`
  - 処理: 本文を Gemini に渡し「この本文から起承転結 4 段を逆生成」プロンプトで JSON 取得 → Zod 検証 → dry-run なら diff、apply なら `article_revisions` に履歴 INSERT してから `articles.kishotenketsu` UPDATE
  - ログ: `tmp/backfill/logs/kishotenketsu-YYYYMMDD-HHMM.json` に全 prompt / 出力 / cost 保存
- **ユーザー判断**: 由起子さんの承認後にのみ `--apply` 実行
- **ロールバック**: バックフィル後に問題発覚時は `article_revisions` rev_no -1 から復元

---

## §13 絶対ルール (CLAUDE.md 準拠)

1. **役割宣言**: 各実装フェーズ開始時に `[現在の役割: <Planner|Generator|Evaluator|...>]` を冒頭明記
2. **責務越境禁止**: Evaluator はコード修正不可、Generator は仕様変更不可
3. **並列性最大化**: 独立タスクはバックグラウンド・サブプロセスで投入
4. **自動圧縮**: 各ループ境界で `progress.md` に状態要約
5. **ハードコード禁止**: feature flag・閾値は config / env 駆動
6. **RLS 必須**: 既存 articles RLS でカバー (新規ポリシー不要)
7. **デグレ敏感性**: 既存 `narrative_arc` / 既存 prompt path / 既存 Stage2 動作に影響を与えないこと
8. **証拠保全**: 各フェーズ完了時に Playwright で受け入れ基準 §9 を実行、`eval_report.md` に証跡

---

## §14 関連メモリ参照

- `feedback_yukiko.md`: 視点転換 (転 phase) は由起子さん FB 14-5 の核
- `feedback_systemic_antipatterns.md` ⑤: AI 構成判定は 30% false positive 前提 → severity warning 固定の根拠
- `feedback_html_history.md`: 本文 UPDATE は必ず article_revisions INSERT 経由
- `feedback_silent_failure_lessons.md`: catch 後の silent done を回避
- `project_publish_control_v3.md`: P5-XX フェーズ番号体系の継続

---

**End of Spec**
