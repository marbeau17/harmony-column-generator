# 品質チェック修復機能 (Auto-Fix) 仕様書 — P5-19

**Author:** Planner
**Date:** 2026-05-02
**Scope:** 品質チェックの fail/warn 項目ごとに「自動補正 / 章再生成 / 手動編集 / 無視」の 4 修復オプションを提示し、UI から実行できるようにする。

---

## 1. 背景と目的

### 1.1 現状の痛み
品質チェックダイアログ (`/dashboard/articles/[id]/edit` の公開フロー) で fail が出た際、以下しか選択肢がない:
- **全体再生成** ($0.18, 90s, 違うバージョンが生まれる)
- **手動編集** (5-30 分人間作業)

例: 「語りかけ語尾 5/66 文 (8%)」のような **局所的なルール違反** に対しても、
全体再生成しか手段がなく、コストと時間が過剰。

### 1.2 ゴール
1. **エラータイプ別の最適な修復手段** を 4 オプションから選べる UI
2. 6 種類の **局所自動補正プロンプト** ($0.005-0.01/呼び 5-15s) を整備
3. 既存の **章再生成 API (regenerate-segment)** を UI に晒す
4. **警告無視** (manual override) を実装し、誤検知でも公開可能にする
5. 修復のたびに **article_revisions** に履歴先行 INSERT (HTML 履歴ルール)

### 1.3 非ゴール
- 検出ロジック自体の精度向上 (別サイクル)
- 一括 (全 fail を一度に補正) 機能 (v2 候補)
- 修復前後の自動 A/B テスト (v2 候補)

---

## 2. アーキテクチャ

### 2.1 修復戦略マップ (`strategy-map.ts`)

各 `CheckItem.id` (quality-checklist.ts) を以下 4 種の戦略にマップ:

| 戦略 | 説明 | 既存 API |
|---|---|---|
| `auto-fix` | Gemini に局所書換プロンプトを送る (~$0.005-0.01, 5-15s) | 新規 |
| `regen-chapter` | 該当章を再生成 ($0.05, 30s) | `regenerate-segment` 既存 |
| `regen-full` | 全体再生成 ($0.18, 90s) | `regenerate-segment scope=full` |
| `manual-edit` | 編集画面に jump | UI のみ |
| `ignore-warn` | 警告を無視して公開許可 | `quality-overrides` 新規 |

### 2.2 マッピング表（初期）

| CheckItem.id | カテゴリ | 既定戦略 | フォールバック |
|---|---|---|---|
| `soft_ending_ratio` | 文体 | auto-fix:suffix | manual-edit |
| `keyword_occurrence` | SEO | auto-fix:keyword | regen-chapter |
| `abstract_spiritual` | 文体 | auto-fix:abstract | manual-edit |
| `body_length` | コンテンツ | auto-fix:length | regen-chapter |
| `hallucination_critical` | ハルシネ | regen-chapter | manual-edit |
| `tone_low` | トーン | auto-fix:tone | regen-full |
| `book_expression` | 禁止語 | manual-edit | (auto-fix 不可、危険) |
| `ai_pattern` | 文体 | manual-edit | (auto-fix 不可、再発リスク) |
| `medical_expression` | 禁止語 | manual-edit | (法令準拠、自動禁止) |
| `image_placeholder` | 画像 | manual-edit | (UI で再 apply) |
| `cta_url_invalid` | CTA | manual-edit | regen-chapter |

「auto-fix 不可」は安全上の理由で禁止 (再発リスク・医療法令)。

### 2.3 6 個の auto-fix プロンプト

| 種別 | 入力 | 期待出力 | プロンプト要旨 |
|---|---|---|---|
| `suffix` | bodyHtml + 現在比率 + 目標比率 | bodyHtml | 「文末の 15% 以上を ですよね/ですね/なんです 等の語りかけ語尾に書き換え。文の意味は保持」 |
| `keyword` | bodyHtml + keywords[] | bodyHtml | 「これらのキーワードを各 3 回以上、自然な文脈で本文に挿入」 |
| `abstract` | bodyHtml + 検出表現 | bodyHtml | 「該当の抽象表現の直後に 1 文の具体例を追加」 |
| `length` | bodyHtml + 現状字数 + 目標 | bodyHtml | 「各 H2 章に 100-150 字追記して目標字数に到達」 |
| `claim` | bodyHtml + claim_idx | bodyHtml | 「該当 claim を別の言い回しに置換、ハルシネーションを排除」 |
| `tone` | bodyHtml + tone breakdown | bodyHtml | 「全体を由起子流（語りかけ + 比喩 + 優しさ）にリライト。構成保持」 |

全 prompt は `temperature=0.5`, `maxOutputTokens=32000`, JSON 出力 `{html: ...}`。
4 形態正規化 (P5-13 の `normalizeStage2Html`) を流用。

### 2.4 API

#### `POST /api/articles/[id]/auto-fix`

**Body:**
```jsonc
{
  "fix_strategy": "auto-fix" | "regen-chapter" | "regen-full" | "ignore-warn",
  "check_item_id": "soft_ending_ratio",
  // 戦略別パラメータ
  "auto_fix_params": {
    "fix_type": "suffix" | "keyword" | "abstract" | "length" | "claim" | "tone",
    "target_value"?: number,    // 目標値 (suffix 比率, length 字数 等)
    "keywords"?: string[],       // keyword 戦略時
    "claim_idx"?: number,        // claim 戦略時
  },
  "regen_params"?: {
    "chapter_idx"?: number       // regen-chapter 時
  }
}
```

**処理:**
1. 認証 + zod 検証
2. articles SELECT (service role)
3. session-guard `assertArticleWriteAllowed`
4. **旧 stage2_body_html を article_revisions に先行 INSERT** (`change_type='auto_fix_before'`)
5. 戦略ごとにディスパッチ:
   - `auto-fix`: 6 プロンプトのいずれかを Gemini にコール → 4 形態正規化
   - `regen-chapter`: 既存 `regenerate-segment` の章再生成ロジックを呼ぶ
   - `regen-full`: 既存 `regenerate-segment scope=full` を呼ぶ
   - `ignore-warn`: `articles.quality_overrides` (JSONB) に `{check_item_id, ignored_at, reason}` を append
6. 成功時 articles UPDATE (`stage2_body_html`)
7. 修復後の **article_revisions に追加 INSERT** (`change_type='auto_fix_after'`)
8. **quality-check を再実行** して新スコアを返す
9. レスポンス: `{ before_html, after_html, diff_html, recheck: ChecklistResult, cost_estimate }`

**エラーハンドリング:**
- Gemini 失敗 → 503 (revision は roll back せず `auto_fix_before` 残す)
- バリデーション → 400
- 権限 → 403
- session-guard fail → 423

### 2.5 quality_overrides 列

新規マイグレーション `20260502000000_quality_overrides.sql`:

```sql
ALTER TABLE articles
ADD COLUMN IF NOT EXISTS quality_overrides JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN articles.quality_overrides IS
'{check_item_id, ignored_at, reason} の配列。品質チェックの警告を手動で無視した記録';
```

quality-check API は `quality_overrides` を読み込み、override されている item を `pass` 扱いにする (UI 上は「(無視済)」表記)。

### 2.6 UI

`src/app/(dashboard)/dashboard/articles/[id]/edit/page.tsx` の品質チェックダイアログを拡張:

```
品質チェック結果
✅ X件パス  ❌ 3件エラー  ⚠️ 1件警告

❌ 語りかけ語尾不足 (5/66 = 8%, 目標 15%)
  └ [⚙️ 修復 ▼]
       🔧 自動補正 ($0.005, ~10s)
       🔁 章再生成 ($0.05, ~30s)
       ✏️ 手動編集
       ⏭️ この警告を無視

❌ キーワード未出現 (0回)
  └ [⚙️ 修復 ▼]
       🔧 自動補正 ($0.005, ~10s)
       🔁 章再生成 ($0.05, ~30s)
       ✏️ 手動編集

⚠️ 抽象スピ表現 (引き寄せの法則)
  └ [⚙️ 修復 ▼]
       🔧 自動補正 ($0.01, ~15s)
       ✏️ 手動編集
       ⏭️ この警告を無視

[公開する] (品質チェックパスのみ enable)
```

修復ボタンを押下 → API call → loader 表示 → 完了後ダイアログ内の品質チェックを自動再実行 → 結果反映。

### 2.7 article_revisions

各修復で 2 件の revision を残す:
- `change_type='auto_fix_before'`: 修復前 HTML
- `change_type='auto_fix_after'`: 修復後 HTML
- `comment`: `{fix_strategy, check_item_id, fix_type, model: 'gemini-3.1-pro-preview'}`

---

## 3. 実装計画 (20 並列)

### Phase 1: 基盤 (並列可)
| # | ファイル | 内容 |
|---|---|---|
| F1 | `docs/auto-fix-spec.md` | 本ファイル |
| F2 | `supabase/migrations/20260502000000_quality_overrides.sql` | quality_overrides JSONB 列 |
| F3 | `src/lib/validators/auto-fix.ts` | zod スキーマ |
| F4 | `src/lib/auto-fix/strategy-map.ts` | CheckItem.id → strategy のマッピング |
| F5 | `src/lib/auto-fix/types.ts` | 型定義 |

### Phase 2: 6 プロンプト (完全並列)
| # | ファイル |
|---|---|
| F6 | `src/lib/auto-fix/prompts/suffix.ts` |
| F7 | `src/lib/auto-fix/prompts/keyword.ts` |
| F8 | `src/lib/auto-fix/prompts/abstract.ts` |
| F9 | `src/lib/auto-fix/prompts/length.ts` |
| F10 | `src/lib/auto-fix/prompts/claim.ts` |
| F11 | `src/lib/auto-fix/prompts/tone.ts` |

### Phase 3: orchestrator + API
| # | ファイル |
|---|---|
| F12 | `src/lib/auto-fix/orchestrator.ts` |
| F13 | `src/app/api/articles/[id]/auto-fix/route.ts` |

### Phase 4: UI + テスト (並列可)
| # | ファイル |
|---|---|
| F14 | `src/components/articles/QualityFixMenu.tsx` (新規 dropdown コンポ) |
| F15 | `src/app/(dashboard)/dashboard/articles/[id]/edit/page.tsx` 拡張 |
| F16 | `test/unit/auto-fix-prompts.test.ts` (6 プロンプト) |
| F17 | `test/unit/auto-fix-strategy-map.test.ts` |
| F18 | `test/unit/auto-fix-orchestrator.test.ts` (mocked Gemini) |
| F19 | `test/unit/auto-fix-api.test.ts` |
| F20 | `docs/progress.md` 追記 |

---

## 4. 受入基準

- AC-1: 品質チェックダイアログの fail/warn item ごとに「⚙️ 修復」プルダウンが出る
- AC-2: 自動補正で語尾不足 8% → 15%+ にできる (実 Gemini 呼出で検証)
- AC-3: 章再生成は既存 `regenerate-segment` を呼ぶだけで動く
- AC-4: 警告無視を選ぶと該当 check_item が以後 pass 扱いになる (DB 永続)
- AC-5: 修復後、品質チェックが自動再実行されダイアログ表示更新
- AC-6: 修復前後の HTML が必ず article_revisions に 2 件残る
- AC-7: `auto-fix` で安全禁止 (book_expression / ai_pattern / medical) を選んでも 400 を返す
- AC-8: `npx tsc --noEmit` 0 errors / `npx vitest run` 全 PASS
- AC-9: 失敗時の Gemini エラーが UI に明示され、article は壊れない

---

## 5. リスクと緩和

| リスク | 緩和策 |
|---|---|
| 自動補正で逆に質が下がる | revision に必ず 2 件残し、「前のバージョンに戻す」を edit page から提供 |
| Gemini timeout (15s 超) | maxOutputTokens=32000 + 60s timeout、失敗時 stage2 は変更しない |
| 多重実行 (連打) | session-guard + UI で再実行中は disabled |
| ignore-warn の暴走 | `quality_overrides[].reason` 必須入力 (UI で 1 行プロンプト) |
| キーワード自然さ | プロンプトに「自然な文脈」「強引な挿入禁止」を明記 |

---

## 6. v2 候補 (次サイクル)

- 一括「全エラー自動補正」ボタン
- 修復前後の A/B プレビュー (DiffViewer 拡張)
- 自動補正の連続実行カウンタ (3 回連続失敗で全体再生成提案)
- ML scoring: どの戦略が成功率高いかを学習して既定戦略を動的調整
